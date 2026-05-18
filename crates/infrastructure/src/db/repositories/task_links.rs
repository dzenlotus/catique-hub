//! Task-link repository — minimal task↔task relationship model
//! (catique-4). Schema lives in `029_task_links.sql`.
//!
//! Three link kinds: `related` (symmetric in intent), `blocks`, and
//! `parent`. All three are stored asymmetric — the caller decides
//! direction. The vocabulary is fixed at the SQL CHECK level; extending
//! it is a one-line migration.

use rusqlite::{params, Connection, Row};

use super::util::now_millis;
use crate::db::pool::DbError;

/// One row of `task_links`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskLinkRow {
    pub src_task_id: String,
    pub dst_task_id: String,
    pub kind: String,
    pub created_at: i64,
}

impl TaskLinkRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            src_task_id: row.get("src_task_id")?,
            dst_task_id: row.get("dst_task_id")?,
            kind: row.get("kind")?,
            created_at: row.get("created_at")?,
        })
    }
}

/// Insert a link. Idempotent — re-issuing the same triple returns
/// `Ok(false)` without an error.
///
/// # Errors
///
/// FK violation (unknown task ids), CHECK violation (`src == dst` or
/// unknown `kind`) surface as [`DbError::Sqlite`].
pub fn insert(
    conn: &Connection,
    src_task_id: &str,
    dst_task_id: &str,
    kind: &str,
) -> Result<bool, DbError> {
    let now = now_millis();
    let n = conn.execute(
        "INSERT INTO task_links (src_task_id, dst_task_id, kind, created_at) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(src_task_id, dst_task_id, kind) DO NOTHING",
        params![src_task_id, dst_task_id, kind, now],
    )?;
    Ok(n > 0)
}

/// Delete one link. Returns `true` when a row was removed.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(
    conn: &Connection,
    src_task_id: &str,
    dst_task_id: &str,
    kind: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM task_links \
         WHERE src_task_id = ?1 AND dst_task_id = ?2 AND kind = ?3",
        params![src_task_id, dst_task_id, kind],
    )?;
    Ok(n > 0)
}

/// List every link where `task_id` participates as either side. The
/// caller decides how to render direction. Ordering is stable so the UI
/// avoids flicker: kind ASC, then created_at ASC.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_for_task(conn: &Connection, task_id: &str) -> Result<Vec<TaskLinkRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT src_task_id, dst_task_id, kind, created_at FROM task_links \
         WHERE src_task_id = ?1 OR dst_task_id = ?1 \
         ORDER BY kind ASC, created_at ASC",
    )?;
    let rows = stmt.query_map(params![task_id], TaskLinkRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        // Seed minimal scaffolding so FK constraints succeed.
        // NB: `columns` predates the `updated_at` / `is_default`
        // columns (those landed in later migrations), so the INSERT
        // sticks to the original `001_initial.sql` shape.
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, position, created_at, updated_at) \
             VALUES ('sp1','S','sp',0,0,0); \
             INSERT INTO boards (id, space_id, name, position, created_at, updated_at) \
             VALUES ('bd1','sp1','B',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
             VALUES ('co1','bd1','C',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, description, position, created_at, updated_at) \
             VALUES ('ta','bd1','co1','sp-1','A','',1.0,0,0), \
                    ('tb','bd1','co1','sp-2','B','',2.0,0,0), \
                    ('tc','bd1','co1','sp-3','C','',3.0,0,0);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn insert_is_idempotent() {
        let conn = fresh_db();
        assert!(insert(&conn, "ta", "tb", "related").unwrap());
        assert!(!insert(&conn, "ta", "tb", "related").unwrap());
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = fresh_db();
        insert(&conn, "ta", "tb", "blocks").unwrap();
        assert!(delete(&conn, "ta", "tb", "blocks").unwrap());
        assert!(!delete(&conn, "ta", "tb", "blocks").unwrap());
    }

    #[test]
    fn list_returns_both_directions() {
        let conn = fresh_db();
        insert(&conn, "ta", "tb", "related").unwrap();
        insert(&conn, "tc", "ta", "blocks").unwrap();
        let rows = list_for_task(&conn, "ta").unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|r| r.kind == "blocks" && r.src_task_id == "tc"));
        assert!(rows.iter().any(|r| r.kind == "related" && r.dst_task_id == "tb"));
    }

    #[test]
    fn self_link_rejected_by_check() {
        let conn = fresh_db();
        let err = insert(&conn, "ta", "ta", "related").expect_err("CHECK src != dst");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn unknown_kind_rejected() {
        let conn = fresh_db();
        let err = insert(&conn, "ta", "tb", "bogus").expect_err("CHECK kind");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn fk_cascade_on_task_delete() {
        let conn = fresh_db();
        insert(&conn, "ta", "tb", "related").unwrap();
        conn.execute("DELETE FROM tasks WHERE id = 'ta'", []).unwrap();
        let rows = list_for_task(&conn, "tb").unwrap();
        assert!(rows.is_empty(), "FK cascade should wipe links");
    }
}
