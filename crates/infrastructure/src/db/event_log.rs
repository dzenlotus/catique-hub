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
//! ## Scope columns (refactor-v3 D-D)
//!
//! Migration 035 adds `scope_kind`, `scope_id`, and `count` to the
//! table. Writers pass `(scope_kind, scope_id)` to [`publish`] so the
//! UI can answer "what changed in *this* space" without scanning the
//! whole feed. `count` exists for Tier-3 compaction: repeated
//! content-edit events within a 5-minute window UPDATE the row's
//! `ts` and bump `count` instead of inserting a new row (see
//! [`COMPACTION_WINDOW_MS`]).
//!
//! ## Retention
//!
//! Rows older than 90 days are purged by the tail task (see
//! [`PURGE_MAX_AGE_MS`]). The table is durable now — D-D upgraded it
//! from a one-minute transient ring to a 90-day activity log — but
//! still bounded so a pathologically active workspace can't bloat the
//! DB indefinitely.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde_json::Value;

/// Default retention window for [`purge_older_than`]: 90 days in
/// milliseconds. Sized to the D-D acceptance criterion. Callers can
/// pass a different value (the tests do — see below) but the tail
/// task in `src-tauri` uses this constant directly.
pub const PURGE_MAX_AGE_MS: i64 = 90 * 24 * 60 * 60 * 1000;

/// Tier-3 content-edit compaction window in milliseconds. When an
/// event with the same `(scope_kind, scope_id, name)` lands within
/// this window of the most recent row, [`publish`] UPDATEs that row
/// instead of inserting a new one. 5 minutes matches D-C's debounce.
pub const COMPACTION_WINDOW_MS: i64 = 5 * 60 * 1000;

/// Event names eligible for Tier-3 compaction. Only entity-update
/// events for surfaces that emit one event per keystroke debounce
/// belong here; create/delete/move are one-shot lifecycle moments and
/// must never collapse into a single row. The list is small and
/// closed deliberately — extending it requires re-reading D-D.
const COMPACTABLE_NAMES: &[&str] = &[
    "prompt:updated",
    "role:updated",
    "skill:updated",
    "task:updated",
];

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
    /// D-D scope discriminator (`"global" | "space" | "board" | ...`).
    /// Defaults to `"global"` for rows written before migration 035.
    pub scope_kind: String,
    /// Entity id matching `scope_kind`. `None` for `scope_kind == "global"`.
    pub scope_id: Option<String>,
    /// Tier-3 compaction counter. `1` for non-compacted rows; bumped
    /// in-place by [`publish`] when a same-scope/same-name event lands
    /// within [`COMPACTION_WINDOW_MS`].
    pub count: i64,
}

/// Insert one row into `change_events` (or UPDATE the most recent row
/// when Tier-3 compaction applies) and return the assigned `seq`.
///
/// Compaction rule (D-D):
///   * Triggers only when `name` is in [`COMPACTABLE_NAMES`].
///   * Looks at the most recent row matching
///     `(scope_kind, scope_id, name)`. If its `ts` is within
///     [`COMPACTION_WINDOW_MS`], that row's `ts` is bumped to now,
///     `count` is incremented, `payload` is overwritten with the new
///     value, and the existing `seq` is returned.
///   * Otherwise INSERT a fresh row with `count = 1`.
///
/// The compaction read uses the
/// `(scope_kind, scope_id, ts DESC)` index added in migration 035, so
/// the lookup is O(log n) in the bus size.
///
/// `payload` is serialised verbatim via `Value::to_string()`. The
/// caller must supply a [`Connection`] already acquired from the pool;
/// no transaction is opened so this can be called after a use case has
/// already committed without re-entering BEGIN/COMMIT.
///
/// # Errors
///
/// Returns the rusqlite error from INSERT/UPDATE. The MCP dispatch
/// caller swallows it with a stderr log — a publish failure must not
/// break the underlying use-case result.
pub fn publish(
    conn: &Connection,
    name: &str,
    payload: &Value,
    scope_kind: &str,
    scope_id: Option<&str>,
) -> Result<i64, rusqlite::Error> {
    let payload_json = payload.to_string();
    let ts = now_millis();

    if COMPACTABLE_NAMES.contains(&name) {
        // Look for the most recent same-scope/same-name row inside the
        // debounce window. We match `scope_id IS NULL` explicitly to
        // avoid SQL's tri-valued logic dropping global-scope events.
        let cutoff = ts.saturating_sub(COMPACTION_WINDOW_MS);
        let existing: Option<i64> = conn
            .query_row(
                "SELECT seq FROM change_events \
                 WHERE scope_kind = ?1 \
                   AND ((scope_id IS NULL AND ?2 IS NULL) OR scope_id = ?2) \
                   AND name = ?3 \
                   AND ts >= ?4 \
                 ORDER BY ts DESC LIMIT 1",
                params![scope_kind, scope_id, name, cutoff],
                |row| row.get(0),
            )
            .ok();
        if let Some(seq) = existing {
            conn.execute(
                "UPDATE change_events \
                 SET ts = ?1, count = count + 1, payload = ?2 \
                 WHERE seq = ?3",
                params![ts, payload_json, seq],
            )?;
            return Ok(seq);
        }
    }

    // `RETURNING seq` arrived in SQLite 3.35 (2021). The bundled
    // `rusqlite` ships SQLite 3.4x, well past that floor.
    let seq: i64 = conn.query_row(
        "INSERT INTO change_events (name, payload, ts, scope_kind, scope_id) \
         VALUES (?1, ?2, ?3, ?4, ?5) RETURNING seq",
        params![name, payload_json, ts, scope_kind, scope_id],
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
        "SELECT seq, name, payload, scope_kind, scope_id, count FROM change_events \
         WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![after_seq, limit_i64], row_to_raw)?;
    collect_rows(rows, limit)
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

/// Read the most recent `limit` rows ordered DESC by `seq`. Used by the
/// activity-log UI for the global "All activity" debug view. The
/// per-space / per-entity feeds use [`recent_events_by_scope`].
///
/// # Errors
///
/// Returns the rusqlite error from SELECT preparation or row iteration.
pub fn recent_events(conn: &Connection, limit: usize) -> Result<Vec<ChangeEvent>, rusqlite::Error> {
    let limit_i64 = i64::try_from(limit).unwrap_or(i64::MAX);
    let mut stmt = conn.prepare(
        "SELECT seq, name, payload, scope_kind, scope_id, count FROM change_events \
         ORDER BY seq DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit_i64], row_to_raw)?;
    collect_rows(rows, limit)
}

/// Read the most recent `limit` rows filtered by `(scope_kind, scope_id)`,
/// ordered DESC by `seq` (newest first). Drives the SpaceDetailPage
/// activity log section and the analogous agent / board / task panes.
///
/// The `scope_id IS NULL AND ?2 IS NULL` branch is explicit because
/// SQL's `=` returns NULL when either side is NULL, which the query
/// planner treats as "filter out the row". Global-scope events
/// (`scope_kind = "global"`) need that branch to be visible.
///
/// # Errors
///
/// Returns the rusqlite error from SELECT preparation or row iteration.
pub fn recent_events_by_scope(
    conn: &Connection,
    scope_kind: &str,
    scope_id: Option<&str>,
    limit: usize,
) -> Result<Vec<ChangeEvent>, rusqlite::Error> {
    let limit_i64 = i64::try_from(limit).unwrap_or(i64::MAX);
    let mut stmt = conn.prepare(
        "SELECT seq, name, payload, scope_kind, scope_id, count FROM change_events \
         WHERE scope_kind = ?1 \
           AND ((scope_id IS NULL AND ?2 IS NULL) OR scope_id = ?2) \
         ORDER BY seq DESC LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![scope_kind, scope_id, limit_i64], row_to_raw)?;
    collect_rows(rows, limit)
}

/// Delete rows with `ts < now_ms - max_age_ms`. Returns the count of
/// rows removed. The tail task calls this roughly once a minute with
/// [`PURGE_MAX_AGE_MS`] (90 days) as the ceiling.
///
/// # Errors
///
/// Returns the rusqlite error from the DELETE.
pub fn purge_older_than(conn: &Connection, max_age_ms: i64) -> Result<usize, rusqlite::Error> {
    let cutoff = now_millis().saturating_sub(max_age_ms);
    let n = conn.execute("DELETE FROM change_events WHERE ts < ?1", params![cutoff])?;
    Ok(n)
}

/// Raw row tuple decoded by [`row_to_raw`].
///
/// Order: `(seq, name, payload_json, scope_kind, scope_id, count)`.
/// Aliased so Clippy's type-complexity lint doesn't trip on the six-
/// positional-fields tuple at every call site.
type RawRow = (i64, String, String, String, Option<String>, i64);

/// Shared row decoder for `tail`, `recent_events`, and
/// `recent_events_by_scope`. Keeps the column ordering in lockstep —
/// any drift would break all three readers at once and the type
/// checker catches it.
fn row_to_raw(row: &rusqlite::Row<'_>) -> Result<RawRow, rusqlite::Error> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
    ))
}

/// Decode an iterator of raw row tuples into `ChangeEvent`s. Malformed
/// JSON payloads are dropped with a stderr log (documented contract;
/// see [`tail`]).
fn collect_rows<I>(rows: I, limit: usize) -> Result<Vec<ChangeEvent>, rusqlite::Error>
where
    I: Iterator<Item = Result<RawRow, rusqlite::Error>>,
{
    let mut out = Vec::with_capacity(limit.min(64));
    for r in rows {
        let (seq, name, payload_raw, scope_kind, scope_id, count) = r?;
        match serde_json::from_str::<Value>(&payload_raw) {
            Ok(payload) => out.push(ChangeEvent {
                seq,
                name,
                payload,
                scope_kind,
                scope_id,
                count,
            }),
            Err(e) => {
                eprintln!(
                    "[catique-hub] event_log: dropping seq={seq} name={name}: \
                     payload not valid JSON ({e})"
                );
            }
        }
    }
    Ok(out)
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

        let s1 = publish(
            &conn,
            "task:created",
            &json!({ "id": "t1" }),
            "task",
            Some("t1"),
        )
        .expect("publish 1");
        // `task:updated` is compactable — use a non-compactable name
        // here to keep the assertion about three independent seqs.
        let s2 = publish(
            &conn,
            "task:created",
            &json!({ "id": "t2" }),
            "task",
            Some("t2"),
        )
        .expect("publish 2");
        let s3 = publish(
            &conn,
            "task:deleted",
            &json!({ "id": "t1" }),
            "task",
            Some("t1"),
        )
        .expect("publish 3");

        assert!(s1 < s2 && s2 < s3, "seq must increase monotonically");

        let rows = tail(&conn, 0, 200).expect("tail");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].name, "task:created");
        assert_eq!(rows[1].name, "task:created");
        assert_eq!(rows[2].name, "task:deleted");
        assert_eq!(rows[0].payload, json!({ "id": "t1" }));
        assert_eq!(rows[0].scope_kind, "task");
        assert_eq!(rows[0].scope_id.as_deref(), Some("t1"));
        assert_eq!(rows[0].count, 1);
    }

    #[test]
    fn tail_after_max_seq_returns_empty() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");

        publish(
            &conn,
            "task:created",
            &json!({ "id": "t1" }),
            "task",
            Some("t1"),
        )
        .unwrap();
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
            "INSERT INTO change_events (name, payload, ts, scope_kind, scope_id) \
             VALUES ('old:event', '{}', 0, 'global', NULL)",
            [],
        )
        .unwrap();
        publish(&conn, "new:event", &json!({}), "global", None).unwrap();

        // Anything older than 1s — the old row's ts=0 qualifies, the
        // freshly published one (ts=now) does not.
        let removed = purge_older_than(&conn, 1_000).expect("purge");
        assert_eq!(removed, 1, "only the ts=0 row should be deleted");

        let rows = tail(&conn, 0, 200).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "new:event");
    }

    #[test]
    fn purge_at_90_day_window_keeps_recent_drops_older() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");

        // 91-day-old row + a fresh one.
        let day_ms = 24 * 60 * 60 * 1000;
        let very_old_ts = now_millis().saturating_sub(91 * day_ms);
        conn.execute(
            "INSERT INTO change_events (name, payload, ts, scope_kind, scope_id) \
             VALUES ('old:event', '{}', ?1, 'global', NULL)",
            params![very_old_ts],
        )
        .unwrap();
        publish(&conn, "fresh:event", &json!({}), "global", None).unwrap();

        let removed = purge_older_than(&conn, PURGE_MAX_AGE_MS).expect("purge 90d");
        assert_eq!(removed, 1, "91-day-old row must be dropped");

        let kept = tail(&conn, 0, 200).unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].name, "fresh:event");
    }

    #[test]
    fn tail_skips_malformed_payload_with_log() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");

        // Hand-insert a broken row (would never happen via `publish`).
        conn.execute(
            "INSERT INTO change_events (name, payload, ts, scope_kind, scope_id) \
             VALUES ('bad', 'not json', 1, 'global', NULL)",
            [],
        )
        .unwrap();
        publish(&conn, "good", &json!({"ok": true}), "global", None).unwrap();

        let rows = tail(&conn, 0, 200).unwrap();
        assert_eq!(rows.len(), 1, "malformed row dropped, valid one kept");
        assert_eq!(rows[0].name, "good");
    }

    #[test]
    fn recent_events_by_scope_filters_to_requested_scope() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");

        // 5 rows in space sp-1, 3 rows in space sp-2, 2 global rows.
        for i in 0..5 {
            publish(
                &conn,
                "board:created",
                &json!({ "id": format!("b{i}") }),
                "space",
                Some("sp-1"),
            )
            .unwrap();
        }
        for i in 0..3 {
            publish(
                &conn,
                "board:created",
                &json!({ "id": format!("b{i}") }),
                "space",
                Some("sp-2"),
            )
            .unwrap();
        }
        publish(&conn, "global:event", &json!({}), "global", None).unwrap();
        publish(&conn, "global:event", &json!({}), "global", None).unwrap();

        let sp1 = recent_events_by_scope(&conn, "space", Some("sp-1"), 100).expect("sp-1");
        let sp2 = recent_events_by_scope(&conn, "space", Some("sp-2"), 100).expect("sp-2");
        let global = recent_events_by_scope(&conn, "global", None, 100).expect("global");

        assert_eq!(sp1.len(), 5);
        assert!(sp1.iter().all(|r| r.scope_id.as_deref() == Some("sp-1")));
        assert_eq!(sp2.len(), 3);
        assert!(sp2.iter().all(|r| r.scope_id.as_deref() == Some("sp-2")));
        assert_eq!(global.len(), 2);
        assert!(global.iter().all(|r| r.scope_id.is_none()));
    }

    #[test]
    fn recent_events_by_scope_returns_newest_first() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");

        publish(
            &conn,
            "board:created",
            &json!({ "id": "b1" }),
            "space",
            Some("sp-1"),
        )
        .unwrap();
        publish(
            &conn,
            "board:created",
            &json!({ "id": "b2" }),
            "space",
            Some("sp-1"),
        )
        .unwrap();

        let rows = recent_events_by_scope(&conn, "space", Some("sp-1"), 10).expect("scope");
        assert_eq!(rows.len(), 2);
        assert!(rows[0].seq > rows[1].seq, "DESC ordering — newest first");
    }

    #[test]
    fn tier3_compaction_collapses_repeated_edits_into_one_row() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");

        // Five `prompt:updated` events for the same prompt within the
        // 5-minute window → one row with count = 5.
        let mut seqs = Vec::new();
        for _ in 0..5 {
            let seq = publish(
                &conn,
                "prompt:updated",
                &json!({ "id": "p1" }),
                "prompt",
                Some("p1"),
            )
            .unwrap();
            seqs.push(seq);
        }
        // All five publishes must collapse onto the same row.
        assert!(
            seqs.iter().all(|s| *s == seqs[0]),
            "compaction must reuse the same seq across the window: {seqs:?}"
        );

        let rows = recent_events_by_scope(&conn, "prompt", Some("p1"), 10).expect("scope");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].count, 5);
    }

    #[test]
    fn tier3_compaction_does_not_cross_scope_boundary() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");

        publish(
            &conn,
            "prompt:updated",
            &json!({ "id": "p1" }),
            "prompt",
            Some("p1"),
        )
        .unwrap();
        publish(
            &conn,
            "prompt:updated",
            &json!({ "id": "p2" }),
            "prompt",
            Some("p2"),
        )
        .unwrap();

        let p1 = recent_events_by_scope(&conn, "prompt", Some("p1"), 10).unwrap();
        let p2 = recent_events_by_scope(&conn, "prompt", Some("p2"), 10).unwrap();
        assert_eq!(p1.len(), 1);
        assert_eq!(p1[0].count, 1);
        assert_eq!(p2.len(), 1);
        assert_eq!(p2[0].count, 1);
    }

    #[test]
    fn lifecycle_events_never_compact() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");

        // `task:created` is NOT in COMPACTABLE_NAMES — three identical
        // publishes must produce three distinct rows.
        let s1 = publish(
            &conn,
            "task:created",
            &json!({ "id": "t1" }),
            "task",
            Some("t1"),
        )
        .unwrap();
        let s2 = publish(
            &conn,
            "task:created",
            &json!({ "id": "t1" }),
            "task",
            Some("t1"),
        )
        .unwrap();
        let s3 = publish(
            &conn,
            "task:created",
            &json!({ "id": "t1" }),
            "task",
            Some("t1"),
        )
        .unwrap();

        assert!(
            s1 < s2 && s2 < s3,
            "lifecycle events must always insert: {s1} {s2} {s3}"
        );
        let rows = recent_events_by_scope(&conn, "task", Some("t1"), 10).unwrap();
        assert_eq!(rows.len(), 3);
        assert!(rows.iter().all(|r| r.count == 1));
    }

    #[test]
    fn publish_round_trips_scope_through_tail_and_recent() {
        let pool = fresh_pool();
        let conn = pool.get().expect("acquire");

        publish(
            &conn,
            "board:created",
            &json!({ "id": "b1" }),
            "space",
            Some("sp-1"),
        )
        .unwrap();

        let via_tail = tail(&conn, 0, 200).unwrap();
        assert_eq!(via_tail.len(), 1);
        assert_eq!(via_tail[0].scope_kind, "space");
        assert_eq!(via_tail[0].scope_id.as_deref(), Some("sp-1"));

        let via_recent = recent_events(&conn, 10).unwrap();
        assert_eq!(via_recent.len(), 1);
        assert_eq!(via_recent[0].scope_kind, "space");
        assert_eq!(via_recent[0].scope_id.as_deref(), Some("sp-1"));
    }
}
