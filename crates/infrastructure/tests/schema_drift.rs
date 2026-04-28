//! PF-4 schema-drift integration test.
//!
//! Per migration plan v0.5 §3.2 step 1 PF-4 + decision-log D-029 #6.
//! Builds a synthetic source DB whose `_migrations` ledger lacks one of
//! the canonical 15 names, runs preflight, and asserts PF-4 fires with
//! the expected error fingerprint.

use std::path::PathBuf;

use catique_infrastructure::import::preflight::{run_preflight, PreflightContext};
use rusqlite::Connection;

fn unique_dir(label: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos());
    let dir = std::env::temp_dir().join(format!(
        "catique-drift-{}-{label}-{nanos}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn pf4_detects_drifted_migrations_ledger() {
    let tmp = unique_dir("ledger");
    let bad = tmp.join("bad-source.sqlite");
    {
        let conn = Connection::open(&bad).unwrap();
        // Build a Promptery-shaped DB that's missing one migration. We
        // write only the bare minimum (`_migrations` plus a stub
        // `tasks` table) — PF-1, PF-2, PF-3 don't care about full
        // schema, but PF-4 will compare ledger fingerprints.
        conn.execute_batch(
            "CREATE TABLE _migrations (\
                name TEXT PRIMARY KEY, \
                applied_at INTEGER NOT NULL\
             );\
             CREATE TABLE tasks (id TEXT PRIMARY KEY);",
        )
        .unwrap();
        // Insert 14 of the canonical 15 migrations — drop `017_agent_reports`.
        for name in [
            "002_add_tag_kind",
            "004_refactor_tags_to_typed_entities",
            "005_settings",
            "006_inheritance",
            "007_prompt_groups",
            "008_tasks_fts",
            "009_spaces",
            "010_board_position",
            "011_prompt_short_description",
            "012_task_events",
            "013_prompt_tags",
            "014_prompt_token_count",
            "015_task_prompt_overrides",
            "016_task_attachments",
            // intentionally drop "017_agent_reports"
        ] {
            conn.execute(
                "INSERT INTO _migrations (name, applied_at) VALUES (?1, 0)",
                rusqlite::params![name],
            )
            .unwrap();
        }
    }

    let ctx = PreflightContext {
        source_path: &bad,
        target_data_dir: &tmp,
        target_db_path: &tmp.join("db.sqlite"),
        overwrite_existing: false,
        attachments_dir: None,
    };
    let outcome = run_preflight(&ctx).expect("preflight runs");
    assert!(outcome.results.pf1_source_exists, "PF-1");
    // PF-4 must reject the drift.
    assert!(
        !outcome.results.pf4_schema_hash_ok,
        "PF-4 must reject ledger drift; messages: {:?}",
        outcome.results.messages
    );
    let detail = outcome.results.messages.get("PF-4").cloned().unwrap_or_default();
    assert!(
        detail.contains("mismatch"),
        "expected mismatch error, got: {detail}"
    );
    assert!(
        !outcome.results.all_ok(),
        "any failed PF must fail all_ok()"
    );
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn pf4_passes_on_byte_identical_golden_fixture() {
    let golden = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/promptery-v0.4-golden.sqlite");
    if !golden.exists() {
        eprintln!("[skip] golden fixture absent");
        return;
    }
    let tmp = unique_dir("golden");
    let ctx = PreflightContext {
        source_path: &golden,
        target_data_dir: &tmp,
        target_db_path: &tmp.join("db.sqlite"),
        overwrite_existing: false,
        attachments_dir: None,
    };
    let outcome = run_preflight(&ctx).expect("preflight runs");
    assert!(outcome.results.pf4_schema_hash_ok, "PF-4 must pass: {:?}", outcome.results.messages);
    assert_eq!(outcome.source_schema_hash, outcome.target_schema_hash);
    let _ = std::fs::remove_dir_all(&tmp);
}
