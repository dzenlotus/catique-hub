//! MCP call-log repository — observability rows for proxied tool calls.
//!
//! Schema: `024_mcp_call_log.sql`. The seven-day rolling window is
//! enforced by an AFTER-INSERT trigger; this module never DELETEs
//! directly.
//!
//! Lifecycle:
//!   1. `open_call` — caller about to issue a `proxy_tool_call` writes
//!      an in-flight row (`finished_at = NULL`, `success = NULL`).
//!   2. On completion the caller invokes `finalize_call` with the
//!      outcome and byte counts.
//!
//! Crash-safety: if the host process exits between `open_call` and
//! `finalize_call`, the row stays in flight with `success = NULL`. The
//! UI must treat NULL as "unknown / interrupted", not as "in progress
//! still". Status queries filter NULL-success rows older than 5s out
//! of "currently-running" and into "interrupted".
//!
//! Secrets: `error` and `tool_name` are caller-controlled; the
//! application layer must NEVER pass a resolved secret into either
//! field. The trigger and indexes do not log row contents.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of `mcp_call_log`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpCallLogRow {
    pub id: String,
    pub server_id: String,
    pub tool_name: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub success: Option<bool>,
    pub error: Option<String>,
    pub bytes_in: Option<i64>,
    pub bytes_out: Option<i64>,
}

impl McpCallLogRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let success: Option<i64> = row.get("success")?;
        Ok(Self {
            id: row.get("id")?,
            server_id: row.get("server_id")?,
            tool_name: row.get("tool_name")?,
            started_at: row.get("started_at")?,
            finished_at: row.get("finished_at")?,
            success: success.map(|n| n != 0),
            error: row.get("error")?,
            bytes_in: row.get("bytes_in")?,
            bytes_out: row.get("bytes_out")?,
        })
    }
}

/// Open an in-flight call row. Returns the new id (the caller passes
/// it to `finalize_call` later).
///
/// # Errors
///
/// Surfaces rusqlite errors (FK violation if `server_id` is unknown).
pub fn open_call(conn: &Connection, server_id: &str, tool_name: &str) -> Result<String, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO mcp_call_log \
         (id, server_id, tool_name, started_at, finished_at, success, error, bytes_in, bytes_out) \
         VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, NULL, NULL)",
        params![id, server_id, tool_name, now],
    )?;
    Ok(id)
}

/// Outcome payload for `finalize_call`.
#[derive(Debug, Clone)]
pub struct CallOutcome {
    pub success: bool,
    pub error: Option<String>,
    pub bytes_in: Option<i64>,
    pub bytes_out: Option<i64>,
}

/// Finalise an in-flight row. The caller is expected to construct
/// `CallOutcome` from the upstream reply (or the local error). The
/// `finished_at` is stamped to `now_millis()` here, not from the
/// caller's clock — proxied-call wall-clock is what we want.
///
/// # Errors
///
/// Surfaces rusqlite errors. Updating an already-finalised row is a
/// no-op (idempotent for retries).
pub fn finalize_call(conn: &Connection, id: &str, outcome: &CallOutcome) -> Result<(), DbError> {
    let now = now_millis();
    conn.execute(
        "UPDATE mcp_call_log \
         SET finished_at = ?1, success = ?2, error = ?3, bytes_in = ?4, bytes_out = ?5 \
         WHERE id = ?6 AND finished_at IS NULL",
        params![
            now,
            i64::from(outcome.success),
            outcome.error,
            outcome.bytes_in,
            outcome.bytes_out,
            id,
        ],
    )?;
    Ok(())
}

/// Most recent call for `server_id`. Backs the per-server status dot.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn latest_for_server(
    conn: &Connection,
    server_id: &str,
) -> Result<Option<McpCallLogRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, server_id, tool_name, started_at, finished_at, success, error, bytes_in, bytes_out \
         FROM mcp_call_log \
         WHERE server_id = ?1 \
         ORDER BY started_at DESC \
         LIMIT 1",
    )?;
    Ok(stmt
        .query_row(params![server_id], McpCallLogRow::from_row)
        .optional()?)
}

/// Count of failed calls for `server_id` within the last `window_ms`.
/// Used by the per-server failure counter (PROXY-S3 / S4 use it to
/// flip status to `Degraded`).
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn failure_count_within(
    conn: &Connection,
    server_id: &str,
    window_ms: i64,
) -> Result<i64, DbError> {
    let since = now_millis().saturating_sub(window_ms);
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM mcp_call_log \
         WHERE server_id = ?1 AND started_at >= ?2 AND success = 0",
        params![server_id, since],
        |row| row.get(0),
    )?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repositories::mcp_servers::{
        insert as insert_server, McpServerDraft, TransportKind,
    };
    use crate::db::runner::run_pending;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn
    }

    fn seed_server(conn: &Connection, id_hint: &str) -> String {
        let row = insert_server(
            conn,
            &McpServerDraft {
                name: format!("srv-{id_hint}"),
                transport: TransportKind::Http,
                url: Some(format!("https://api.example.com/{id_hint}")),
                command: None,
                auth_json: None,
                enabled: true,
            },
        )
        .unwrap();
        row.id
    }

    #[test]
    fn open_then_finalize_round_trip() {
        let conn = fresh_db();
        let server_id = seed_server(&conn, "a");
        let id = open_call(&conn, &server_id, "search").unwrap();
        finalize_call(
            &conn,
            &id,
            &CallOutcome {
                success: true,
                error: None,
                bytes_in: Some(42),
                bytes_out: Some(128),
            },
        )
        .unwrap();
        let latest = latest_for_server(&conn, &server_id).unwrap().unwrap();
        assert_eq!(latest.tool_name, "search");
        assert_eq!(latest.success, Some(true));
        assert_eq!(latest.bytes_in, Some(42));
    }

    #[test]
    fn finalize_is_idempotent_on_already_finalized_row() {
        let conn = fresh_db();
        let server_id = seed_server(&conn, "b");
        let id = open_call(&conn, &server_id, "x").unwrap();
        finalize_call(
            &conn,
            &id,
            &CallOutcome {
                success: false,
                error: Some("upstream_timeout".into()),
                bytes_in: None,
                bytes_out: None,
            },
        )
        .unwrap();
        // Second call should NOT overwrite — the WHERE clause guards us.
        finalize_call(
            &conn,
            &id,
            &CallOutcome {
                success: true,
                error: None,
                bytes_in: None,
                bytes_out: None,
            },
        )
        .unwrap();
        let latest = latest_for_server(&conn, &server_id).unwrap().unwrap();
        assert_eq!(latest.success, Some(false));
        assert_eq!(latest.error.as_deref(), Some("upstream_timeout"));
    }

    #[test]
    fn failure_count_window_filters_old_and_successful_rows() {
        let conn = fresh_db();
        let server_id = seed_server(&conn, "c");
        for _ in 0..3 {
            let id = open_call(&conn, &server_id, "x").unwrap();
            finalize_call(
                &conn,
                &id,
                &CallOutcome {
                    success: false,
                    error: Some("e".into()),
                    bytes_in: None,
                    bytes_out: None,
                },
            )
            .unwrap();
        }
        let id = open_call(&conn, &server_id, "x").unwrap();
        finalize_call(
            &conn,
            &id,
            &CallOutcome {
                success: true,
                error: None,
                bytes_in: None,
                bytes_out: None,
            },
        )
        .unwrap();
        let count = failure_count_within(&conn, &server_id, 60_000).unwrap();
        assert_eq!(count, 3, "three failures + one success → count = 3");
    }

    #[test]
    fn delete_server_cascades_to_call_log() {
        let conn = fresh_db();
        let server_id = seed_server(&conn, "d");
        let _ = open_call(&conn, &server_id, "x").unwrap();
        let before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM mcp_call_log WHERE server_id = ?1",
                params![server_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(before, 1);
        conn.execute("DELETE FROM mcp_servers WHERE id = ?1", params![server_id])
            .unwrap();
        let after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM mcp_call_log WHERE server_id = ?1",
                params![server_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(after, 0, "log rows must cascade with their server");
    }
}
