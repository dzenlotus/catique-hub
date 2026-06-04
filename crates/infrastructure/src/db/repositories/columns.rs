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
    /// `true` for the board's default column (migration
    /// `016_default_board_naming_and_constraints.sql`). Default columns
    /// are immutable in the delete path: the use-case layer refuses to
    /// remove them, and cross-board task moves drop tasks here. Stored
    /// as INTEGER 0/1 — converted on read.
    pub is_default: bool,
    /// Optional icon registry name. Migration `031_columns_icon_color.sql`.
    pub icon: Option<String>,
    /// Optional CSS color string. Migration `031_columns_icon_color.sql`.
    pub color: Option<String>,
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
            is_default: row.get::<_, i64>("is_default")? != 0,
            icon: row.get("icon")?,
            color: row.get("color")?,
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
    /// `true` flags this column as the board's mandatory default
    /// (migration `016_*`). Set on insert only — there is no patch
    /// path that mutates this column, mirroring `boards.is_default`.
    pub is_default: bool,
    /// Optional icon registry name. Defaults to `None`.
    pub icon: Option<String>,
    /// Optional CSS color string. Defaults to `None`.
    pub color: Option<String>,
}

/// Partial update payload for `update`.
#[derive(Debug, Clone, Default)]
pub struct ColumnPatch {
    pub name: Option<String>,
    pub position: Option<i64>,
    /// `Option<Option<…>>` lets the caller distinguish "skip this field"
    /// (outer None) from "clear to NULL" (Some(None)).
    pub role_id: Option<Option<String>>,
    /// Tri-state — same semantics as `role_id`.
    pub icon: Option<Option<String>>,
    /// Tri-state — same semantics as `role_id`.
    pub color: Option<Option<String>>,
}

/// `SELECT … FROM columns ORDER BY board_id, position ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<ColumnRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, board_id, name, position, role_id, created_at, is_default, icon, color \
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
        "SELECT id, board_id, name, position, role_id, created_at, is_default, icon, color \
         FROM columns WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], ColumnRow::from_row)
        .optional()?)
}

/// Look up the default column for a board, if any. Migration `016_*`
/// guarantees every board owns exactly one default column, but this
/// helper still returns `Option` because the database state may briefly
/// drift during multi-step migrations or test fixtures.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get_default_for_board(
    conn: &Connection,
    board_id: &str,
) -> Result<Option<ColumnRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, board_id, name, position, role_id, created_at, is_default, icon, color \
         FROM columns WHERE board_id = ?1 AND is_default = 1 \
         ORDER BY position ASC LIMIT 1",
    )?;
    Ok(stmt
        .query_row(params![board_id], ColumnRow::from_row)
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
    let is_default = i64::from(draft.is_default);
    conn.execute(
        "INSERT INTO columns \
            (id, board_id, name, position, role_id, is_default, created_at, icon, color) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            draft.board_id,
            draft.name,
            draft.position,
            draft.role_id,
            is_default,
            now,
            draft.icon,
            draft.color,
        ],
    )?;
    Ok(ColumnRow {
        id,
        board_id: draft.board_id.clone(),
        name: draft.name.clone(),
        position: draft.position,
        role_id: draft.role_id.clone(),
        created_at: now,
        is_default: draft.is_default,
        icon: draft.icon.clone(),
        color: draft.color.clone(),
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
    // Dynamic SQL — each tri-state nullable column would otherwise
    // require 2^N branches against `COALESCE`. We collect SET fragments
    // and bind values in lockstep; the empty-patch case short-circuits
    // to a plain existence check.
    let mut sets: Vec<&'static str> = Vec::new();
    let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(name) = &patch.name {
        sets.push("name = ?");
        binds.push(Box::new(name.clone()));
    }
    if let Some(position) = patch.position {
        sets.push("position = ?");
        binds.push(Box::new(position));
    }
    if let Some(role_id) = &patch.role_id {
        sets.push("role_id = ?");
        binds.push(Box::new(role_id.clone()));
    }
    if let Some(icon) = &patch.icon {
        sets.push("icon = ?");
        binds.push(Box::new(icon.clone()));
    }
    if let Some(color) = &patch.color {
        sets.push("color = ?");
        binds.push(Box::new(color.clone()));
    }
    if sets.is_empty() {
        // No-op patch — return the current row (or None if id is gone).
        return get_by_id(conn, id);
    }
    let sql = format!("UPDATE columns SET {} WHERE id = ?", sets.join(", "));
    binds.push(Box::new(id.to_owned()));
    let params_vec: Vec<&dyn rusqlite::ToSql> = binds.iter().map(AsRef::as_ref).collect();
    let updated = conn.execute(&sql, params_vec.as_slice())?;
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
                is_default: false,
                icon: None,
                color: None,
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
                is_default: false,
                icon: None,
                color: None,
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
                is_default: false,
                icon: None,
                color: None,
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
                is_default: false,
                icon: None,
                color: None,
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
                is_default: false,
                icon: None,
                color: None,
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
                is_default: false,
                icon: None,
                color: None,
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
                is_default: false,
                icon: None,
                color: None,
            },
        )
        .unwrap();
        conn.execute("DELETE FROM boards WHERE id = ?1", params![bd])
            .unwrap();
        let all = list_all(&conn).unwrap();
        assert!(all.is_empty(), "CASCADE should have stripped columns");
    }
}
