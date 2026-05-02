//! `task_ratings` repository — Cat-as-Agent Phase 1 quality signal.
//!
//! Schema: `004_cat_as_agent_phase1.sql` (memo Q4). One row per task in
//! Phase 1; widening to `(task_id, cat_id)` is Phase 2 work. The
//! `rating` column is **nullable** so that "unrated" (NULL) stays
//! distinct from "explicit-neutral" (`0`) — both are load-bearing for
//! memory weighting (memo Q4 / AC-R2).
//!
//! UPSERT semantics: every `set_rating` refreshes `rated_at`, so the
//! column doubles as a last-modified timestamp without an extra column.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::now_millis;
use crate::db::pool::DbError;

/// One row of the `task_ratings` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskRatingRow {
    pub task_id: String,
    /// `Some(-1 | 0 | +1)` for an explicit rating; `None` for the
    /// "row exists, rating cleared" state produced by re-rating with
    /// `None`. The schema CHECK guards the integer range.
    pub rating: Option<i8>,
    /// Wall-clock unix-ms; refreshed on every UPSERT.
    pub rated_at: i64,
}

impl TaskRatingRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        // SQLite types `rating` as INTEGER NULL — read as Option<i64>
        // then narrow to i8. Out-of-range values would point at
        // schema corruption (the CHECK constraint forbids them on
        // write); we surface that as a `FromSqlConversionFailure`.
        let raw: Option<i64> = row.get("rating")?;
        let rating = match raw {
            Some(v) => Some(i8::try_from(v).map_err(|_| {
                rusqlite::Error::FromSqlConversionFailure(
                    1,
                    rusqlite::types::Type::Integer,
                    Box::new(std::io::Error::other(format!(
                        "task_ratings.rating out of range: {v}"
                    ))),
                )
            })?),
            None => None,
        };
        Ok(Self {
            task_id: row.get("task_id")?,
            rating,
            rated_at: row.get("rated_at")?,
        })
    }
}

/// UPSERT a rating for `task_id`. `rating = None` clears the rating
/// (the row stays so `rated_at` records the unrate moment); a value
/// outside `{-1, 0, 1}` is rejected by the schema CHECK and surfaces
/// as [`DbError::Sqlite`] with `ConstraintViolation`.
///
/// `rated_at` is always refreshed to "now" so the column doubles as
/// last-modified — see module docs.
///
/// # Errors
///
/// FK violation (missing `task_id`) or CHECK violation (bad rating)
/// surface as [`DbError::Sqlite`].
pub fn set_rating(conn: &Connection, task_id: &str, rating: Option<i8>) -> Result<(), DbError> {
    let now = now_millis();
    // Map Option<i8> → Option<i64> for the rusqlite param binding.
    let rating_i64: Option<i64> = rating.map(i64::from);
    conn.execute(
        "INSERT INTO task_ratings (task_id, rating, rated_at) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(task_id) DO UPDATE SET \
            rating = excluded.rating, \
            rated_at = excluded.rated_at",
        params![task_id, rating_i64, now],
    )?;
    Ok(())
}

/// Look up the rating row for `task_id`. `Ok(None)` for tasks that
/// have never been rated; `Ok(Some(row))` with `row.rating = None` for
/// tasks that were rated and then explicitly unrated (memo Q4 / AC-R2
/// distinction).
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get_rating(conn: &Connection, task_id: &str) -> Result<Option<TaskRatingRow>, DbError> {
    let mut stmt =
        conn.prepare("SELECT task_id, rating, rated_at FROM task_ratings WHERE task_id = ?1")?;
    Ok(stmt
        .query_row(params![task_id], TaskRatingRow::from_row)
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    fn fresh_db_with_task() -> (Connection, String) {
        let mut conn = Connection::open_in_memory().expect("open mem");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("PRAGMA");
        run_pending(&mut conn).expect("migrations");
        // Seed one space + board + column + task.
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd1','B','sp1',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c1','bd1','Todo',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1','bd1','c1','sp-1','T',0,0,0);",
        )
        .expect("seed");
        (conn, "t1".into())
    }

    #[test]
    fn no_row_for_unrated_task() {
        let (conn, task_id) = fresh_db_with_task();
        assert!(get_rating(&conn, &task_id).unwrap().is_none());
    }

    #[test]
    fn set_then_get_round_trip_positive() {
        let (conn, task_id) = fresh_db_with_task();
        set_rating(&conn, &task_id, Some(1)).unwrap();
        let got = get_rating(&conn, &task_id).unwrap().expect("row");
        assert_eq!(got.rating, Some(1));
        assert_eq!(got.task_id, task_id);
        assert!(got.rated_at > 0);
    }

    #[test]
    fn set_then_update_changes_rating_and_timestamp() {
        let (conn, task_id) = fresh_db_with_task();
        set_rating(&conn, &task_id, Some(1)).unwrap();
        let first = get_rating(&conn, &task_id).unwrap().expect("row");
        // Sleep past the millisecond boundary so rated_at strictly
        // increases. 2 ms is plenty in CI.
        std::thread::sleep(std::time::Duration::from_millis(2));
        set_rating(&conn, &task_id, Some(-1)).unwrap();
        let second = get_rating(&conn, &task_id).unwrap().expect("row");
        assert_eq!(second.rating, Some(-1));
        assert!(second.rated_at >= first.rated_at);
    }

    #[test]
    fn unrate_keeps_row_with_null_rating() {
        let (conn, task_id) = fresh_db_with_task();
        set_rating(&conn, &task_id, Some(0)).unwrap();
        set_rating(&conn, &task_id, None).unwrap();
        let row = get_rating(&conn, &task_id).unwrap().expect("row stays");
        assert_eq!(row.rating, None, "unrate must produce NULL, not 0");
    }

    #[test]
    fn check_constraint_rejects_out_of_range() {
        let (conn, task_id) = fresh_db_with_task();
        let err = set_rating(&conn, &task_id, Some(2)).expect_err("CHECK");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("expected ConstraintViolation, got {other:?}"),
        }
    }

    #[test]
    fn fk_constraint_rejects_unknown_task() {
        let (conn, _task_id) = fresh_db_with_task();
        let err = set_rating(&conn, "ghost", Some(1)).expect_err("FK");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("expected ConstraintViolation, got {other:?}"),
        }
    }
}
