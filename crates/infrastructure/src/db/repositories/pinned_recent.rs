//! Pinned + Recent boards — refactor-v3 D-F.
//!
//! Two sibling tables (`pinned_boards`, `recent_boards`) keyed by
//! `board_id` with ON DELETE CASCADE against `boards.id`. Migration
//! `036_pinned_recent_kv.sql` ships the schema; this module owns every
//! SQL statement that touches them.
//!
//! ## Why dedicated tables, not a kv row
//!
//! Both sets reference `boards.id`. A loose kv entry could not enforce
//! "deleted board disappears from sidebar within the same tick" — the
//! application would have to remember to fix up the JSON blob on every
//! `delete_board`. FK + CASCADE delegates that to SQLite.
//!
//! ## Recent eviction
//!
//! On every [`track_visit`] we UPSERT `(board_id, now)` then prune any
//! rows past the top-5 by `visited_at DESC`. The prune is a single
//! statement so the table never grows past 5 rows — no background GC
//! task needed.
//!
//! ## Pinned ordering
//!
//! `position` is REAL so drag-to-reorder can use the fractional-midpoint
//! trick already proven on `boards.position`. New pins land at
//! `max(position) + 1`.

use rusqlite::{params, Connection, OptionalExtension};

use super::util::now_millis;
use crate::db::pool::DbError;

/// Hard cap on rows kept in `recent_boards`. Mirrors D-F §Recent
/// eviction — 5 per install.
pub const RECENT_BOARDS_LIMIT: usize = 5;

// ---------------------------------------------------------------------
// Pinned boards.
// ---------------------------------------------------------------------

/// Return every pinned board id, ordered by `position` ASC then
/// `pinned_at` ASC (stable secondary key for equal positions, which a
/// fresh install can produce when two pins land in the same millisecond).
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_pinned(conn: &Connection) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT board_id FROM pinned_boards \
         ORDER BY position ASC, pinned_at ASC",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Return `true` when `board_id` is currently pinned.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn is_pinned(conn: &Connection, board_id: &str) -> Result<bool, DbError> {
    let mut stmt = conn.prepare("SELECT 1 FROM pinned_boards WHERE board_id = ?1")?;
    Ok(stmt
        .query_row(params![board_id], |_| Ok(()))
        .optional()?
        .is_some())
}

/// Maximum `position` value across all rows. Returns `None` when the
/// table is empty so the caller can default to `1.0` for the first pin.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn max_position(conn: &Connection) -> Result<Option<f64>, DbError> {
    let mut stmt = conn.prepare("SELECT MAX(position) FROM pinned_boards")?;
    Ok(stmt.query_row([], |row| row.get::<_, Option<f64>>(0))?)
}

/// Insert-or-ignore a pin. When already present we do NOT bump
/// `pinned_at` — the caller's intent ("pin this board") is satisfied by
/// the existing row, and overwriting `pinned_at` would re-sort equal
/// positions in confusing ways.
///
/// Returns `true` if a row was inserted, `false` if it was already
/// pinned.
///
/// # Errors
///
/// Bubbles FK violation (unknown `board_id`) as [`DbError::Sqlite`];
/// the use-case layer maps it to `AppError::NotFound`.
pub fn pin(conn: &Connection, board_id: &str, position: f64) -> Result<bool, DbError> {
    let now = now_millis();
    let inserted = conn.execute(
        "INSERT INTO pinned_boards (board_id, position, pinned_at) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(board_id) DO NOTHING",
        params![board_id, position, now],
    )?;
    Ok(inserted > 0)
}

/// Remove a pin. Returns `true` when a row was deleted.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn unpin(conn: &Connection, board_id: &str) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM pinned_boards WHERE board_id = ?1",
        params![board_id],
    )?;
    Ok(n > 0)
}

/// Update a pin's `position`. Returns `true` when a row was updated
/// (i.e. the board was already pinned).
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn reorder(conn: &Connection, board_id: &str, new_position: f64) -> Result<bool, DbError> {
    let n = conn.execute(
        "UPDATE pinned_boards SET position = ?2 WHERE board_id = ?1",
        params![board_id, new_position],
    )?;
    Ok(n > 0)
}

// ---------------------------------------------------------------------
// Recent boards.
// ---------------------------------------------------------------------

/// Return up to [`RECENT_BOARDS_LIMIT`] recently-visited board ids,
/// ordered by `visited_at` DESC.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_recent(conn: &Connection) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT board_id FROM recent_boards \
         ORDER BY visited_at DESC \
         LIMIT ?1",
    )?;
    // `i64` is the bound type rusqlite uses for integer literals; the
    // cap is a small const so the conversion can never overflow.
    let limit = i64::try_from(RECENT_BOARDS_LIMIT).unwrap_or(i64::MAX);
    let rows = stmt.query_map(params![limit], |row| row.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Wipe every row from `recent_boards`. Used by the AppSidebar's
/// "Clear" affordance — explicit user intent, so no soft-delete or
/// archival; the next `track_visit` repopulates from scratch.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn clear_recent(conn: &Connection) -> Result<(), DbError> {
    conn.execute("DELETE FROM recent_boards", [])?;
    Ok(())
}

/// Track a board visit. UPSERT `(board_id, now)`, then prune everything
/// past the top-[`RECENT_BOARDS_LIMIT`] by `visited_at DESC`.
///
/// # Errors
///
/// Bubbles FK violation (unknown `board_id`) as [`DbError::Sqlite`];
/// the use-case layer maps it to `AppError::NotFound`.
pub fn track_visit(conn: &Connection, board_id: &str) -> Result<(), DbError> {
    let now = now_millis();
    conn.execute(
        "INSERT INTO recent_boards (board_id, visited_at) \
         VALUES (?1, ?2) \
         ON CONFLICT(board_id) DO UPDATE SET visited_at = excluded.visited_at",
        params![board_id, now],
    )?;
    // Prune to the top-N by recency. The subquery picks the keepers;
    // any row outside that set is dropped. Limit is a const, so the
    // i64 cast cannot overflow on any supported host.
    let limit = i64::try_from(RECENT_BOARDS_LIMIT).unwrap_or(i64::MAX);
    conn.execute(
        "DELETE FROM recent_boards WHERE board_id NOT IN (\
            SELECT board_id FROM recent_boards \
            ORDER BY visited_at DESC \
            LIMIT ?1\
         )",
        params![limit],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    /// Build a fresh in-memory DB with the canonical migrations applied
    /// plus one space + the requested number of boards. Board ids are
    /// `b1`, `b2`, … so the assertions read naturally.
    ///
    /// Migration 016 enforces `UNIQUE(boards.space_id,
    /// boards.owner_role_id)` so every board needs its own owner role.
    /// We mint `rl-1`..`rl-N` user roles up front and assign them 1:1.
    fn fresh_db_with_boards(n: usize) -> Connection {
        let mut conn = Connection::open_in_memory().expect("open mem");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("PRAGMA");
        run_pending(&mut conn).expect("migrations");
        conn.execute(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
             VALUES ('sp1', 'S', 'sp', 0, 0, 0, 0)",
            [],
        )
        .expect("seed space");
        for i in 1..=n {
            // Seed a fresh user role per board so the UNIQUE(space_id,
            // owner_role_id) index doesn't fire on the second insert.
            // `roles.name` is UNIQUE so embed the index in the label.
            conn.execute(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                 VALUES (?1, ?2, '', 0, 0)",
                params![format!("rl-{i}"), format!("Role {i}")],
            )
            .expect("seed role");
            conn.execute(
                "INSERT INTO boards \
                    (id, name, space_id, role_id, position, description, color, icon, \
                     is_default, created_at, updated_at, owner_role_id) \
                 VALUES (?1, ?2, 'sp1', NULL, 0, NULL, NULL, NULL, 0, 0, 0, ?3)",
                params![format!("b{i}"), format!("Board {i}"), format!("rl-{i}")],
            )
            .expect("seed board");
        }
        conn
    }

    // -------- pinned --------

    #[test]
    fn pin_then_list_returns_one_row() {
        let conn = fresh_db_with_boards(1);
        assert!(pin(&conn, "b1", 1.0).unwrap());
        let ids = list_pinned(&conn).unwrap();
        assert_eq!(ids, vec!["b1".to_owned()]);
    }

    #[test]
    fn pin_is_idempotent() {
        let conn = fresh_db_with_boards(1);
        assert!(pin(&conn, "b1", 1.0).unwrap());
        // Second pin against the same board returns false (no insert).
        assert!(!pin(&conn, "b1", 2.0).unwrap());
        // Position from the first call is preserved.
        let row: f64 = conn
            .query_row(
                "SELECT position FROM pinned_boards WHERE board_id = 'b1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!((row - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn unpin_removes_row() {
        let conn = fresh_db_with_boards(1);
        pin(&conn, "b1", 1.0).unwrap();
        assert!(unpin(&conn, "b1").unwrap());
        assert!(list_pinned(&conn).unwrap().is_empty());
    }

    #[test]
    fn unpin_returns_false_when_absent() {
        let conn = fresh_db_with_boards(1);
        assert!(!unpin(&conn, "b1").unwrap());
    }

    #[test]
    fn list_pinned_orders_by_position() {
        let conn = fresh_db_with_boards(3);
        pin(&conn, "b1", 3.0).unwrap();
        pin(&conn, "b2", 1.0).unwrap();
        pin(&conn, "b3", 2.0).unwrap();
        let ids = list_pinned(&conn).unwrap();
        assert_eq!(ids, vec!["b2".to_owned(), "b3".to_owned(), "b1".to_owned()]);
    }

    #[test]
    fn reorder_updates_position() {
        let conn = fresh_db_with_boards(3);
        pin(&conn, "b1", 1.0).unwrap();
        pin(&conn, "b2", 2.0).unwrap();
        pin(&conn, "b3", 3.0).unwrap();
        // Move b1 between b2 and b3.
        assert!(reorder(&conn, "b1", 2.5).unwrap());
        let ids = list_pinned(&conn).unwrap();
        assert_eq!(ids, vec!["b2".to_owned(), "b1".to_owned(), "b3".to_owned()]);
    }

    #[test]
    fn reorder_returns_false_for_absent_pin() {
        let conn = fresh_db_with_boards(1);
        assert!(!reorder(&conn, "b1", 1.0).unwrap());
    }

    #[test]
    fn pin_unknown_board_violates_fk() {
        let conn = fresh_db_with_boards(0);
        match pin(&conn, "ghost", 1.0) {
            Err(DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _))) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("expected FK violation, got {other:?}"),
        }
    }

    #[test]
    fn cascade_unpins_when_board_deleted() {
        let conn = fresh_db_with_boards(2);
        pin(&conn, "b1", 1.0).unwrap();
        pin(&conn, "b2", 2.0).unwrap();
        conn.execute("DELETE FROM boards WHERE id = 'b1'", [])
            .unwrap();
        let ids = list_pinned(&conn).unwrap();
        assert_eq!(ids, vec!["b2".to_owned()]);
    }

    #[test]
    fn max_position_reports_none_when_empty() {
        let conn = fresh_db_with_boards(0);
        assert!(max_position(&conn).unwrap().is_none());
    }

    #[test]
    fn max_position_reports_top_value() {
        let conn = fresh_db_with_boards(2);
        pin(&conn, "b1", 1.5).unwrap();
        pin(&conn, "b2", 4.25).unwrap();
        let got = max_position(&conn).unwrap().unwrap();
        assert!((got - 4.25).abs() < f64::EPSILON);
    }

    #[test]
    fn is_pinned_flags_membership() {
        let conn = fresh_db_with_boards(2);
        pin(&conn, "b1", 1.0).unwrap();
        assert!(is_pinned(&conn, "b1").unwrap());
        assert!(!is_pinned(&conn, "b2").unwrap());
    }

    // -------- recent --------

    #[test]
    fn track_visit_then_list_returns_one_row() {
        let conn = fresh_db_with_boards(1);
        track_visit(&conn, "b1").unwrap();
        let ids = list_recent(&conn).unwrap();
        assert_eq!(ids, vec!["b1".to_owned()]);
    }

    #[test]
    fn track_visit_upserts_existing_row() {
        let conn = fresh_db_with_boards(2);
        track_visit(&conn, "b1").unwrap();
        // Make sure visited_at advances on the next call (deterministic
        // even on systems with 1-ms clock resolution).
        std::thread::sleep(std::time::Duration::from_millis(2));
        track_visit(&conn, "b2").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        track_visit(&conn, "b1").unwrap();
        let ids = list_recent(&conn).unwrap();
        // b1 is the most recent visit now → first.
        assert_eq!(ids, vec!["b1".to_owned(), "b2".to_owned()]);
    }

    #[test]
    fn track_visit_evicts_beyond_limit() {
        // Push seven distinct boards through the LRU; only the most
        // recent five must remain.
        let conn = fresh_db_with_boards(7);
        for i in 1..=7 {
            track_visit(&conn, &format!("b{i}")).unwrap();
            // Force monotonic visited_at across calls on coarse clocks.
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let ids = list_recent(&conn).unwrap();
        assert_eq!(ids.len(), RECENT_BOARDS_LIMIT);
        assert_eq!(
            ids,
            vec![
                "b7".to_owned(),
                "b6".to_owned(),
                "b5".to_owned(),
                "b4".to_owned(),
                "b3".to_owned(),
            ]
        );
    }

    #[test]
    fn cascade_drops_recent_when_board_deleted() {
        let conn = fresh_db_with_boards(2);
        track_visit(&conn, "b1").unwrap();
        track_visit(&conn, "b2").unwrap();
        conn.execute("DELETE FROM boards WHERE id = 'b2'", [])
            .unwrap();
        let ids = list_recent(&conn).unwrap();
        assert_eq!(ids, vec!["b1".to_owned()]);
    }

    #[test]
    fn clear_recent_wipes_every_row() {
        // Seed N rows, then clear; subsequent list must be empty and a
        // follow-up `track_visit` must repopulate without surprise.
        let conn = fresh_db_with_boards(3);
        track_visit(&conn, "b1").unwrap();
        track_visit(&conn, "b2").unwrap();
        track_visit(&conn, "b3").unwrap();
        assert_eq!(list_recent(&conn).unwrap().len(), 3);

        clear_recent(&conn).unwrap();
        assert!(list_recent(&conn).unwrap().is_empty());

        // Idempotent — clearing an already-empty table is fine.
        clear_recent(&conn).unwrap();

        // Follow-up track_visit repopulates from scratch.
        track_visit(&conn, "b2").unwrap();
        assert_eq!(list_recent(&conn).unwrap(), vec!["b2".to_owned()]);
    }

    #[test]
    fn track_visit_unknown_board_violates_fk() {
        let conn = fresh_db_with_boards(0);
        match track_visit(&conn, "ghost") {
            Err(DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _))) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("expected FK violation, got {other:?}"),
        }
    }
}
