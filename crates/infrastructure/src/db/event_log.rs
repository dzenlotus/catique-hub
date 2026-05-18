//! Cross-process event log — the durable side of the realtime event bus.
//!
//! The Tauri shell holds the in-process `AppHandle::emit` channel that
//! drives the React frontend's react-query invalidations. That channel
//! only carries events emitted by code running *inside* the Tauri
//! process. The standalone `catique-hub-mcp` binary (spawned by Claude
//! Desktop / Claude Code / Codex) commits to the same SQLite file from
//! another OS process — its mutations are invisible to the in-process
//! emit. Without a bridge the UI would only see them after a manual
//! reload.
//!
//! This module is the bridge's writer half: every successful MCP
//! `dispatch` arm publishes one row to `change_events` so a tail task
//! in the Tauri shell can read newly-committed mutations and re-emit
//! them as the same Tauri events the IPC handlers already emit (same
//! name, same payload shape). The tail task lives in
//! `src-tauri/src/lib.rs` and uses [`tail`] + [`current_max_seq`].
//!
//! ## Why a table, not `tokio::sync::broadcast`
//!
//! Broadcast channels are in-process. The bus needs to survive across
//! process boundaries (Tauri shell ↔ standalone MCP binary), so the
//! medium has to be the file SQLite is already serving. SQLite's WAL
//! mode lets the tail reader observe a writer's commits the moment
//! they land — no IPC, no socket, no third broker.
//!
//! ## Retention
//!
//! Rows older than ~60 s are purged by the same tail task (see
//! [`purge_older_than`]). The bus is not an audit log — the only
//! reader is the tail task that has already read past most of the
//! window. Keeping a minute of history covers WAL checkpoint stalls
//! and Tauri-shell restart races without growing unbounded.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde_json::Value;

/// One row published to `change_events`, decoded from the wire shape.
///
/// `payload` is parsed from the TEXT column at read time. If the JSON
/// is malformed (shouldn't happen — every writer goes through
/// [`publish`] which serialises a `serde_json::Value`), [`tail`] drops
/// the row with a stderr log rather than failing the batch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeEvent {
    /// Monotonic, never-reused sequence number assigned by SQLite's
    /// AUTOINCREMENT. Tail readers track the highest `seq` they have
    /// emitted and only fetch `WHERE seq > last_seen`.
    pub seq: i64,
    /// Tauri event name (`<domain>:<verb>`). Same string the IPC
    /// handlers in `catique_api::events` pass to `AppHandle::emit`.
    pub name: String,
    /// Event payload — same shape the IPC handlers serialise inline.
    pub payload: Value,
}

/// Insert one row into `change_events` and return the assigned `seq`.
///
/// `payload` is serialised verbatim via `Value::to_string()`. The
/// caller must supply a [`Connection`] already acquired from the pool;
/// no transaction is opened so this can be called after a use case has
/// already committed without re-entering BEGIN/COMMIT.
///
/// # Errors
///
/// Returns the rusqlite error from INSERT. The MCP dispatch caller
/// swallows it with a stderr log — a publish failure must not break
/// the underlying use-case result.
pub fn publish(conn: &Connection, name: &str, payload: &Value) -> Result<i64, rusqlite::Error> {
    let payload_json = payload.to_string();
    let ts = now_millis();
    // `RETURNING seq` arrived in SQLite 3.35 (2021). The bundled
    // `rusqlite` ships SQLite 3.4x, well past that floor.
    let seq: i64 = conn.query_row(
        "INSERT INTO change_events (name, payload, ts) VALUES (?1, ?2, ?3) RETURNING seq",
        params![name, payload_json, ts],
        |row| row.get(0),
    )?;
    Ok(seq)
}

/// Read every row with `seq > after_seq`, up to `limit`, ordered by
/// `seq` ASC. The tail task calls this on a ~50 ms cadence with
/// `after_seq = last_emitted_seq` and `limit = 200`.
///
/// Rows whose `payload` column does not parse as JSON are skipped with
/// an stderr warning — we control every writer (via [`publish`]) so
/// the only way this fires is a manual sqlite3 poke or DB corruption.
/// Dropping is correct: keeping the bus running matters more than one
/// malformed row.
///
/// # Errors
///
/// Returns the rusqlite error from the SELECT statement preparation or
/// row iteration. The caller logs and treats it as an empty tick.
pub fn tail(
    conn: &Connection,
    after_seq: i64,
    limit: usize,
) -> Result<Vec<ChangeEvent>, rusqlite::Error> {
    // SQLite LIMIT is i64 on the wire; `usize::min(i64::MAX)` is a
    // no-op except on 128-bit theoretical platforms.
    let limit_i64 = i64::try_from(limit).unwrap_or(i64::MAX);
    let mut stmt = conn.prepare(
        "SELECT seq, name, payload FROM change_events \
         WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![after_seq, limit_i64], |row| {
        let seq: i64 = row.get(0)?;
        let name: String = row.get(1)?;
        let payload_raw: String = row.get(2)?;
        Ok((seq, name, payload_raw))
    })?;
    let mut out = Vec::with_capacity(limit.min(64));
    for r in rows {
        let (seq, name, payload_raw) = r?;
        match serde_json::from_str::<Value>(&payload_raw) {
            Ok(payload) => out.push(ChangeEvent {
                seq,
                name,
                payload,
            }),
            Err(e) => {
                eprintln!(
                    "[catique-hub] event_log tail: dropping seq={seq} name={name}: \
                     payload not valid JSON ({e})"
                );
            }
        }
    }
    Ok(out)
}

/// Return the highest `seq` currently in the table (0 when empty).
/// The tail task calls this once at startup so a freshly-launched
/// Tauri shell does not re-emit every event accumulated while no
/// process was tailing.
///
/// # Errors
///
/// Returns the rusqlite error from the SELECT.
pub fn current_max_seq(conn: &Connection) -> Result<i64, rusqlite::Error> {
    let max: i64 = conn.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM change_events",
        [],
        |row| row.get(0),
    )?;
    Ok(max)
}

/// Delete rows with `ts < now_ms - max_age_ms`. Returns the count of
/// rows removed. The tail task calls this roughly once a minute; the
/// table never grows past one minute of writes worth of rows.
///
/// # Errors
///
/// Returns the rusqlite error from the DELETE.
pub fn purge_older_than(conn: &Connection, max_age_ms: i64) -> Result<usize, rusqlite::Error> {
    let cutoff = now_millis().saturating_sub(max_age_ms);
    let n = conn.execute("DELETE FROM change_events WHERE ts < ?1", params![cutoff])?;
    Ok(n)
}

/// SystemTime → milliseconds since UNIX epoch, saturating on pre-1970
/// clocks (which would be a system-clock pathology, not a real case).
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::memory_pool_for_tests;
    use crate::db::runner::run_pending;
    use serde_json::json;

    fn fresh_pool() -> crate::db::pool::Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().expect("acquire");
        run_pending(&mut conn).expect("run migrations");
        drop(conn);
        pool
    }

    #[test]
    fn publish_then_tail_returns_rows_in_seq_order() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");

        let s1 = publish(&conn, "task:created", &json!({ "id": "t1" })).expect("publish 1");
        let s2 = publish(&conn, "task:updated", &json!({ "id": "t1" })).expect("publish 2");
        let s3 = publish(&conn, "task:deleted", &json!({ "id": "t1" })).expect("publish 3");

        assert!(s1 < s2 && s2 < s3, "seq must increase monotonically");

        let rows = tail(&conn, 0, 200).expect("tail");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].name, "task:created");
        assert_eq!(rows[1].name, "task:updated");
        assert_eq!(rows[2].name, "task:deleted");
        assert_eq!(rows[0].payload, json!({ "id": "t1" }));
    }

    #[test]
    fn tail_after_max_seq_returns_empty() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");

        publish(&conn, "task:created", &json!({ "id": "t1" })).unwrap();
        let max = current_max_seq(&conn).unwrap();
        let rows = tail(&conn, max, 200).expect("tail after max");
        assert!(rows.is_empty(), "no rows should be returned past max");
    }

    #[test]
    fn current_max_seq_is_zero_on_empty_table() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");
        assert_eq!(current_max_seq(&conn).unwrap(), 0);
    }

    #[test]
    fn purge_older_than_removes_only_old_rows() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");

        // Insert a row with an artificially old `ts` directly (bypass
        // `publish` so we control the timestamp).
        conn.execute(
            "INSERT INTO change_events (name, payload, ts) VALUES ('old:event', '{}', 0)",
            [],
        )
        .unwrap();
        publish(&conn, "new:event", &json!({})).unwrap();

        // Anything older than 1s — the old row's ts=0 qualifies, the
        // freshly published one (ts=now) does not.
        let removed = purge_older_than(&conn, 1_000).expect("purge");
        assert_eq!(removed, 1, "only the ts=0 row should be deleted");

        let rows = tail(&conn, 0, 200).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "new:event");
    }

    #[test]
    fn tail_skips_malformed_payload_with_log() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");

        // Hand-insert a broken row (would never happen via `publish`).
        conn.execute(
            "INSERT INTO change_events (name, payload, ts) VALUES ('bad', 'not json', 1)",
            [],
        )
        .unwrap();
        publish(&conn, "good", &json!({"ok": true})).unwrap();

        let rows = tail(&conn, 0, 200).unwrap();
        assert_eq!(rows.len(), 1, "malformed row dropped, valid one kept");
        assert_eq!(rows[0].name, "good");
    }
}
