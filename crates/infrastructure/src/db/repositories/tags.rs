//! Tags repository — globally-unique labels for prompts.
//!
//! Schema: `001_initial.sql`, Promptery v0.4 lines 298-315. The
//! `prompt_tags` join lives here because tags are the "label" side of a
//! tag↔prompt relationship — Promptery's UI thinks of it as
//! "manage which tags this prompt has". Add/remove helpers reflect
//! that.
//!
//! Wave-E2.4 (Olga). Tag autocomplete / search is **deferred to E3** —
//! `list_all` here is fine for the small N.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `tags` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagRow {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl TagRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            color: row.get("color")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new tag.
#[derive(Debug, Clone)]
pub struct TagDraft {
    pub name: String,
    pub color: Option<String>,
}

/// Partial update payload.
#[derive(Debug, Clone, Default)]
pub struct TagPatch {
    pub name: Option<String>,
    pub color: Option<Option<String>>,
}

/// `SELECT … FROM tags ORDER BY name ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<TagRow>, DbError> {
    let mut stmt =
        conn.prepare("SELECT id, name, color, created_at, updated_at FROM tags ORDER BY name ASC")?;
    let rows = stmt.query_map([], TagRow::from_row)?;
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
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<TagRow>, DbError> {
    let mut stmt =
        conn.prepare("SELECT id, name, color, created_at, updated_at FROM tags WHERE id = ?1")?;
    Ok(stmt.query_row(params![id], TagRow::from_row).optional()?)
}

/// Insert one tag. Generates id, stamps timestamps.
///
/// # Errors
///
/// UNIQUE(name) violation surfaces as [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &TagDraft) -> Result<TagRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO tags (id, name, color, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, draft.name, draft.color, now],
    )?;
    Ok(TagRow {
        id,
        name: draft.name.clone(),
        color: draft.color.clone(),
        created_at: now,
        updated_at: now,
    })
}

/// Partial update via `COALESCE`. Bumps `updated_at`.
///
/// # Errors
///
/// UNIQUE(name) violation surfaces as [`DbError::Sqlite`].
pub fn update(conn: &Connection, id: &str, patch: &TagPatch) -> Result<Option<TagRow>, DbError> {
    let now = now_millis();
    let updated = match &patch.color {
        Some(new_color) => conn.execute(
            "UPDATE tags SET name = COALESCE(?1, name), color = ?2, updated_at = ?3 WHERE id = ?4",
            params![patch.name, new_color, now, id],
        )?,
        None => conn.execute(
            "UPDATE tags SET name = COALESCE(?1, name), updated_at = ?2 WHERE id = ?3",
            params![patch.name, now, id],
        )?,
    };
    if updated == 0 {
        return Ok(None);
    }
    get_by_id(conn, id)
}

/// Delete one tag. Cascades to `prompt_tags` (FK ON DELETE CASCADE).
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

// ---------------------------------------------------------------------
// prompt_tags join helpers — tags own this relationship.
// ---------------------------------------------------------------------

/// Attach a tag to a prompt. Idempotent on `(prompt_id, tag_id)`.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn add_prompt_tag(conn: &Connection, prompt_id: &str, tag_id: &str) -> Result<(), DbError> {
    let now = now_millis();
    conn.execute(
        "INSERT INTO prompt_tags (prompt_id, tag_id, added_at) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(prompt_id, tag_id) DO NOTHING",
        params![prompt_id, tag_id, now],
    )?;
    Ok(())
}

/// Detach a tag from a prompt.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_prompt_tag(
    conn: &Connection,
    prompt_id: &str,
    tag_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM prompt_tags WHERE prompt_id = ?1 AND tag_id = ?2",
        params![prompt_id, tag_id],
    )?;
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

    #[test]
    fn insert_then_get() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &TagDraft {
                name: "rust".into(),
                color: Some("#fed7aa".into()),
            },
        )
        .unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
    }

    #[test]
    fn unique_name_violation() {
        let conn = fresh_db();
        insert(
            &conn,
            &TagDraft {
                name: "tag".into(),
                color: None,
            },
        )
        .unwrap();
        let err = insert(
            &conn,
            &TagDraft {
                name: "tag".into(),
                color: None,
            },
        )
        .expect_err("UNIQUE");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_returns_none_for_missing_id() {
        let conn = fresh_db();
        assert!(update(&conn, "ghost", &TagPatch::default())
            .unwrap()
            .is_none());
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &TagDraft {
                name: "x".into(),
                color: None,
            },
        )
        .unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn prompt_tag_join_idempotent() {
        let conn = fresh_db();
        let tag = insert(
            &conn,
            &TagDraft {
                name: "t".into(),
                color: None,
            },
        )
        .unwrap();
        conn.execute(
            "INSERT INTO prompts (id, name, content, created_at, updated_at) \
             VALUES ('p1','P','',0,0)",
            [],
        )
        .unwrap();
        add_prompt_tag(&conn, "p1", &tag.id).unwrap();
        add_prompt_tag(&conn, "p1", &tag.id).unwrap(); // idempotent
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM prompt_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        assert!(remove_prompt_tag(&conn, "p1", &tag.id).unwrap());
        assert!(!remove_prompt_tag(&conn, "p1", &tag.id).unwrap());
    }
}
