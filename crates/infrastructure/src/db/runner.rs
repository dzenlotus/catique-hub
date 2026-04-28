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
