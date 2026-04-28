//! SQLite connection pool.
//!
//! NFR §3.3 dictates the timing knobs:
//!   * pool acquire — 500 ms (enforced by [`Pool::get_timeout`]).
//!   * SQLite `busy_timeout` — 5 000 ms (PRAGMA, per-connection).
//!
//! Pool size is fixed at 4 connections. SQLite is single-writer at the
//! engine level, so a larger pool just lets readers stack up while the
//! writer is busy; 4 is enough for the desktop workload (1 UI-thread
//! command + 1 background indexer + 2 head-room).

use std::path::Path;
use std::time::Duration;

use r2d2::{CustomizeConnection, ManageConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;

/// Pool acquire timeout. Per NFR §3.3.
pub const POOL_ACQUIRE_TIMEOUT: Duration = Duration::from_millis(500);

/// SQLite `busy_timeout` PRAGMA value. Per NFR §3.3.
pub const SQLITE_BUSY_TIMEOUT_MS: u32 = 5_000;

/// Number of pooled connections. Justified in module docs.
pub const POOL_SIZE: u32 = 4;

/// Public alias — keeps the r2d2 generic out of caller signatures.
pub type Pool = r2d2::Pool<SqliteConnectionManager>;

/// Storage-layer errors surfaced to the application layer.
///
/// Translated to `AppError` in the use-case layer; the split avoids a
/// reverse dependency from `infrastructure` onto `api`.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    /// Pool failed to acquire a connection within [`POOL_ACQUIRE_TIMEOUT`].
    /// Typically maps to `AppError::DbBusy` per NFR §3.3.
    #[error("pool acquire timed out after {0:?}")]
    PoolTimeout(Duration),

    /// r2d2 reported an internal pool error (config / connect failure).
    #[error("connection pool error: {0}")]
    Pool(#[from] r2d2::Error),

    /// rusqlite returned an error.
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// I/O error opening the DB file's parent directory.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

/// Connection customiser: applies the per-connection PRAGMA contract.
///
/// r2d2 calls [`Self::on_acquire`] once per *new* connection (not on
/// every checkout), which is exactly the cadence we want — the PRAGMA
/// state survives for the connection's lifetime in WAL mode.
#[derive(Debug)]
struct ApplyPragmas;

impl CustomizeConnection<Connection, rusqlite::Error> for ApplyPragmas {
    fn on_acquire(&self, conn: &mut Connection) -> Result<(), rusqlite::Error> {
        // WAL gives us concurrent readers + 1 writer (NFR §3.2 ACID under
        // crash). `journal_mode` is a query PRAGMA — must use `query_row`,
        // not `execute`, or rusqlite will warn about the unread result.
        // In-memory DBs ignore the request and stay on the `memory`
        // journal mode; we silently accept that — the assertion is just
        // a debug aid for file-backed DBs that should always end in WAL.
        let mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
        debug_assert!(
            matches!(mode.to_ascii_lowercase().as_str(), "wal" | "memory"),
            "unexpected journal_mode: {mode}"
        );

        // FK enforcement is **off** by default in SQLite; turning it on
        // every connection is the only safe way (it doesn't persist).
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;

        // 5 s busy timeout (NFR §3.3); the pool's 500 ms acquire timeout
        // sits on top — see module-level docs.
        conn.busy_timeout(Duration::from_millis(u64::from(SQLITE_BUSY_TIMEOUT_MS)))?;
        Ok(())
    }
}

/// Construct a fresh pool against the SQLite file at `path`.
///
/// Creates the parent directory if missing. The first acquire from the
/// returned pool also creates the DB file itself (rusqlite default).
///
/// # Errors
///
/// Returns [`DbError::Io`] if the parent directory cannot be created,
/// [`DbError::Pool`] if r2d2 cannot configure the pool (e.g. min-idle
/// connection setup fails), or [`DbError::Sqlite`] if the initial PRAGMA
/// run fails.
pub fn open(path: &Path) -> Result<Pool, DbError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let manager = SqliteConnectionManager::file(path);
    build_pool(manager)
}

/// Build a pool from a pre-constructed manager. Useful for in-memory
/// tests that need `SqliteConnectionManager::memory()`.
///
/// # Errors
///
/// Returns [`DbError::Pool`] if r2d2's builder rejects the
/// configuration (e.g. min-idle eager connect fails). Sqlite/IO errors
/// from individual customise-on-connect cycles propagate as
/// [`DbError::Pool`] too — the inner cause is `r2d2::Error`.
pub fn build_pool(manager: SqliteConnectionManager) -> Result<Pool, DbError> {
    let pool = r2d2::Pool::builder()
        .max_size(POOL_SIZE)
        .connection_timeout(POOL_ACQUIRE_TIMEOUT)
        .connection_customizer(Box::new(ApplyPragmas))
        .build(manager)?;
    Ok(pool)
}

/// Helper: try to acquire a connection, mapping the timeout case to the
/// dedicated [`DbError::PoolTimeout`] so callers can render a `DbBusy`
/// `AppError` (NFR §3.3 retry-hint).
///
/// # Errors
///
/// See [`DbError`].
pub fn acquire(pool: &Pool) -> Result<r2d2::PooledConnection<SqliteConnectionManager>, DbError> {
    pool.get_timeout(POOL_ACQUIRE_TIMEOUT).map_err(|err| {
        // r2d2::Error doesn't preserve a typed Timeout case; matching on
        // `Display` is fragile, so we treat *any* acquire-timeout-window
        // miss as PoolTimeout. r2d2 itself only returns `Error` from
        // `get_timeout` when the wait elapsed (per docs).
        let _ = err;
        DbError::PoolTimeout(POOL_ACQUIRE_TIMEOUT)
    })
}

/// Open a transient in-memory pool for tests. Always size = 1 because
/// memory DBs are per-connection — sharing requires `:memory:` URIs which
/// behave differently across rusqlite versions and add no test value.
#[doc(hidden)]
#[must_use]
pub fn memory_pool_for_tests() -> Pool {
    let manager = SqliteConnectionManager::memory();
    let pool = r2d2::Pool::builder()
        .max_size(1)
        .connection_timeout(POOL_ACQUIRE_TIMEOUT)
        .connection_customizer(Box::new(ApplyPragmas))
        .build(manager)
        .expect("in-memory pool builder cannot fail with size=1");
    let _ = pool
        .get()
        .expect("first acquire on a fresh in-memory pool cannot fail");
    pool
}

// Static type-assertion: keeps SqliteConnectionManager wired to r2d2's
// trait set so a future r2d2_sqlite bump that drops the impl trips this
// at compile time rather than at first runtime acquire.
#[allow(dead_code)]
const _ASSERT_MANAGER: fn() = || {
    fn assert_manage<M: ManageConnection>() {}
    assert_manage::<SqliteConnectionManager>();
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pragmas_applied_to_new_connection() {
        let pool = memory_pool_for_tests();
        let conn = pool.get().expect("acquire");
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .expect("foreign_keys query");
        assert_eq!(fk, 1, "foreign_keys must be ON");

        // `journal_mode` is per-DB; in-memory DBs report `memory`. We
        // accept either `wal` (file-backed) or `memory` (in-RAM) so the
        // test stays meaningful in both modes.
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .expect("journal_mode");
        let mode_lc = mode.to_ascii_lowercase();
        assert!(
            mode_lc == "wal" || mode_lc == "memory",
            "unexpected journal_mode: {mode}"
        );
    }

    #[test]
    fn open_creates_parent_directory() {
        let tmp = tempdir_for_tests();
        let nested = tmp.join("a").join("b").join("catique.db");
        let pool = open(&nested).expect("open should create parents");
        let _ = pool.get().expect("acquire");
        assert!(nested.parent().unwrap().exists());
    }

    /// Tiny in-process tempdir — avoids pulling in the `tempfile` crate
    /// for one test. Path is unique per process via std::env::temp_dir
    /// + a nanosecond suffix.
    fn tempdir_for_tests() -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.subsec_nanos());
        let dir = std::env::temp_dir().join(format!("catique-pool-test-{nanos}"));
        std::fs::create_dir_all(&dir).expect("create tmp");
        dir
    }
}
