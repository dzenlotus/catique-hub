//! Boards repository — pure synchronous SQL.
//!
//! Reads and writes against the `boards` table from
//! `db/migrations/001_initial.sql` (Promptery v0.4 lines 22-33).
//!
//! Naming convention: this module exposes a [`BoardRow`] that mirrors
//! the table's columns 1:1 (`snake_case`, with `created_at`/`updated_at`
//! as i64 epoch-ms). The api layer maps `BoardRow` → `domain::Board`
//! via a `From` impl; that keeps the row representation an
//! infrastructure detail that we can change without touching the IPC
//! contract.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `boards` table.
#[derive(Debug, Clone, PartialEq)]
pub struct BoardRow {
    pub id: String,
    pub name: String,
    pub space_id: String,
    pub role_id: Option<String>,
    pub position: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl BoardRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            space_id: row.get("space_id")?,
            role_id: row.get("role_id")?,
            position: row.get("position")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new board. The repository fills in `id`,
/// `created_at`, `updated_at`, and the default `position` if the caller
/// passes `None`. Slug auto-generation lives elsewhere — Promptery
/// derives it from `space_counters`, which we'll wire in E2.4.
#[derive(Debug, Clone)]
pub struct BoardDraft {
    pub name: String,
    pub space_id: String,
    pub role_id: Option<String>,
    pub position: Option<f64>,
}

/// `SELECT id, name, space_id, role_id, position, created_at, updated_at
///   FROM boards ORDER BY position ASC, name ASC`.
///
/// # Errors
///
/// Surfaces any rusqlite error from `prepare` / `query_map`.
pub fn list_all(conn: &Connection) -> Result<Vec<BoardRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, space_id, role_id, position, created_at, updated_at \
         FROM boards \
         ORDER BY position ASC, name ASC",
    )?;
    let rows = stmt.query_map([], BoardRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Lookup by primary key. `Ok(None)` if the row doesn't exist.
///
/// # Errors
///
/// Surfaces any non-`QueryReturnedNoRows` rusqlite error.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<BoardRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, space_id, role_id, position, created_at, updated_at \
         FROM boards \
         WHERE id = ?1",
    )?;
    Ok(stmt.query_row(params![id], BoardRow::from_row).optional()?)
}

/// Partial-update payload for [`update`] — every field is optional;
/// `None` keeps the stored value via `COALESCE(?, current)`. The
/// `role_id` field is `Option<Option<…>>` so the caller can distinguish
/// "skip this field" (outer None) from "clear to NULL" (Some(None)).
#[derive(Debug, Clone, Default)]
pub struct BoardPatch {
    pub name: Option<String>,
    pub position: Option<f64>,
    pub role_id: Option<Option<String>>,
}

/// Partial update via `COALESCE`. Bumps `updated_at`. Returns the
/// updated row, or `Ok(None)` if no row matched the id.
///
/// # Errors
///
/// FK violation on `role_id` surfaces as [`DbError::Sqlite`].
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &BoardPatch,
) -> Result<Option<BoardRow>, DbError> {
    let now = now_millis();
    let updated = match &patch.role_id {
        Some(new_role) => conn.execute(
            "UPDATE boards SET \
                 name = COALESCE(?1, name), \
                 position = COALESCE(?2, position), \
                 role_id = ?3, \
                 updated_at = ?4 \
             WHERE id = ?5",
            params![patch.name, patch.position, new_role, now, id],
        )?,
        None => conn.execute(
            "UPDATE boards SET \
                 name = COALESCE(?1, name), \
                 position = COALESCE(?2, position), \
                 updated_at = ?3 \
             WHERE id = ?4",
            params![patch.name, patch.position, now, id],
        )?,
    };
    if updated == 0 {
        return Ok(None);
    }
    get_by_id(conn, id)
}

/// Delete one board. Cascades to `columns` (and their `tasks`),
/// `board_prompts`. Other entity FKs (e.g. tasks.board_id) cascade by
/// schema.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM boards WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

/// Insert one board. Generates id via `nanoid` (21-char URL-safe alphabet,
/// the crate default — collision probability negligible for desktop
/// scale). `created_at` / `updated_at` are stamped from `now_millis`.
///
/// All parameters bound positionally — no string concat (NFR §4.3 SQL
/// injection guard).
///
/// # Errors
///
/// Bubbles any FK violation (`SQLITE_CONSTRAINT_FOREIGNKEY` — bad
/// `space_id` or `role_id`) up to the caller as
/// [`DbError::Sqlite`]; the use-case layer maps it to `AppError::NotFound`.
pub fn insert(conn: &Connection, draft: &BoardDraft) -> Result<BoardRow, DbError> {
    let id = new_id();
    let now = now_millis();
    let position = draft.position.unwrap_or(0.0);

    conn.execute(
        "INSERT INTO boards \
            (id, name, space_id, role_id, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, draft.name, draft.space_id, draft.role_id, position, now],
    )?;

    Ok(BoardRow {
        id,
        name: draft.name.clone(),
        space_id: draft.space_id.clone(),
        role_id: draft.role_id.clone(),
        position,
        created_at: now,
        updated_at: now,
    })
}

/// Returns `true` if a row exists in `spaces` with the given id. Used
/// by the use-case layer to translate a missing-space situation into
/// `AppError::NotFound { entity: "space", ... }` *before* the FK fires
/// — friendlier than letting the driver's `SQLITE_CONSTRAINT_FOREIGNKEY`
/// bubble up.
///
/// # Errors
///
/// Surfaces rusqlite errors only. `Ok(false)` for "row doesn't exist".
pub fn space_exists(conn: &Connection, space_id: &str) -> Result<bool, DbError> {
    let mut stmt = conn.prepare("SELECT 1 FROM spaces WHERE id = ?1")?;
    let exists = stmt.exists(params![space_id])?;
    Ok(exists)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;
    use rusqlite::Connection;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open mem");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("PRAGMA");
        run_pending(&mut conn).expect("migrations");
        conn
    }

    fn seed_space(conn: &Connection, id: &str, prefix: &str) {
        conn.execute(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
             VALUES (?1, ?2, ?3, 0, 0, 0, 0)",
            params![id, format!("Space {id}"), prefix],
        )
        .expect("seed space");
    }

    #[test]
    fn list_all_on_empty_db_returns_empty_vec() {
        let conn = fresh_db();
        let rows = list_all(&conn).expect("list");
        assert!(rows.is_empty());
    }

    #[test]
    fn insert_then_list_returns_the_row() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        let row = insert(
            &conn,
            &BoardDraft {
                name: "Board A".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: Some(1.0),
            },
        )
        .expect("insert");
        assert_eq!(row.name, "Board A");
        assert_eq!(row.space_id, "sp1");
        assert!((row.position - 1.0).abs() < f64::EPSILON);
        assert_eq!(row.created_at, row.updated_at);

        let rows = list_all(&conn).expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0], row);
    }

    #[test]
    fn list_all_orders_by_position_then_name() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        let _b = insert(
            &conn,
            &BoardDraft {
                name: "Beta".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: Some(2.0),
            },
        )
        .unwrap();
        let _a = insert(
            &conn,
            &BoardDraft {
                name: "Alpha".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: Some(2.0),
            },
        )
        .unwrap();
        let _z = insert(
            &conn,
            &BoardDraft {
                name: "Zeta".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: Some(1.0),
            },
        )
        .unwrap();
        let rows = list_all(&conn).unwrap();
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["Zeta", "Alpha", "Beta"]);
    }

    #[test]
    fn get_by_id_returns_none_for_missing() {
        let conn = fresh_db();
        let row = get_by_id(&conn, "does-not-exist").expect("query");
        assert!(row.is_none());
    }

    #[test]
    fn get_by_id_returns_some_for_existing() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        let inserted = insert(
            &conn,
            &BoardDraft {
                name: "Board".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: None,
            },
        )
        .unwrap();
        let fetched = get_by_id(&conn, &inserted.id).unwrap();
        assert_eq!(fetched, Some(inserted));
    }

    #[test]
    fn insert_with_bad_space_violates_fk() {
        let conn = fresh_db();
        // No space seeded; FK should refuse the insert under
        // PRAGMA foreign_keys = ON.
        let err = insert(
            &conn,
            &BoardDraft {
                name: "Doomed".into(),
                space_id: "ghost".into(),
                role_id: None,
                position: None,
            },
        )
        .expect_err("FK violation expected");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("expected ConstraintViolation, got {other:?}"),
        }
    }

    #[test]
    fn space_exists_reports_correctly() {
        let conn = fresh_db();
        assert!(!space_exists(&conn, "sp1").unwrap());
        seed_space(&conn, "sp1", "abc");
        assert!(space_exists(&conn, "sp1").unwrap());
    }
}
