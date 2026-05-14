//! Repository for the `connected_clients` SQL table (migration 021).
//!
//! Row semantics: a row exists iff the user has explicitly added the
//! provider via the `add_provider` IPC. Removal deletes the row after
//! `provider.remove()` succeeds. The previous `enabled` toggle is gone.
//!
//! All methods are pure synchronous SQL over `&Connection`. Async +
//! pool-acquire is the use-case layer's job.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::pool::DbError;

/// One row of the `connected_clients` table — mirrors the column set
/// 1:1. The application-layer use case maps `Self` →
/// `catique_domain::ConnectedClient` (which has the same fields plus
/// the `ConnectionStatus` enum wrapping `connection_status`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectedClientRow {
    pub id: String,
    pub display_name: String,
    /// Wire format: `"connected" | "syncing" | "error"`.
    pub connection_status: String,
    pub last_synced_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_error: Option<String>,
}

impl ConnectedClientRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            display_name: row.get("display_name")?,
            connection_status: row.get("connection_status")?,
            last_synced_at: row.get("last_synced_at")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            last_error: row.get("last_error")?,
        })
    }
}

/// Hard cap on `last_error` length to keep rows bounded. The
/// application layer truncates oversized payloads to this size before
/// reaching the repo.
pub const LAST_ERROR_MAX_LEN: usize = 1_024;

/// List every connected provider, ordered by `(created_at, id)` so the
/// UI shows them in add-order with stable secondary sort.
///
/// # Errors
///
/// Surfaces any rusqlite error.
pub fn list_all(conn: &Connection) -> Result<Vec<ConnectedClientRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, display_name, connection_status, last_synced_at, \
                created_at, updated_at, last_error \
         FROM connected_clients \
         ORDER BY created_at ASC, id ASC",
    )?;
    let rows = stmt.query_map([], ConnectedClientRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Look up by primary key.
///
/// # Errors
///
/// Surfaces non-`QueryReturnedNoRows` errors.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<ConnectedClientRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, display_name, connection_status, last_synced_at, \
                created_at, updated_at, last_error \
         FROM connected_clients WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], ConnectedClientRow::from_row)
        .optional()?)
}

/// Insert a new provider row. Caller stamps `created_at` /
/// `updated_at`. Initial `connection_status` defaults to `"connected"`
/// because we only insert AFTER a successful initial sync.
///
/// # Errors
///
/// Constraint violation (PK collision) surfaces as
/// [`DbError::Sqlite`]; the use-case layer maps it to
/// `AppError::Conflict`.
pub fn insert(
    conn: &Connection,
    id: &str,
    display_name: &str,
    now_ms: i64,
) -> Result<ConnectedClientRow, DbError> {
    conn.execute(
        "INSERT INTO connected_clients \
            (id, display_name, connection_status, last_synced_at, \
             created_at, updated_at, last_error) \
         VALUES (?1, ?2, 'connected', ?3, ?3, ?3, NULL)",
        params![id, display_name, now_ms],
    )?;
    Ok(ConnectedClientRow {
        id: id.to_owned(),
        display_name: display_name.to_owned(),
        connection_status: "connected".into(),
        last_synced_at: now_ms,
        created_at: now_ms,
        updated_at: now_ms,
        last_error: None,
    })
}

/// Update the connection status for a provider. `last_error` is
/// truncated to [`LAST_ERROR_MAX_LEN`] characters before storage.
/// Bumps `updated_at`. Returns `true` if a row matched.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn set_status(
    conn: &Connection,
    id: &str,
    status: &str,
    last_error: Option<&str>,
    now_ms: i64,
) -> Result<bool, DbError> {
    let truncated = last_error.map(|s| {
        if s.len() <= LAST_ERROR_MAX_LEN {
            s.to_owned()
        } else {
            // Truncate at a UTF-8 boundary to avoid panics — find the
            // largest char-boundary ≤ `LAST_ERROR_MAX_LEN`.
            let mut end = LAST_ERROR_MAX_LEN;
            while !s.is_char_boundary(end) {
                end -= 1;
            }
            s[..end].to_owned()
        }
    });
    let n = conn.execute(
        "UPDATE connected_clients \
         SET connection_status = ?1, last_error = ?2, updated_at = ?3 \
         WHERE id = ?4",
        params![status, truncated, now_ms, id],
    )?;
    Ok(n > 0)
}

/// Stamp `last_synced_at` (and clear `last_error`) for a successful
/// sync. Returns `true` if a row matched.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn mark_synced(conn: &Connection, id: &str, now_ms: i64) -> Result<bool, DbError> {
    let n = conn.execute(
        "UPDATE connected_clients \
         SET connection_status = 'connected', last_error = NULL, \
             last_synced_at = ?1, updated_at = ?1 \
         WHERE id = ?2",
        params![now_ms, id],
    )?;
    Ok(n > 0)
}

/// Delete a provider row. Returns `true` if a row was removed.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM connected_clients WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;
    use rusqlite::Connection;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open mem");
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn
    }

    #[test]
    fn insert_then_get_returns_row() {
        let conn = fresh_db();
        let row = insert(&conn, "claude-code", "Claude Code", 1_000).unwrap();
        let got = get_by_id(&conn, "claude-code").unwrap().unwrap();
        assert_eq!(row, got);
        assert_eq!(got.connection_status, "connected");
        assert_eq!(got.last_error, None);
    }

    #[test]
    fn list_all_returns_in_created_order() {
        let conn = fresh_db();
        insert(&conn, "b", "B", 2_000).unwrap();
        insert(&conn, "a", "A", 1_000).unwrap();
        let ids: Vec<String> = list_all(&conn).unwrap().into_iter().map(|r| r.id).collect();
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = fresh_db();
        insert(&conn, "a", "A", 1_000).unwrap();
        assert!(delete(&conn, "a").unwrap());
        assert!(!delete(&conn, "a").unwrap());
        assert!(get_by_id(&conn, "a").unwrap().is_none());
    }

    #[test]
    fn set_status_truncates_oversized_error() {
        let conn = fresh_db();
        insert(&conn, "a", "A", 1_000).unwrap();
        let big = "x".repeat(LAST_ERROR_MAX_LEN + 100);
        set_status(&conn, "a", "error", Some(&big), 2_000).unwrap();
        let got = get_by_id(&conn, "a").unwrap().unwrap();
        assert_eq!(got.connection_status, "error");
        assert_eq!(got.last_error.unwrap().len(), LAST_ERROR_MAX_LEN);
    }

    #[test]
    fn mark_synced_clears_error() {
        let conn = fresh_db();
        insert(&conn, "a", "A", 1_000).unwrap();
        set_status(&conn, "a", "error", Some("boom"), 1_500).unwrap();
        mark_synced(&conn, "a", 2_000).unwrap();
        let got = get_by_id(&conn, "a").unwrap().unwrap();
        assert_eq!(got.connection_status, "connected");
        assert_eq!(got.last_error, None);
        assert_eq!(got.last_synced_at, 2_000);
    }

    #[test]
    fn primary_key_violation_surfaces_as_constraint() {
        let conn = fresh_db();
        insert(&conn, "a", "A", 1_000).unwrap();
        let err = insert(&conn, "a", "A2", 1_500).expect_err("PK violation");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("expected ConstraintViolation, got {other:?}"),
        }
    }
}
