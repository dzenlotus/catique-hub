//! Spaces repository — pure synchronous SQL.
//!
//! Reads and writes against the `spaces` table from
//! `db/migrations/001_initial.sql` (Promptery v0.4 lines 1-15).
//!
//! Spaces are the top-level partition: every board lives inside one,
//! every task slug derives from the space's `prefix`. The `prefix`
//! column carries a CHECK constraint (`[a-z0-9-]{1,10}`) which the
//! repository surfaces as a generic `ConstraintViolation`; the
//! use-case layer maps it to `AppError::Validation`.
//!
//! Naming: [`SpaceRow`] mirrors the table 1:1; the api layer maps it to
//! `domain::Space` via a hand-written conversion in the use-case layer
//! (same approach as boards).

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `spaces` table.
#[derive(Debug, Clone, PartialEq)]
pub struct SpaceRow {
    pub id: String,
    pub name: String,
    pub prefix: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub position: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl SpaceRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let is_default: i64 = row.get("is_default")?;
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            prefix: row.get("prefix")?,
            description: row.get("description")?,
            is_default: is_default != 0,
            position: row.get("position")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new space. The repository fills `id`,
/// `created_at`, `updated_at`. `position` defaults to 0.0 and
/// `is_default` defaults to `false` when omitted.
#[derive(Debug, Clone)]
pub struct SpaceDraft {
    pub name: String,
    pub prefix: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub position: Option<f64>,
}

/// Partial update payload — every field is optional; `None` keeps the
/// stored value via `COALESCE(?, current)`. The repository always bumps
/// `updated_at` regardless of which fields changed.
#[derive(Debug, Clone, Default)]
pub struct SpacePatch {
    pub name: Option<String>,
    pub description: Option<Option<String>>, // None = keep, Some(None) = NULL
    pub is_default: Option<bool>,
    pub position: Option<f64>,
}

/// `SELECT … FROM spaces ORDER BY position ASC, name ASC`.
///
/// # Errors
///
/// Surfaces any rusqlite error from `prepare` / `query_map`.
pub fn list_all(conn: &Connection) -> Result<Vec<SpaceRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, prefix, description, is_default, position, created_at, updated_at \
         FROM spaces \
         ORDER BY position ASC, name ASC",
    )?;
    let rows = stmt.query_map([], SpaceRow::from_row)?;
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
/// Surfaces non-`QueryReturnedNoRows` rusqlite errors.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<SpaceRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, prefix, description, is_default, position, created_at, updated_at \
         FROM spaces WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], SpaceRow::from_row)
        .optional()?)
}

/// Insert one space. Generates id via `nanoid`, stamps timestamps from
/// `now_millis()`. The schema enforces UNIQUE(`prefix`) and the CHECK
/// `prefix GLOB '[a-z0-9-]*' AND length BETWEEN 1 AND 10` — both surface
/// as `SQLITE_CONSTRAINT` errors that the use case maps appropriately.
///
/// # Errors
///
/// Bubbles up rusqlite errors (constraint violations, etc.) as
/// [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &SpaceDraft) -> Result<SpaceRow, DbError> {
    let id = new_id();
    let now = now_millis();
    let position = draft.position.unwrap_or(0.0);
    let is_default = i64::from(draft.is_default);

    conn.execute(
        "INSERT INTO spaces \
            (id, name, prefix, description, is_default, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, draft.name, draft.prefix, draft.description, is_default, position, now],
    )?;

    Ok(SpaceRow {
        id,
        name: draft.name.clone(),
        prefix: draft.prefix.clone(),
        description: draft.description.clone(),
        is_default: draft.is_default,
        position,
        created_at: now,
        updated_at: now,
    })
}

/// Partial update via `COALESCE(?, current)`. Returns the row after the
/// update, or `Ok(None)` if no row had the requested id.
///
/// Note: `description` is `Option<Option<String>>` — `None` means keep
/// the stored value; `Some(None)` means clear it to NULL.
///
/// # Errors
///
/// Constraint violations on `prefix` (UNIQUE, CHECK) bubble up as
/// [`DbError::Sqlite`]; the use-case layer translates them to
/// `AppError::Conflict` / `AppError::Validation`.
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &SpacePatch,
) -> Result<Option<SpaceRow>, DbError> {
    let now = now_millis();
    let is_default_param: Option<i64> = patch.is_default.map(i64::from);
    // `description` has Option<Option<String>>: outer None = "skip",
    // inner None = "set to NULL". COALESCE collapses skip → keep, while
    // an explicit (Some(NULL_STRING)) is supplied as None to rusqlite —
    // we model that with an extra "clear flag" because COALESCE itself
    // cannot distinguish "pass NULL to overwrite" from "pass NULL to
    // skip". Two separate updaters keep the SQL simple.
    let updated = match &patch.description {
        Some(new) => conn.execute(
            "UPDATE spaces SET \
                 name = COALESCE(?1, name), \
                 description = ?2, \
                 is_default = COALESCE(?3, is_default), \
                 position = COALESCE(?4, position), \
                 updated_at = ?5 \
             WHERE id = ?6",
            params![patch.name, new, is_default_param, patch.position, now, id],
        )?,
        None => conn.execute(
            "UPDATE spaces SET \
                 name = COALESCE(?1, name), \
                 is_default = COALESCE(?2, is_default), \
                 position = COALESCE(?3, position), \
                 updated_at = ?4 \
             WHERE id = ?5",
            params![patch.name, is_default_param, patch.position, now, id],
        )?,
    };
    if updated == 0 {
        return Ok(None);
    }
    get_by_id(conn, id)
}

/// Delete by id. Returns `true` if a row was actually removed.
///
/// FK semantics: `boards.space_id` has no `ON DELETE` clause (NOT NULL
/// REFERENCES spaces), so deleting a non-empty space fails with
/// `SQLITE_CONSTRAINT_FOREIGNKEY`. The use case maps that to
/// `AppError::Conflict`. `space_counters` cascades automatically.
///
/// # Errors
///
/// Surfaces rusqlite errors. FK violation bubbles up unchanged.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM spaces WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;
    use rusqlite::Connection;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open mem");
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn
    }

    fn draft(prefix: &str) -> SpaceDraft {
        SpaceDraft {
            name: format!("Space {prefix}"),
            prefix: prefix.into(),
            description: None,
            is_default: false,
            position: Some(0.0),
        }
    }

    #[test]
    fn insert_then_get_returns_same_row() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("abc")).unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
    }

    #[test]
    fn list_all_orders_by_position_then_name() {
        let conn = fresh_db();
        insert(
            &conn,
            &SpaceDraft {
                name: "Beta".into(),
                prefix: "bb".into(),
                description: None,
                is_default: false,
                position: Some(2.0),
            },
        )
        .unwrap();
        insert(
            &conn,
            &SpaceDraft {
                name: "Alpha".into(),
                prefix: "aa".into(),
                description: None,
                is_default: false,
                position: Some(2.0),
            },
        )
        .unwrap();
        insert(
            &conn,
            &SpaceDraft {
                name: "Zeta".into(),
                prefix: "zz".into(),
                description: None,
                is_default: false,
                position: Some(1.0),
            },
        )
        .unwrap();
        let rows = list_all(&conn).unwrap();
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["Zeta", "Alpha", "Beta"]);
    }

    #[test]
    fn update_changes_only_supplied_fields() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("abc")).unwrap();
        let updated = update(
            &conn,
            &row.id,
            &SpacePatch {
                name: Some("Renamed".into()),
                description: Some(Some("New desc".into())),
                ..SpacePatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.description.as_deref(), Some("New desc"));
        assert_eq!(updated.prefix, "abc"); // unchanged
        assert!(updated.updated_at >= row.created_at);
    }

    #[test]
    fn update_returns_none_for_missing_id() {
        let conn = fresh_db();
        let res = update(&conn, "ghost", &SpacePatch::default()).unwrap();
        assert!(res.is_none());
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("abc")).unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
        assert!(get_by_id(&conn, &row.id).unwrap().is_none());
    }

    #[test]
    fn unique_prefix_violation_is_constraint_error() {
        let conn = fresh_db();
        insert(&conn, &draft("abc")).unwrap();
        let err = insert(&conn, &draft("abc")).expect_err("unique violation");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("expected ConstraintViolation, got {other:?}"),
        }
    }
}
