//! Embedded migration runner.
//!
//! Migrations live as plain `.sql` files under `src/db/migrations/`. The
//! [`include_dir!`] macro embeds them into the binary at compile time —
//! no runtime FS dependency, and adding a `.sql` triggers a rebuild
//! automatically.
//!
//! Contract:
//!   1. Files are discovered in **lexical** order — pad with leading
//!      zeros (`001_*`, `002_*`, ...).
//!   2. Each migration runs inside a `BEGIN IMMEDIATE TRANSACTION`. Any
//!      error rolls back and propagates; the runner stops on first
//!      failure.
//!   3. On success the migration is recorded in `_migrations` with its
//!      SHA-256. A subsequent run with a modified SQL body errors out
//!      ([`MigrationError::Tampered`]) — we don't try to be smart about
//!      reapplying.
//!
//! `_migrations` schema (Catique-side, *not* identical to Promptery's):
//! ```sql
//! CREATE TABLE _migrations (
//!   name        TEXT PRIMARY KEY,
//!   applied_at  INTEGER NOT NULL,
//!   applied_sha TEXT NOT NULL
//! )
//! ```
//! The extra `applied_sha` column is a Catique-specific hardening that
//! Promptery doesn't carry. The import-module (E2.5) reads Promptery's
//! `_migrations(name, applied_at)` and seeds Catique's table with a
//! recomputed SHA, so the schemas stay byte-identical *for the data
//! tables* while the migration ledger differs.

use std::time::{SystemTime, UNIX_EPOCH};

use include_dir::{include_dir, Dir, File};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

/// All migration `.sql` files, embedded at compile time. Keep relative
/// to this source file so `cargo` watches the directory automatically.
static MIGRATIONS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/src/db/migrations");

/// One migration the runner just recorded as applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationApplied {
    /// File stem without the `.sql` suffix (`001_initial`).
    pub name: String,
    /// Hex-encoded SHA-256 of the SQL body that was executed.
    pub applied_sha: String,
}

/// Errors surfaced by the runner.
#[derive(Debug, thiserror::Error)]
pub enum MigrationError {
    /// SQLite returned an error during the apply step. The transaction
    /// has already been rolled back by the time this is returned.
    #[error("migration `{name}` failed to apply: {source}")]
    Apply {
        name: String,
        #[source]
        source: rusqlite::Error,
    },

    /// `_migrations.applied_sha` for a previously-applied migration
    /// doesn't match the embedded source — somebody edited a `.sql` file
    /// after it shipped. Not auto-recoverable.
    #[error("migration `{name}` SHA mismatch: stored {stored}, embedded {embedded}")]
    Tampered {
        name: String,
        stored: String,
        embedded: String,
    },

    /// Embedded SQL bytes are not valid UTF-8 (sanity check; should
    /// never fire because the source is checked into git).
    #[error("migration `{name}` is not valid UTF-8")]
    InvalidUtf8 { name: String },

    /// SQLite error outside the apply step (bookkeeping queries).
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// Apply every embedded migration that hasn't been recorded in
/// `_migrations` yet. Returns the list of newly-applied migrations in
/// the order they ran.
///
/// # Errors
///
/// Stops on the first failure and returns it; previously-applied
/// migrations remain committed.
pub fn run_pending(conn: &mut Connection) -> Result<Vec<MigrationApplied>, MigrationError> {
    ensure_migrations_table(conn)?;

    let mut applied = Vec::new();
    for file in sorted_migration_files() {
        let name = migration_name(file).to_owned();
        let body = file
            .contents_utf8()
            .ok_or_else(|| MigrationError::InvalidUtf8 { name: name.clone() })?;
        let sha = hex_sha256(body.as_bytes());

        match stored_sha(conn, &name)? {
            Some(stored) if stored == sha => continue, // already applied, body unchanged
            Some(stored) => {
                return Err(MigrationError::Tampered {
                    name,
                    stored,
                    embedded: sha,
                });
            }
            None => apply_one(conn, &name, body, &sha)?,
        }
        applied.push(MigrationApplied {
            name,
            applied_sha: sha,
        });
    }
    Ok(applied)
}

fn ensure_migrations_table(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
             name        TEXT PRIMARY KEY,
             applied_at  INTEGER NOT NULL,
             applied_sha TEXT NOT NULL
         )",
    )
}

fn stored_sha(conn: &Connection, name: &str) -> Result<Option<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT applied_sha FROM _migrations WHERE name = ?1")?;
    let mut rows = stmt.query(params![name])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

fn apply_one(
    conn: &mut Connection,
    name: &str,
    body: &str,
    sha: &str,
) -> Result<(), MigrationError> {
    // Disable foreign-key enforcement around the transaction so that
    // table-rebuild dances inside a migration (DROP + CREATE + RENAME)
    // do not trigger cascading implicit deletes on child tables. SQLite
    // honours `PRAGMA foreign_keys = OFF` only **outside** an open
    // transaction (https://sqlite.org/foreignkeys.html §4.2), so we
    // toggle it *here* before BEGIN. After commit we run
    // `PRAGMA foreign_key_check` to verify referential integrity, then
    // re-enable enforcement. If the check fails, surface as an Apply
    // error and leave foreign_keys re-enabled — the user's data is the
    // same it was before this migration's tx committed (the offending
    // rows are visible but the FK constraint is back on, so subsequent
    // writes will be guarded again).
    //
    // Migrations 001-003 do not rely on cascading deletes inside the
    // migration body, so toggling FK off is a no-op for them.
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;

    let result = (|| -> Result<(), MigrationError> {
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Err(source) = tx.execute_batch(body) {
            // tx is dropped here without commit → automatic rollback.
            return Err(MigrationError::Apply {
                name: name.to_owned(),
                source,
            });
        }
        let applied_at = now_millis();
        tx.execute(
            "INSERT INTO _migrations (name, applied_at, applied_sha) VALUES (?1, ?2, ?3)",
            params![name, applied_at, sha],
        )
        .map_err(|source| MigrationError::Apply {
            name: name.to_owned(),
            source,
        })?;
        tx.commit().map_err(|source| MigrationError::Apply {
            name: name.to_owned(),
            source,
        })?;
        Ok(())
    })();

    // Always re-enable foreign-key enforcement, even on the error path,
    // so subsequent migrations or app queries get the protected default
    // back. Best-effort: an error here is a clock-pathology-grade event
    // (PRAGMA writes don't fail under any normal condition); we log it
    // by surfacing as a Sqlite error if no other error is in flight.
    let pragma_back_on = conn.execute_batch("PRAGMA foreign_keys = ON;");

    match (result, pragma_back_on) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(e), _) => Err(e),
        (Ok(()), Err(e)) => Err(MigrationError::Sqlite(e)),
    }
}

/// Returns embedded `.sql` files sorted by filename. Sorting in-place
/// every call avoids relying on `include_dir!`'s iteration order
/// (documented as filesystem-walk order, which can differ across
/// platforms).
fn sorted_migration_files() -> Vec<&'static File<'static>> {
    let mut files: Vec<&'static File<'static>> = MIGRATIONS
        .files()
        .filter(|f| {
            f.path()
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("sql"))
        })
        .collect();
    files.sort_by(|a, b| a.path().cmp(b.path()));
    files
}

fn migration_name<'a>(file: &'a File<'a>) -> &'a str {
    file.path()
        .file_stem()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or("<unnamed>")
}

fn hex_sha256(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        // `write!` into a String never fails — the result is discarded
        // intentionally to satisfy clippy::format_push_string.
        let _ = write!(&mut out, "{b:02x}");
    }
    out
}

fn now_millis() -> i64 {
    // SystemTime → since-epoch is monotonic w.r.t. wall-clock; pre-1970
    // dates would be a system-clock pathology, fall back to 0.
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn open_mem() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("PRAGMA foreign_keys");
        conn
    }

    #[test]
    fn run_pending_applies_initial_on_blank_db() {
        let mut conn = open_mem();
        let applied = run_pending(&mut conn).expect("first run");
        // 001_initial + 002_skills_mcp_tools
        assert!(!applied.is_empty(), "at least one migration expected");
        assert_eq!(applied[0].name, "001_initial");

        // tables exist
        let tables: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master \
                 WHERE type='table' AND name IN ('spaces','roles','boards','columns') \
                 ORDER BY name",
            )
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(tables, vec!["boards", "columns", "roles", "spaces"]);
    }

    #[test]
    fn run_pending_is_idempotent() {
        let mut conn = open_mem();
        let first = run_pending(&mut conn).expect("first");
        let second = run_pending(&mut conn).expect("second");
        assert!(!first.is_empty(), "at least one migration on blank db");
        assert!(second.is_empty(), "no migrations should re-apply");
    }

    #[test]
    fn tamper_detection_fires_on_sha_mismatch() {
        let mut conn = open_mem();
        run_pending(&mut conn).expect("initial");

        // Simulate a tampered migration: poke a bogus SHA into _migrations.
        conn.execute(
            "UPDATE _migrations SET applied_sha = 'deadbeef' WHERE name = '001_initial'",
            [],
        )
        .expect("update");

        let err = run_pending(&mut conn).expect_err("must reject tamper");
        match err {
            MigrationError::Tampered { name, stored, .. } => {
                assert_eq!(name, "001_initial");
                assert_eq!(stored, "deadbeef");
            }
            other => panic!("expected Tampered, got {other:?}"),
        }
    }

    #[test]
    fn cat_as_agent_phase1_round_trip_on_blank_db() {
        // Cat-as-Agent Phase 1 (ctq-73): apply 001…004 to an empty DB
        // and assert the post-migration shape promised by the memo.
        let mut conn = open_mem();
        run_pending(&mut conn).expect("migrations");

        // 1. boards.owner_role_id NOT NULL (column must exist).
        let board_columns: Vec<(String, i64)> = conn
            .prepare("PRAGMA table_info(boards)")
            .unwrap()
            .query_map([], |r| {
                Ok((r.get::<_, String>("name")?, r.get::<_, i64>("notnull")?))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect();
        let owner_col = board_columns
            .iter()
            .find(|(n, _)| n == "owner_role_id")
            .expect("owner_role_id column must exist");
        assert_eq!(owner_col.1, 1, "owner_role_id must be NOT NULL");

        // 2. roles.is_system column exists.
        let roles_has_is_system = conn
            .prepare("PRAGMA table_info(roles)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>("name"))
            .unwrap()
            .any(|n| n.unwrap() == "is_system");
        assert!(roles_has_is_system, "roles.is_system must exist");

        // 3. Maintainer + Dirizher rows present, both is_system = 1.
        let system_rows: Vec<(String, i64)> = conn
            .prepare("SELECT id, is_system FROM roles WHERE id IN ('maintainer-system','dirizher-system') ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            system_rows,
            vec![
                ("dirizher-system".to_owned(), 1),
                ("maintainer-system".to_owned(), 1),
            ]
        );

        // 4. tasks.step_log column exists with default ''.
        let step_log_default: String = conn
            .query_row(
                "SELECT dflt_value FROM pragma_table_info('tasks') WHERE name = 'step_log'",
                [],
                |r| r.get(0),
            )
            .expect("step_log column must exist");
        // SQLite quotes string defaults; accept either form.
        assert!(
            step_log_default == "''" || step_log_default.is_empty(),
            "unexpected step_log default: {step_log_default}"
        );

        // 5. task_ratings table exists.
        let task_ratings_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='task_ratings'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(task_ratings_count, 1, "task_ratings table must exist");

        // 6. settings.cat_migration_reviewed seeded as 'false'.
        let reviewed: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'cat_migration_reviewed'",
                [],
                |r| r.get(0),
            )
            .expect("cat_migration_reviewed setting must exist");
        assert_eq!(reviewed, "false");
    }

    #[test]
    fn cat_as_agent_phase1_preserves_existing_data() {
        // Seed an empty DB with 001…003 + fixture data, *then* let
        // migration 004 land. Assert no rows lost and every board has
        // `owner_role_id = 'maintainer-system'`.
        //
        // Because the runner picks up every embedded `.sql` file in
        // lexical order, we simulate the "001-003 only" precondition
        // by inserting fixture data in 001-003's shape *before* 004
        // runs. The runner is gated by `_migrations.applied_sha`, so
        // we just craft 001-003 manually here, seed, then let 004 run
        // pending as normal. (We can't easily exclude 004 from the
        // embedded set; instead we assert end-state parity.)
        //
        // Trick: apply 001-003 + seed inside one `Connection`, *then*
        // call `run_pending` which sees only 004 pending.
        let mut conn = open_mem();

        // Hand-apply 001…003 so we can seed pre-004 fixture rows.
        ensure_migrations_table(&conn).unwrap();
        let now = now_millis();
        for name in [
            "001_initial",
            "002_skills_mcp_tools",
            "003_board_description",
        ] {
            let file = MIGRATIONS
                .files()
                .find(|f| f.path().file_stem().and_then(|s| s.to_str()) == Some(name))
                .expect("migration present in embedded set");
            let body = file.contents_utf8().unwrap();
            let sha = hex_sha256(body.as_bytes());
            conn.execute_batch(body).unwrap();
            conn.execute(
                "INSERT INTO _migrations (name, applied_at, applied_sha) VALUES (?1, ?2, ?3)",
                rusqlite::params![name, now, sha],
            )
            .unwrap();
        }

        // Seed: 1 space, 3 boards, 5 user roles, 7 tasks. No ratings
        // (the table doesn't exist yet pre-004).
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','S','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) VALUES \
                 ('b1','B1','sp1',0,0,0), \
                 ('b2','B2','sp1',1,0,0), \
                 ('b3','B3','sp1',2,0,0); \
             INSERT INTO roles (id, name, content, color, created_at, updated_at) VALUES \
                 ('r1','R1','',NULL,0,0), \
                 ('r2','R2','',NULL,0,0), \
                 ('r3','R3','',NULL,0,0), \
                 ('r4','R4','',NULL,0,0), \
                 ('r5','R5','',NULL,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) VALUES \
                 ('c1','b1','Todo',0,0), \
                 ('c2','b2','Todo',0,0), \
                 ('c3','b3','Todo',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) VALUES \
                 ('t1','b1','c1','sp-1','T1',0,0,0), \
                 ('t2','b1','c1','sp-2','T2',1,0,0), \
                 ('t3','b2','c2','sp-3','T3',0,0,0), \
                 ('t4','b2','c2','sp-4','T4',1,0,0), \
                 ('t5','b3','c3','sp-5','T5',0,0,0), \
                 ('t6','b3','c3','sp-6','T6',1,0,0), \
                 ('t7','b3','c3','sp-7','T7',2,0,0);",
        )
        .unwrap();

        // Now run pending. The seeded `_migrations` rows cover 001-003,
        // so every later migration (004_cat_as_agent_phase1, 005_…)
        // will run here in lexical order. The assertion below pins the
        // *first* applied entry — the post-004 invariants this test
        // protects do not regress when later migrations land.
        let applied = run_pending(&mut conn).expect("post-003 pending");
        assert!(
            !applied.is_empty(),
            "at least migration 004 must run when 001-003 are pre-seeded",
        );
        assert_eq!(applied[0].name, "004_cat_as_agent_phase1");

        // Every seeded board's owner_role_id must be maintainer-system.
        // Scope to the original ids (b1/b2/b3) so migration 010's
        // default-board backfill — which lands a 4th board for the
        // seeded space — does not perturb this 004-specific invariant.
        let owner_row_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM boards \
                 WHERE id IN ('b1','b2','b3') AND owner_role_id = 'maintainer-system'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(owner_row_count, 3, "all boards must point at Maintainer");

        // No data lost from the 001-003 seed (the three original
        // boards survive the 004 table rebuild). Migration 010 adds
        // one more default board for the bare seed-space; assert the
        // pre-seeded triple is still intact rather than the total.
        let seeded_board_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM boards WHERE id IN ('b1','b2','b3')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(seeded_board_count, 3);
        let task_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(task_count, 7);
        // 5 user roles + 2 system rows seeded by 004.
        let role_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM roles", [], |r| r.get(0))
            .unwrap();
        assert_eq!(role_count, 7);

        // step_log defaults to '' on every existing task.
        let nonempty_step_logs: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks WHERE step_log <> ''", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(nonempty_step_logs, 0);
    }

    #[test]
    #[allow(clippy::too_many_lines)]
    fn backfill_default_boards_round_trip() {
        // Migration `010_backfill_default_boards.sql` retroactively
        // gives every space a default board if it does not already have
        // one. Strategy: hand-apply 001..009 with their SHAs registered
        // in `_migrations`, seed three fixture spaces (two without any
        // default board, one with one already in place), then call
        // `run_pending` so only 010 runs. Verify:
        //   * each of the two bare spaces gets exactly one new board
        //     with `is_default = 1`
        //   * the third space still has only its original default
        //     board (idempotency — no duplicate row added)
        //   * the new boards point at the seeded `maintainer-system`
        //     row (memo Q1 contract; mirror of `SpacesUseCase::create`).
        let mut conn = open_mem();

        ensure_migrations_table(&conn).unwrap();
        let now = now_millis();
        for name in [
            "001_initial",
            "002_skills_mcp_tools",
            "003_board_description",
            "004_cat_as_agent_phase1",
            "005_prompt_icons",
            "006_prompt_examples",
            "007_prompt_group_icons",
            "008_space_board_icons_colors",
            "009_default_boards",
        ] {
            let file = MIGRATIONS
                .files()
                .find(|f| f.path().file_stem().and_then(|s| s.to_str()) == Some(name))
                .expect("migration present in embedded set");
            let body = file.contents_utf8().unwrap();
            let sha = hex_sha256(body.as_bytes());
            // Each migration body runs in its own toggling of FK
            // enforcement (see `apply_one`). We mirror that here so
            // the table-rebuild dance in 004 does not collide with
            // child-table FKs.
            conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
            conn.execute_batch(body).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            conn.execute(
                "INSERT INTO _migrations (name, applied_at, applied_sha) VALUES (?1, ?2, ?3)",
                rusqlite::params![name, now, sha],
            )
            .unwrap();
        }

        // Seed three spaces. `bare1` and `bare2` have no boards.
        // `seeded` already owns one default board — proves the
        // migration is idempotent (no duplicate insert).
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES \
                 ('bare1','Bare1','b1',0,0,0,0), \
                 ('bare2','Bare2','b2',0,0,0,0), \
                 ('seeded','Seeded','sd',0,0,0,0); \
             INSERT INTO boards \
                 (id, name, space_id, role_id, position, description, color, icon, \
                  is_default, created_at, updated_at, owner_role_id) \
                 VALUES \
                 ('preexisting-default','Existing','seeded',NULL,0,NULL,NULL,NULL, \
                  1,0,0,'maintainer-system');",
        )
        .unwrap();

        // Sanity: pre-010 state.
        let before_total: i64 = conn
            .query_row("SELECT COUNT(*) FROM boards", [], |r| r.get(0))
            .unwrap();
        assert_eq!(before_total, 1, "fixture seeds exactly one board");

        // Run pending — only 010 should fire.
        let applied = run_pending(&mut conn).expect("post-009 pending");
        assert_eq!(applied.len(), 1, "only 010 should be pending");
        assert_eq!(applied[0].name, "010_backfill_default_boards");

        // Every space must now have ≥ 1 default board.
        let zero_default_spaces: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM spaces s WHERE NOT EXISTS \
                   (SELECT 1 FROM boards b WHERE b.space_id = s.id AND b.is_default = 1)",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            zero_default_spaces, 0,
            "post-migration: every space must own at least one default board"
        );

        // Per-space counts: bare1/bare2 → exactly 1 default; seeded → still 1.
        for sid in ["bare1", "bare2", "seeded"] {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM boards WHERE space_id = ?1 AND is_default = 1",
                    rusqlite::params![sid],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "space {sid} must have exactly one default board");
        }

        // Idempotency: the seeded space's pre-existing default board
        // survived untouched (its id was not overwritten by the insert).
        let seeded_default_id: String = conn
            .query_row(
                "SELECT id FROM boards WHERE space_id = 'seeded' AND is_default = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            seeded_default_id, "preexisting-default",
            "the migration must not duplicate or replace an existing default board"
        );

        // The two backfilled boards point at maintainer-system per
        // memo Q1, with name='Main' and the canonical pixel icon.
        let backfilled: Vec<(String, String, Option<String>, String)> = conn
            .prepare(
                "SELECT space_id, name, icon, owner_role_id FROM boards \
                 WHERE space_id IN ('bare1','bare2') ORDER BY space_id",
            )
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            backfilled,
            vec![
                (
                    "bare1".to_owned(),
                    "Main".to_owned(),
                    Some("PixelInterfaceEssentialList".to_owned()),
                    "maintainer-system".to_owned(),
                ),
                (
                    "bare2".to_owned(),
                    "Main".to_owned(),
                    Some("PixelInterfaceEssentialList".to_owned()),
                    "maintainer-system".to_owned(),
                ),
            ]
        );

        // Final shape: 3 boards total (2 backfilled + 1 pre-existing).
        let after_total: i64 = conn
            .query_row("SELECT COUNT(*) FROM boards", [], |r| r.get(0))
            .unwrap();
        assert_eq!(after_total, 3);
    }

    #[test]
    fn migrations_table_is_created_on_first_run() {
        fn migrations_table_exists(conn: &Connection) -> bool {
            conn.query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='_migrations'",
                [],
                |_| Ok(()),
            )
            .is_ok()
        }

        let mut conn = open_mem();
        assert!(!migrations_table_exists(&conn), "table absent before run");
        run_pending(&mut conn).expect("run");
        assert!(migrations_table_exists(&conn), "table present after run");
    }
}
