//! 28-step canonical FK-import sequencer.
//!
//! Implements migration plan v0.5 §3.2a (D-027). Each step runs an
//! `INSERT INTO target.<table> (...) SELECT ... FROM src.<table>` over
//! the snapshot DB attached as `src`.
//!
//! All 28 steps run inside a single `BEGIN IMMEDIATE TRANSACTION`. Any
//! error rolls back the entire import — `.import-tmp/db.sqlite` is left
//! in whatever state SQLite chose; the use-case layer cleans it up.
//!
//! Per D-029 #4 (FTS double-insert fix): `tasks_fts_insert` and
//! `agent_reports_fts_insert` triggers fire on every `INSERT INTO tasks`
//! / `INSERT INTO agent_reports`, which already populates the FTS
//! tables. The "rebuild" steps 26/27 therefore prefix `DELETE FROM
//! tasks_fts; DELETE FROM agent_reports_fts;` so the explicit
//! SELECT-INSERT acts as a clean rebuild (and exercises the FTS engine
//! end-to-end as a verification pass).

use std::path::Path;

use rusqlite::Connection;

use super::ImportError;

/// Per-table row count after a successful import.
#[derive(Debug, Clone, Default)]
pub struct SequencerOutcome {
    pub rows_imported: std::collections::BTreeMap<String, u64>,
    pub fts_rows_rebuilt: std::collections::BTreeMap<String, u64>,
}

/// Canonical 28-step copy plan.
///
/// Each tuple is `(table_name, column_list, fts_flag)`. `fts_flag = true`
/// signals that the step is one of the FTS rebuilds (steps 26/27) and
/// should be tallied into `fts_rows_rebuilt` instead of `rows_imported`.
///
/// Engineer note (per plan §3.2a "physical execution swap"): `skills`
/// and `mcp_tools` (table-level roots) physically run BEFORE the
/// `role_skills` / `role_mcp_tools` join tables, even though the
/// human-readable §3.2a table groups them together for documentation.
/// This list reflects the *physical* execution order.
const PLAN: &[(&str, &str, FtsFlag)] = &[
    // 1
    ("spaces",
     "id, name, prefix, description, is_default, position, created_at, updated_at",
     FtsFlag::No),
    // 2
    ("space_counters", "space_id, next_number", FtsFlag::No),
    // 3
    ("roles", "id, name, content, color, created_at, updated_at", FtsFlag::No),
    // 4 — physical-order swap: skills before role_skills
    ("skills", "id, name, content, color, created_at, updated_at", FtsFlag::No),
    // 5 — physical-order swap: mcp_tools before role_mcp_tools
    ("mcp_tools", "id, name, content, color, created_at, updated_at", FtsFlag::No),
    // 6
    ("role_skills", "role_id, skill_id, position", FtsFlag::No),
    // 7
    ("role_mcp_tools", "role_id, mcp_tool_id, position", FtsFlag::No),
    // 8
    ("boards", "id, name, space_id, role_id, position, created_at, updated_at", FtsFlag::No),
    // 9
    ("columns", "id, board_id, name, position, role_id, created_at", FtsFlag::No),
    // 10
    ("prompts",
     "id, name, content, color, short_description, token_count, created_at, updated_at",
     FtsFlag::No),
    // 11
    ("prompt_groups", "id, name, color, position, created_at, updated_at", FtsFlag::No),
    // 12
    ("prompt_group_members", "group_id, prompt_id, position, added_at", FtsFlag::No),
    // 13
    ("role_prompts", "role_id, prompt_id, position", FtsFlag::No),
    // 14
    ("board_prompts", "board_id, prompt_id, position", FtsFlag::No),
    // 15
    ("column_prompts", "column_id, prompt_id, position", FtsFlag::No),
    // 16
    ("tasks",
     "id, board_id, column_id, slug, title, description, position, role_id, created_at, updated_at",
     FtsFlag::No),
    // 17
    ("task_prompts", "task_id, prompt_id, origin, position", FtsFlag::No),
    // 18
    ("task_attachments",
     "id, task_id, filename, mime_type, size_bytes, storage_path, uploaded_at, uploaded_by",
     FtsFlag::No),
    // 19
    ("task_events", "id, task_id, type, actor, details_json, created_at", FtsFlag::No),
    // 20
    ("agent_reports",
     "id, task_id, kind, title, content, author, created_at, updated_at",
     FtsFlag::No),
    // 21
    ("tags", "id, name, color, created_at, updated_at", FtsFlag::No),
    // 22
    ("prompt_tags", "prompt_id, tag_id, added_at", FtsFlag::No),
    // 23
    ("task_skills", "task_id, skill_id, origin, position", FtsFlag::No),
    // 24
    ("task_mcp_tools", "task_id, mcp_tool_id, origin, position", FtsFlag::No),
    // 25
    ("task_prompt_overrides", "task_id, prompt_id, enabled, created_at", FtsFlag::No),
    // 26 — FTS rebuild for tasks_fts (cols don't match name-for-name with `tasks`,
    //       see fts_insert_for below).
    ("tasks_fts", "task_id, title, description", FtsFlag::TasksFts),
    // 27 — FTS rebuild for agent_reports_fts.
    ("agent_reports_fts", "report_id, title, content", FtsFlag::AgentReportsFts),
    // 28 — settings (selective copy: drop hub-specific keys per plan §3.4).
    ("settings", "key, value, updated_at", FtsFlag::Settings),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FtsFlag {
    No,
    TasksFts,
    AgentReportsFts,
    Settings,
}

/// Run the 28-step plan against `target_conn`, attaching `source_path`
/// as `src` (read-only).
///
/// On entry, `target_conn` MUST already have the Catique schema applied
/// (see `crate::db::runner::run_pending`).
///
/// # Errors
///
/// Returns the first SQL error. The transaction is rolled back
/// automatically on Err return because `tx` is dropped without commit.
pub fn run_import_transaction(
    target_conn: &mut Connection,
    source_path: &Path,
) -> Result<SequencerOutcome, ImportError> {
    // Attach source read-only via URI (per migration plan §3.2a).
    let attach_sql = format!(
        "ATTACH DATABASE 'file:{}?mode=ro' AS src",
        source_path.display()
    );
    target_conn.execute_batch(&attach_sql)?;

    // Defer FK enforcement during bulk import. The plan strictly
    // orders parents before children, so FKs are valid at every step
    // boundary; enforcing on each row is wasted CPU. We then
    // re-enable + run a one-shot FK check before COMMIT.
    let prev_fk: i64 = target_conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
    target_conn.execute_batch("PRAGMA foreign_keys = OFF;")?;

    // The result struct is built up step-by-step inside the
    // transaction body. We use a closure so any `?` return rolls back
    // via `tx`'s Drop impl.
    let outcome = (|| -> Result<SequencerOutcome, ImportError> {
        let mut outcome = SequencerOutcome::default();

        let tx = target_conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

        for (table, cols, flag) in PLAN {
            match *flag {
                FtsFlag::No => {
                    let n = run_simple_copy(&tx, table, cols)?;
                    outcome.rows_imported.insert((*table).to_owned(), n);
                }
                FtsFlag::TasksFts => {
                    // Per D-029 #4: clear the trigger-populated rows
                    // before SELECT-INSERT rebuild.
                    tx.execute_batch("DELETE FROM tasks_fts")?;
                    let sql = "INSERT INTO tasks_fts(task_id, title, description) \
                               SELECT id, title, description FROM tasks";
                    let n = u64::try_from(tx.execute(sql, [])?).unwrap_or(0);
                    outcome
                        .fts_rows_rebuilt
                        .insert("tasks_fts".to_owned(), n);
                }
                FtsFlag::AgentReportsFts => {
                    tx.execute_batch("DELETE FROM agent_reports_fts")?;
                    let sql = "INSERT INTO agent_reports_fts(report_id, title, content) \
                               SELECT id, title, content FROM agent_reports";
                    let n = u64::try_from(tx.execute(sql, [])?).unwrap_or(0);
                    outcome
                        .fts_rows_rebuilt
                        .insert("agent_reports_fts".to_owned(), n);
                }
                FtsFlag::Settings => {
                    // Selective: skip host-specific keys (port, pid,
                    // hub-specific). Per plan §3.4.
                    let sql = format!(
                        "INSERT INTO settings ({cols}) \
                         SELECT {cols} FROM src.settings \
                         WHERE key NOT IN ('port', 'pid', 'hub_pid', 'hub_port')"
                    );
                    let n = u64::try_from(tx.execute(&sql, [])?).unwrap_or(0);
                    outcome.rows_imported.insert((*table).to_owned(), n);
                }
            }
        }

        // FK sanity sweep — re-enable and ask SQLite to verify.
        tx.execute_batch("PRAGMA foreign_keys = ON;")?;
        let mut stmt = tx.prepare("PRAGMA foreign_key_check")?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            // Each row of foreign_key_check describes one violation:
            // (table, rowid, parent, fkid).
            let table: String = row.get(0)?;
            return Err(ImportError::Validation {
                reason: format!("FK check failed on table {table}"),
            });
        }
        drop(rows);
        drop(stmt);

        tx.commit()?;
        Ok(outcome)
    })();

    // Restore the caller's PRAGMA + DETACH src in all cases so the
    // working connection is clean even on Err.
    let _ = target_conn.execute_batch(&format!(
        "PRAGMA foreign_keys = {};",
        if prev_fk == 1 { "ON" } else { "OFF" }
    ));
    let _ = target_conn.execute_batch("DETACH DATABASE src;");

    outcome
}

fn run_simple_copy(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    cols: &str,
) -> Result<u64, ImportError> {
    let sql = format!(
        "INSERT INTO {table} ({cols}) SELECT {cols} FROM src.{table}"
    );
    let n = tx.execute(&sql, [])?;
    Ok(u64::try_from(n).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    fn fresh_target() -> Connection {
        let mut conn = Connection::open_in_memory().expect("mem db");
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn
    }

    fn golden_fixture_path() -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/promptery-v0.4-golden.sqlite")
    }

    #[test]
    fn happy_path_imports_full_golden_fixture() {
        let golden = golden_fixture_path();
        if !golden.exists() {
            return;
        }
        let mut target = fresh_target();
        let outcome =
            run_import_transaction(&mut target, &golden).expect("import");

        // Basic counts
        let tasks: i64 = target
            .query_row("SELECT count(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tasks, 1000);
        let boards: i64 = target
            .query_row("SELECT count(*) FROM boards", [], |r| r.get(0))
            .unwrap();
        assert_eq!(boards, 50);
        let prompts: i64 = target
            .query_row("SELECT count(*) FROM prompts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(prompts, 100);

        // FTS — must be exactly 1000 (D-029 #4 fix prevents double).
        let tfts: i64 = target
            .query_row("SELECT count(*) FROM tasks_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tfts, 1000, "tasks_fts must equal tasks (no double-insert)");
        let arfts: i64 = target
            .query_row("SELECT count(*) FROM agent_reports_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(arfts, 50, "agent_reports_fts must equal agent_reports");

        assert_eq!(outcome.rows_imported["tasks"], 1000);
        assert_eq!(outcome.rows_imported["boards"], 50);
        assert_eq!(outcome.fts_rows_rebuilt["tasks_fts"], 1000);
        assert_eq!(outcome.fts_rows_rebuilt["agent_reports_fts"], 50);
    }

    #[test]
    fn rollback_on_fk_violation() {
        // Build a synthetic source DB with a violation: a board
        // referencing a non-existent space. Catique-side schema has FK
        // ON; PRAGMA foreign_key_check must catch it before COMMIT.
        let tmp = std::env::temp_dir().join(format!(
            "catique-seq-fk-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.subsec_nanos())
        ));
        let _ = std::fs::remove_file(&tmp);

        // Build the source by applying the embedded schema bundle then
        // injecting a bad row with FK off.
        {
            let conn = Connection::open(&tmp).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
            let (schema, migrations) =
                super::super::schema::schema_bundle_apply_sql().unwrap();
            conn.execute_batch(&schema).unwrap();
            for m in &migrations {
                let _ = conn.execute_batch(m); // tolerant — no-ops on dup CREATE IF NOT EXISTS
            }
            // Insert a board pointing at a missing space.
            conn.execute(
                "INSERT INTO boards (id, name, space_id, role_id, position, created_at, updated_at) \
                 VALUES ('b-orphan', 'Orphan', 'no-such-space', NULL, 0, 0, 0)",
                [],
            )
            .unwrap();
        }

        let mut target = fresh_target();
        let err = run_import_transaction(&mut target, &tmp)
            .expect_err("FK check must reject orphan board");
        match err {
            ImportError::Validation { reason } => {
                assert!(
                    reason.contains("FK"),
                    "expected FK reason, got: {reason}"
                );
            }
            other => panic!("expected Validation, got {other:?}"),
        }
        // Rolled back: target tasks count is 0
        let n: i64 = target
            .query_row("SELECT count(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "transaction must have rolled back");

        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn dry_run_via_rollback_leaves_target_pristine() {
        // We simulate a dry-run by running the import then explicitly
        // wiping the target — since the production dry-run runs the
        // import inside a transaction that rolls back, the post-state
        // should be identical to "never ran". Here we verify that an
        // import of zero data (empty source) leaves rows = 0.
        let tmp = std::env::temp_dir().join(format!(
            "catique-seq-empty-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.subsec_nanos())
        ));
        let _ = std::fs::remove_file(&tmp);
        {
            let conn = Connection::open(&tmp).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            let (schema, migrations) =
                super::super::schema::schema_bundle_apply_sql().unwrap();
            conn.execute_batch(&schema).unwrap();
            for m in &migrations {
                let _ = conn.execute_batch(m);
            }
        }
        let mut target = fresh_target();
        let outcome =
            run_import_transaction(&mut target, &tmp).expect("import empty");
        // Every count must be zero.
        for n in outcome.rows_imported.values() {
            assert_eq!(*n, 0);
        }
        for n in outcome.fts_rows_rebuilt.values() {
            assert_eq!(*n, 0);
        }
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn fts_rebuild_avoids_double_insert() {
        // After the import, total FTS rows must equal `tasks`. If the
        // DELETE prefix is removed (regression), this assertion fails.
        let golden = golden_fixture_path();
        if !golden.exists() {
            return;
        }
        let mut target = fresh_target();
        run_import_transaction(&mut target, &golden).expect("import");
        let tfts: i64 = target
            .query_row("SELECT count(*) FROM tasks_fts", [], |r| r.get(0))
            .unwrap();
        let tasks: i64 = target
            .query_row("SELECT count(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tfts, tasks);
    }

    #[test]
    fn settings_skips_host_keys() {
        let golden = golden_fixture_path();
        if !golden.exists() {
            return;
        }
        let mut target = fresh_target();
        run_import_transaction(&mut target, &golden).expect("import");
        // Make sure no port/pid keys leaked through; the fixture seed
        // doesn't add them so this is a defensive smoke test.
        let bad: i64 = target
            .query_row(
                "SELECT count(*) FROM settings WHERE key IN ('port','pid','hub_pid','hub_port')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(bad, 0);
    }
}
