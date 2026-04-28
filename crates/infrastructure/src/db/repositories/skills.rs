//! Skills repository — CRUD on the `skills` table.
//!
//! Schema: `001_initial.sql` (base columns) + `002_skills_mcp_tools.sql`
//! (description, position columns).

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `skills` table.
#[derive(Debug, Clone, PartialEq)]
pub struct SkillRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub position: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl SkillRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            description: row.get("description")?,
            color: row.get("color")?,
            position: row.get("position")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new skill.
#[derive(Debug, Clone)]
pub struct SkillDraft {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub position: f64,
}

/// Partial update payload. `None` means "do not change". For nullable
/// `Option<String>` fields, `Some(None)` means "set to NULL".
#[derive(Debug, Clone, Default)]
pub struct SkillPatch {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub color: Option<Option<String>>,
    pub position: Option<f64>,
}

/// `SELECT … FROM skills ORDER BY position ASC, name ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<SkillRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, color, position, created_at, updated_at \
         FROM skills ORDER BY position ASC, name ASC",
    )?;
    let rows = stmt.query_map([], SkillRow::from_row)?;
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
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<SkillRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, color, position, created_at, updated_at \
         FROM skills WHERE id = ?1",
    )?;
    Ok(stmt.query_row(params![id], SkillRow::from_row).optional()?)
}

/// Insert one skill. Generates id, stamps timestamps.
///
/// # Errors
///
/// UNIQUE(name) violation surfaces as [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &SkillDraft) -> Result<SkillRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO skills (id, name, description, color, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            id,
            draft.name,
            draft.description,
            draft.color,
            draft.position,
            now
        ],
    )?;
    Ok(SkillRow {
        id,
        name: draft.name.clone(),
        description: draft.description.clone(),
        color: draft.color.clone(),
        position: draft.position,
        created_at: now,
        updated_at: now,
    })
}

/// Partial update. Bumps `updated_at` regardless.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &SkillPatch,
) -> Result<Option<SkillRow>, DbError> {
    let now = now_millis();

    // Build the SET clause dynamically to support nullable field patching.
    let mut clause_parts: Vec<String> = Vec::new();

    if patch.name.is_some() {
        clause_parts.push("name = COALESCE(?2, name)".into());
    }
    if patch.description.is_some() {
        clause_parts.push("description = ?3".into());
    }
    if patch.color.is_some() {
        clause_parts.push("color = ?4".into());
    }
    if patch.position.is_some() {
        clause_parts.push("position = COALESCE(?5, position)".into());
    }

    // We always bump updated_at; collect extra SET items first.
    let set_clause = if clause_parts.is_empty() {
        "updated_at = ?1".to_owned()
    } else {
        let mut all = clause_parts;
        all.push("updated_at = ?1".into());
        all.join(", ")
    };
    let sql = format!("UPDATE skills SET {set_clause} WHERE id = ?6");

    let description_val: Option<String> = patch.description.as_ref().and_then(Clone::clone);
    let color_val: Option<String> = patch.color.as_ref().and_then(Clone::clone);

    let updated = conn.execute(
        &sql,
        params![
            now,
            patch.name,
            description_val,
            color_val,
            patch.position,
            id
        ],
    )?;
    if updated == 0 {
        return Ok(None);
    }
    get_by_id(conn, id)
}

/// Delete one skill by id. Cascades to `role_skills` and `task_skills`
/// via `ON DELETE CASCADE` defined in `001_initial.sql`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM skills WHERE id = ?1", params![id])?;
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
            &SkillDraft {
                name: "Rust".into(),
                description: Some("Low-level systems".into()),
                color: Some("#abcdef".into()),
                position: 1.0,
            },
        )
        .unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
        assert_eq!(got.description, Some("Low-level systems".into()));
    }

    #[test]
    fn list_ordered_by_position() {
        let conn = fresh_db();
        insert(
            &conn,
            &SkillDraft {
                name: "B".into(),
                description: None,
                color: None,
                position: 2.0,
            },
        )
        .unwrap();
        insert(
            &conn,
            &SkillDraft {
                name: "A".into(),
                description: None,
                color: None,
                position: 1.0,
            },
        )
        .unwrap();
        let list = list_all(&conn).unwrap();
        assert_eq!(list[0].name, "A");
        assert_eq!(list[1].name, "B");
    }

    #[test]
    fn update_returns_none_for_missing_id() {
        let conn = fresh_db();
        assert!(update(&conn, "ghost", &SkillPatch::default())
            .unwrap()
            .is_none());
    }

    #[test]
    fn update_partial_fields() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &SkillDraft {
                name: "Old".into(),
                description: None,
                color: None,
                position: 0.0,
            },
        )
        .unwrap();
        let updated = update(
            &conn,
            &row.id,
            &SkillPatch {
                name: Some("New".into()),
                ..SkillPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.name, "New");
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &SkillDraft {
                name: "S".into(),
                description: None,
                color: None,
                position: 0.0,
            },
        )
        .unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn unique_name_violation() {
        let conn = fresh_db();
        insert(
            &conn,
            &SkillDraft {
                name: "Same".into(),
                description: None,
                color: None,
                position: 0.0,
            },
        )
        .unwrap();
        let err = insert(
            &conn,
            &SkillDraft {
                name: "Same".into(),
                description: None,
                color: None,
                position: 1.0,
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
}
