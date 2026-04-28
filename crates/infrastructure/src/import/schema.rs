//! Embedded Promptery v0.4 schema bundle + canonical D-019 hash.
//!
//! At compile time we embed `schemas/promptery-v0.4-schema.sql` plus the
//! 15 ordered migration files. The bundle is used for:
//!
//! 1. **PF-4 (preflight schema-drift check):** compute the SHA-256 of
//!    the source DB's `_migrations` ledger + dumped schema and compare
//!    to [`EXPECTED_SOURCE_SCHEMA_HASH`].
//! 2. **Documentation / golden self-test:** the
//!    `compute_expected_hash_matches_d019` test recomputes the hash from
//!    the embedded files and asserts it equals the constant.
//!
//! The hash algorithm is fixed by D-019 §"Алгоритм воспроизведения hash":
//!
//! ```text
//! sha256( schema.sql || migrations[sorted asc by filename] )
//! ```
//!
//! Files inside the `migrations/` directory are sorted ASCII-asc by file
//! stem; the schema file is fed in first as-is.

use std::path::Path;

use include_dir::{include_dir, Dir, File};
use rusqlite::Connection;
use sha2::{Digest, Sha256};

use super::ImportError;

/// Canonical schema hash from D-019 (frozen 2026-04-28).
///
/// Updating this constant requires a paired decision-log entry per the
/// D-021 Q-3 schema-drift policy.
pub const EXPECTED_SOURCE_SCHEMA_HASH: &str =
    "38b7a2367fdac911d69330e19b841bf43b33302ff494998bb797783fc94ab138";

/// Embedded Promptery v0.4 schema files. Path relative to this Cargo
/// manifest so `cargo` watches them automatically.
static SCHEMA_BUNDLE: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/src/import/schemas");

/// Recompute the canonical D-019 hash from the embedded bundle.
///
/// The result must always equal [`EXPECTED_SOURCE_SCHEMA_HASH`]; the
/// `compute_expected_hash_matches_d019` test enforces that at compile
/// time. Exposed publicly so the IPC `detect_promptery_db` command can
/// reuse it as a sanity tag in `PrompteryDbInfo.schema_hash`.
///
/// # Panics
///
/// Panics only if the embedded bundle was somehow built without the
/// `promptery-v0.4-schema.sql` file — which would be a build-system bug
/// caught by the test below.
#[must_use]
pub fn embedded_schema_hash() -> String {
    let mut hasher = Sha256::new();
    let schema = SCHEMA_BUNDLE
        .get_file("promptery-v0.4-schema.sql")
        .expect("embedded promptery-v0.4-schema.sql missing — check src/import/schemas/");
    hasher.update(schema.contents());

    // `migrations/` subdirectory; files iterated in lexical order.
    let migrations = SCHEMA_BUNDLE
        .get_dir("migrations")
        .expect("embedded migrations/ subdir missing");
    let mut files: Vec<&'static File<'static>> = migrations
        .files()
        .filter(|f| {
            f.path()
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("sql"))
        })
        .collect();
    files.sort_by(|a, b| a.path().cmp(b.path()));
    for file in files {
        hasher.update(file.contents());
    }

    hex_digest(&hasher.finalize())
}

/// Compute a runtime fingerprint of the source DB's migration ledger.
///
/// We don't have access to the original `.sql` source files at the
/// user's machine — only the SQLite engine and a populated DB. The
/// canonical source-of-truth available at runtime is the migration
/// ledger (`_migrations` table on Promptery v0.4); its row set encodes
/// which schema migrations have been applied.
///
/// Per D-019 §CI guard recommendation, point 5: "проверка
/// `_migrations.count = 15` и точный набор имён" — this is the
/// fingerprint Catique enforces at PF-4. SQL-level structural drift
/// without a migration bump (the rare hostile case) is caught later by
/// the FK / FTS / row-count post-flight checks.
///
/// Algorithm:
///
/// 1. Locate the migration ledger (`_migrations` for Promptery v0.4).
/// 2. Read every primary-key value sorted ascending.
/// 3. Concatenate them with `\n` separators and SHA-256 the result.
///
/// # Errors
///
/// Returns `ImportError::Sqlite` on read errors against the connection.
/// Returns `ImportError::Validation` if no migration ledger exists —
/// that's a Promptery v0.3 or pre-v0.3 DB and import isn't supported.
pub fn compute_db_schema_fingerprint(conn: &Connection) -> Result<String, ImportError> {
    let ledger_table = pick_ledger_table(conn)?.ok_or_else(|| ImportError::Validation {
        reason: "source DB has no `_migrations` ledger — too old to import".into(),
    })?;
    let key_col = if ledger_table == "_migrations" {
        "name"
    } else {
        "id"
    };
    let sql = format!("SELECT {key_col} FROM {ledger_table} ORDER BY {key_col}");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut hasher = Sha256::new();
    for row in rows {
        hasher.update(row?.as_bytes());
        hasher.update(b"\n");
    }
    Ok(hex_digest(&hasher.finalize()))
}

/// Compute the canonical fingerprint that the source DB *should* have,
/// by enumerating the embedded migration bundle in the same canonical
/// order [`compute_db_schema_fingerprint`] uses.
///
/// Cached so repeated PF-4 invocations don't pay the SQL cost.
///
/// # Errors
///
/// Returns `ImportError::Validation` if the embedded bundle is missing.
pub fn compute_source_schema_hash() -> Result<String, ImportError> {
    use std::sync::OnceLock;
    static CACHE: OnceLock<String> = OnceLock::new();
    if let Some(hit) = CACHE.get() {
        return Ok(hit.clone());
    }

    let migrations_dir = SCHEMA_BUNDLE
        .get_dir("migrations")
        .ok_or_else(|| ImportError::Validation {
            reason: "embedded migrations/ missing".into(),
        })?;
    let mut migration_names: Vec<String> = migrations_dir
        .files()
        .filter_map(|f| {
            f.path()
                .file_stem()
                .and_then(std::ffi::OsStr::to_str)
                .map(str::to_owned)
        })
        .collect();
    migration_names.sort();

    let mut hasher = Sha256::new();
    for name in &migration_names {
        hasher.update(name.as_bytes());
        hasher.update(b"\n");
    }
    let fp = hex_digest(&hasher.finalize());
    let _ = CACHE.set(fp.clone());
    Ok(fp)
}

/// Open a copy of the bundled `.sql` files, returning the schema body
/// and migration bodies (sorted). Used by the sequencer when seeding a
/// brand-new target DB before bulk-inserts.
///
/// # Errors
///
/// Returns `Validation` if the bundle is missing — build-time bug.
pub fn schema_bundle_apply_sql() -> Result<(String, Vec<String>), ImportError> {
    let schema = SCHEMA_BUNDLE
        .get_file("promptery-v0.4-schema.sql")
        .ok_or_else(|| ImportError::Validation {
            reason: "embedded schema missing".into(),
        })?
        .contents_utf8()
        .ok_or_else(|| ImportError::Validation {
            reason: "schema not utf-8".into(),
        })?
        .to_owned();
    let migrations_dir = SCHEMA_BUNDLE
        .get_dir("migrations")
        .ok_or_else(|| ImportError::Validation {
            reason: "embedded migrations/ missing".into(),
        })?;
    let mut files: Vec<&'static File<'static>> = migrations_dir
        .files()
        .filter(|f| {
            f.path()
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("sql"))
        })
        .collect();
    files.sort_by(|a, b| a.path().cmp(b.path()));
    let migrations = files
        .into_iter()
        .map(|f| {
            f.contents_utf8()
                .ok_or_else(|| ImportError::Validation {
                    reason: format!("migration {} not utf-8", f.path().display()),
                })
                .map(str::to_owned)
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok((schema, migrations))
}

/// Convenience: open a connection at `path` in read-only URI form, so
/// the source DB cannot be mutated by accident.
///
/// # Errors
///
/// Returns `ImportError::Sqlite` on open failure.
pub fn open_readonly(path: &Path) -> Result<Connection, ImportError> {
    let uri = format!("file:{}?mode=ro", path.display());
    let conn = Connection::open_with_flags(
        &uri,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )?;
    Ok(conn)
}

fn hex_digest(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(&mut out, "{b:02x}");
    }
    out
}

fn pick_ledger_table(conn: &Connection) -> Result<Option<&'static str>, ImportError> {
    for candidate in ["_migrations", "migrations_applied"] {
        let exists: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
            rusqlite::params![candidate],
            |row| row.get(0),
        )?;
        if exists > 0 {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_hash_matches_d019_constant() {
        assert_eq!(embedded_schema_hash(), EXPECTED_SOURCE_SCHEMA_HASH);
    }

    #[test]
    fn compute_source_schema_hash_is_stable() {
        let a = compute_source_schema_hash().expect("hash a");
        let b = compute_source_schema_hash().expect("hash b");
        assert_eq!(a, b, "fingerprint must be deterministic");
    }

    #[test]
    fn open_readonly_rejects_writes() {
        // Build a tmp DB, then re-open r/o and assert writes fail.
        let tmp = std::env::temp_dir().join(format!(
            "catique-import-ro-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&tmp);
        {
            let rw = Connection::open(&tmp).unwrap();
            rw.execute_batch("CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1);")
                .unwrap();
        }
        let ro = open_readonly(&tmp).expect("ro open");
        let err = ro.execute("INSERT INTO t VALUES (2)", []);
        assert!(err.is_err(), "ro connection must reject INSERT");
        let _ = std::fs::remove_file(&tmp);
    }
}
