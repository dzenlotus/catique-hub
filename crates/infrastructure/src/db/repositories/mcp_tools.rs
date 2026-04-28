//! MCP tools repository — CRUD on the `mcp_tools` table.
//!
//! Schema: `001_initial.sql` (base columns) + `002_skills_mcp_tools.sql`
//! (description, schema_json, position columns).

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `mcp_tools` table.
#[derive(Debug, Clone, PartialEq)]
pub struct McpToolRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub schema_json: String,
    pub color: Option<String>,
    pub position: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl McpToolRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            description: row.get("description")?,
            schema_json: row.get("schema_json")?,
            color: row.get("color")?,
            position: row.get("position")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new MCP tool.
#[derive(Debug, Clone)]
pub struct McpToolDraft {
    pub name: String,
    pub description: Option<String>,
    pub schema_json: String,
    pub color: Option<String>,
    pub position: f64,
}

/// Partial update payload. `None` means "do not change". For nullable
/// `Option<String>` fields, `Some(None)` means "set to NULL".
#[derive(Debug, Clone, Default)]
pub struct McpToolPatch {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub schema_json: Option<String>,
    pub color: Option<Option<String>>,
    pub position: Option<f64>,
}

/// `SELECT … FROM mcp_tools ORDER BY position ASC, name ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<McpToolRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, schema_json, color, position, created_at, updated_at \
         FROM mcp_tools ORDER BY position ASC, name ASC",
    )?;
    let rows = stmt.query_map([], McpToolRow::from_row)?;
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
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<McpToolRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, schema_json, color, position, created_at, updated_at \
         FROM mcp_tools WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], McpToolRow::from_row)
        .optional()?)
}

/// Insert one MCP tool. Generates id, stamps timestamps.
///
/// # Errors
///
/// UNIQUE(name) violation surfaces as [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &McpToolDraft) -> Result<McpToolRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO mcp_tools \
         (id, name, description, schema_json, color, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            id,
            draft.name,
            draft.description,
            draft.schema_json,
            draft.color,
            draft.position,
            now
        ],
    )?;
    Ok(McpToolRow {
        id,
        name: draft.name.clone(),
        description: draft.description.clone(),
        schema_json: draft.schema_json.clone(),
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
    patch: &McpToolPatch,
) -> Result<Option<McpToolRow>, DbError> {
    let now = now_millis();

    let mut clause_parts: Vec<String> = Vec::new();

    if patch.name.is_some() {
        clause_parts.push("name = COALESCE(?2, name)".into());
    }
    if patch.description.is_some() {
        clause_parts.push("description = ?3".into());
    }
    if patch.schema_json.is_some() {
        clause_parts.push("schema_json = COALESCE(?4, schema_json)".into());
    }
    if patch.color.is_some() {
        clause_parts.push("color = ?5".into());
    }
    if patch.position.is_some() {
        clause_parts.push("position = COALESCE(?6, position)".into());
    }

    let set_clause = if clause_parts.is_empty() {
        "updated_at = ?1".to_owned()
    } else {
        let mut all = clause_parts;
        all.push("updated_at = ?1".into());
        all.join(", ")
    };

    let sql = format!("UPDATE mcp_tools SET {set_clause} WHERE id = ?7");

    let description_val: Option<String> = patch.description.as_ref().and_then(Clone::clone);
    let color_val: Option<String> = patch.color.as_ref().and_then(Clone::clone);

    let updated = conn.execute(
        &sql,
        params![
            now,
            patch.name,
            description_val,
            patch.schema_json,
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

/// Delete one MCP tool by id. Cascades to `role_mcp_tools` and
/// `task_mcp_tools` via `ON DELETE CASCADE`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM mcp_tools WHERE id = ?1", params![id])?;
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
            &McpToolDraft {
                name: "bash".into(),
                description: Some("Run shell commands".into()),
                schema_json: r#"{"type":"object","properties":{"cmd":{"type":"string"}}}"#.into(),
                color: Some("#123456".into()),
                position: 1.0,
            },
        )
        .unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
        assert_eq!(got.description, Some("Run shell commands".into()));
    }

    #[test]
    fn list_ordered_by_position() {
        let conn = fresh_db();
        insert(
            &conn,
            &McpToolDraft {
                name: "b_tool".into(),
                description: None,
                schema_json: "{}".into(),
                color: None,
                position: 2.0,
            },
        )
        .unwrap();
        insert(
            &conn,
            &McpToolDraft {
                name: "a_tool".into(),
                description: None,
                schema_json: "{}".into(),
                color: None,
                position: 1.0,
            },
        )
        .unwrap();
        let list = list_all(&conn).unwrap();
        assert_eq!(list[0].name, "a_tool");
        assert_eq!(list[1].name, "b_tool");
    }

    #[test]
    fn update_returns_none_for_missing_id() {
        let conn = fresh_db();
        assert!(update(&conn, "ghost", &McpToolPatch::default())
            .unwrap()
            .is_none());
    }

    #[test]
    fn update_partial_fields() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &McpToolDraft {
                name: "old_tool".into(),
                description: None,
                schema_json: "{}".into(),
                color: None,
                position: 0.0,
            },
        )
        .unwrap();
        let updated = update(
            &conn,
            &row.id,
            &McpToolPatch {
                name: Some("new_tool".into()),
                ..McpToolPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.name, "new_tool");
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &McpToolDraft {
                name: "t".into(),
                description: None,
                schema_json: "{}".into(),
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
            &McpToolDraft {
                name: "same_tool".into(),
                description: None,
                schema_json: "{}".into(),
                color: None,
                position: 0.0,
            },
        )
        .unwrap();
        let err = insert(
            &conn,
            &McpToolDraft {
                name: "same_tool".into(),
                description: None,
                schema_json: "{}".into(),
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
