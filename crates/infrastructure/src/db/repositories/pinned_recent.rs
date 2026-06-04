//! Recent boards — refactor-v3 D-F.
//!
//! `recent_boards` keyed by `board_id` with ON DELETE CASCADE against
//! `boards.id`. Migration `036_pinned_recent_kv.sql` shipped the schema
//! (the sibling `pinned_boards` table was dropped in `040` when the
//! Pinned feature was removed); this module owns every SQL statement
//! that touches `recent_boards`.
//!
//! ## Why a dedicated table, not a kv row
//!
//! The set references `boards.id`. A loose kv entry could not enforce
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

use rusqlite::{params, Connection};

use super::util::now_millis;
use crate::db::pool::DbError;

/// Hard cap on rows kept in `recent_boards`. Mirrors D-F §Recent
/// eviction — 5 per install.
pub const RECENT_BOARDS_LIMIT: usize = 5;

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
