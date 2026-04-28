//! Columns repository — kanban-board lanes.
//!
//! Schema: `001_initial.sql`, Promptery v0.4 lines 35-42. Columns belong
//! to one board (CASCADE on board delete) and may carry a default role
//! (SET NULL on role delete).
//!
//! Wave-E2.4 (Olga): full CRUD + a few helpers used by use-case-side
//! existence checks. `columns.position` is integer (per Promptery v0.4 —
//! columns reorder rarely), so the repository uses `i64`.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `columns` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnRow {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub position: i64,
    pub role_id: Option<String>,
    pub created_at: i64,
}

impl ColumnRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            board_id: row.get("board_id")?,
            name: row.get("name")?,
            position: row.get("position")?,
            role_id: row.get("role_id")?,
            created_at: row.get("created_at")?,
        })
    }
}

/// Draft for inserting a new column.
#[derive(Debug, Clone)]
pub struct ColumnDraft {
    pub board_id: String,
    pub name: String,
    pub position: i64,
    pub role_id: Option<String>,
}

/// Partial update payload for `update`.
#[derive(Debug, Clone, Default)]
pub struct ColumnPatch {
    pub name: Option<String>,
    pub position: Option<i64>,
    /// `Option<Option<…>>` lets the caller distinguish "skip this field"
    /// (outer None) from "clear to NULL" (Some(None)).
    pub role_id: Option<Option<String>>,
}

/// `SELECT … FROM columns ORDER BY board_id, position ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<ColumnRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, board_id, name, position, role_id, created_at \
         FROM columns ORDER BY board_id, position ASC",
    )?;
    let rows = stmt.query_map([], ColumnRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Lookup by primary key.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<ColumnRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, board_id, name, position, role_id, created_at \
         FROM columns WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], ColumnRow::from_row)
        .optional()?)
}

/// Returns `true` if a row exists in `boards` with the given id.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn board_exists(conn: &Connection, board_id: &str) -> Result<bool, DbError> {
    let mut stmt = conn.prepare("SELECT 1 FROM boards WHERE id = ?1")?;
    Ok(stmt.exists(params![board_id])?)
}

/// Insert one column. Stamps `created_at`. The schema has no
/// `updated_at` column (Promptery v0.4 line 35-42 omits it), so updates
/// don't bump a timestamp.
///
/// # Errors
///
/// FK violation on `board_id` / `role_id` surfaces as
/// [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &ColumnDraft) -> Result<ColumnRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO columns \
            (id, board_id, name, position, role_id, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            draft.board_id,
            draft.name,
            draft.position,
            draft.role_id,
            now
        ],
    )?;
    Ok(ColumnRow {
        id,
        board_id: draft.board_id.clone(),
        name: draft.name.clone(),
        position: draft.position,
        role_id: draft.role_id.clone(),
        created_at: now,
    })
}

/// Partial update via `COALESCE`. Returns the updated row, or `None`
/// when no row matched the id.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &ColumnPatch,
) -> Result<Option<ColumnRow>, DbError> {
    let updated = match &patch.role_id {
        Some(new_role) => conn.execute(
            "UPDATE columns SET \
                 name = COALESCE(?1, name), \
                 position = COALESCE(?2, position), \
                 role_id = ?3 \
             WHERE id = ?4",
            params![patch.name, patch.position, new_role, id],
        )?,
        None => conn.execute(
            "UPDATE columns SET \
                 name = COALESCE(?1, name), \
                 position = COALESCE(?2, position) \
             WHERE id = ?3",
            params![patch.name, patch.position, id],
        )?,
    };
    if updated == 0 {
        return Ok(None);
    }
    get_by_id(conn, id)
}

/// Delete by id.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM columns WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn
    }

    fn seed_board(conn: &Connection) -> String {
        conn.execute(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
             VALUES ('sp1', 'Space', 'sp', 0, 0, 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
             VALUES ('bd1', 'Board', 'sp1', 0, 0, 0)",
            [],
        )
        .unwrap();
        "bd1".into()
    }

    #[test]
    fn insert_then_get() {
        let conn = fresh_db();
        let bd = seed_board(&conn);
        let row = insert(
            &conn,
            &ColumnDraft {
                board_id: bd,
                name: "Todo".into(),
                position: 1,
                role_id: None,
            },
        )
        .unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
    }

    #[test]
    fn list_all_groups_by_board_and_position() {
        let conn = fresh_db();
        let bd = seed_board(&conn);
        insert(
            &conn,
            &ColumnDraft {
                board_id: bd.clone(),
                name: "C2".into(),
                position: 2,
                role_id: None,
            },
        )
        .unwrap();
        insert(
            &conn,
            &ColumnDraft {
                board_id: bd,
                name: "C1".into(),
                position: 1,
                role_id: None,
            },
        )
        .unwrap();
        let rows = list_all(&conn).unwrap();
        assert_eq!(rows[0].name, "C1");
        assert_eq!(rows[1].name, "C2");
    }

    #[test]
    fn update_changes_only_supplied_fields() {
        let conn = fresh_db();
        let bd = seed_board(&conn);
        let row = insert(
            &conn,
            &ColumnDraft {
                board_id: bd,
                name: "Old".into(),
                position: 1,
                role_id: None,
            },
        )
        .unwrap();
        let updated = update(
            &conn,
            &row.id,
            &ColumnPatch {
                name: Some("New".into()),
                ..ColumnPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.name, "New");
        assert_eq!(updated.position, 1);
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = fresh_db();
        let bd = seed_board(&conn);
        let row = insert(
            &conn,
            &ColumnDraft {
                board_id: bd,
                name: "X".into(),
                position: 1,
                role_id: None,
            },
        )
        .unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn insert_with_bad_board_violates_fk() {
        let conn = fresh_db();
        let err = insert(
            &conn,
            &ColumnDraft {
                board_id: "ghost".into(),
                name: "X".into(),
                position: 1,
                role_id: None,
            },
        )
        .expect_err("FK");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn cascading_board_delete_removes_columns() {
        let conn = fresh_db();
        let bd = seed_board(&conn);
        let _row = insert(
            &conn,
            &ColumnDraft {
                board_id: bd.clone(),
                name: "C".into(),
                position: 1,
                role_id: None,
            },
        )
        .unwrap();
        conn.execute("DELETE FROM boards WHERE id = ?1", params![bd])
            .unwrap();
        let all = list_all(&conn).unwrap();
        assert!(all.is_empty(), "CASCADE should have stripped columns");
    }
}
