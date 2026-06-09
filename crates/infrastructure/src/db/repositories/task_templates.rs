//! Task-template repository — named markdown skeletons for new tasks
//! (catique-1). Schema + built-in seeds live in `043_task_templates.sql`.
//!
//! Plain CRUD. `kind` is validated at the application layer against the
//! same fixed vocabulary the SQL CHECK enforces.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of `task_templates`.
#[derive(Debug, Clone, PartialEq)]
pub struct TaskTemplateRow {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub description: String,
    pub body: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub position: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl TaskTemplateRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            kind: row.get("kind")?,
            description: row.get("description")?,
            body: row.get("body")?,
            icon: row.get("icon")?,
            color: row.get("color")?,
            position: row.get("position")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Insert draft. Values are expected validated by the caller.
#[derive(Debug, Clone)]
pub struct TaskTemplateDraft {
    pub name: String,
    pub kind: String,
    pub description: String,
    pub body: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub position: f64,
}

/// Partial update. `None` = leave alone; `Some(_)` = set. `icon` / `color`
/// here can only be *set* (no clear-to-null) — cosmetic fields, the edge
/// case isn't worth a tri-state on this surface.
#[derive(Debug, Clone, Default)]
pub struct TaskTemplatePatch {
    pub name: Option<String>,
    pub kind: Option<String>,
    pub description: Option<String>,
    pub body: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub position: Option<f64>,
}

const COLS: &str =
    "id, name, kind, description, body, icon, color, position, created_at, updated_at";

/// List every template, position ASC then name ASC.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<TaskTemplateRow>, DbError> {
    let sql = format!("SELECT {COLS} FROM task_templates ORDER BY position ASC, name ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], TaskTemplateRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Lookup one template by primary key.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<TaskTemplateRow>, DbError> {
    let sql = format!("SELECT {COLS} FROM task_templates WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    Ok(stmt
        .query_row(params![id], TaskTemplateRow::from_row)
        .optional()?)
}

/// Insert one template.
///
/// # Errors
///
/// CHECK violation on `kind` surfaces as [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &TaskTemplateDraft) -> Result<TaskTemplateRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO task_templates \
            (id, name, kind, description, body, icon, color, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            draft.name,
            draft.kind,
            draft.description,
            draft.body,
            draft.icon,
            draft.color,
            draft.position,
            now,
        ],
    )?;
    Ok(TaskTemplateRow {
        id,
        name: draft.name.clone(),
        kind: draft.kind.clone(),
        description: draft.description.clone(),
        body: draft.body.clone(),
        icon: draft.icon.clone(),
        color: draft.color.clone(),
        position: draft.position,
        created_at: now,
        updated_at: now,
    })
}

/// Partial update. Returns `None` when the id is unknown.
///
/// # Errors
///
/// CHECK violation on a changed `kind` surfaces as [`DbError::Sqlite`].
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &TaskTemplatePatch,
) -> Result<Option<TaskTemplateRow>, DbError> {
    let Some(cur) = get_by_id(conn, id)? else {
        return Ok(None);
    };
    let name = patch.name.clone().unwrap_or(cur.name);
    let kind = patch.kind.clone().unwrap_or(cur.kind);
    let description = patch.description.clone().unwrap_or(cur.description);
    let body = patch.body.clone().unwrap_or(cur.body);
    let icon = patch.icon.clone().or(cur.icon);
    let color = patch.color.clone().or(cur.color);
    let position = patch.position.unwrap_or(cur.position);
    let now = now_millis();
    conn.execute(
        "UPDATE task_templates SET \
            name = ?2, kind = ?3, description = ?4, body = ?5, icon = ?6, \
            color = ?7, position = ?8, updated_at = ?9 \
         WHERE id = ?1",
        params![
            id,
            name,
            kind,
            description,
            body,
            icon,
            color,
            position,
            now
        ],
    )?;
    get_by_id(conn, id)
}

/// Delete one template. Returns `true` when a row was removed.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM task_templates WHERE id = ?1", params![id])?;
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
    fn seeds_three_builtins() {
        let conn = fresh_db();
        let all = list_all(&conn).unwrap();
        assert!(all
            .iter()
            .any(|t| t.id == "tmpl-feature" && t.kind == "feature"));
        assert!(all.iter().any(|t| t.id == "tmpl-bug" && t.kind == "bug"));
        assert!(all
            .iter()
            .any(|t| t.id == "tmpl-research" && t.kind == "research"));
        // Built-in bodies are non-empty markdown skeletons.
        let bug = all.iter().find(|t| t.id == "tmpl-bug").unwrap();
        assert!(bug.body.contains("Steps to reproduce"));
    }

    #[test]
    fn insert_update_delete_round_trip() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &TaskTemplateDraft {
                name: "Spike".into(),
                kind: "custom".into(),
                description: "d".into(),
                body: "## Spike".into(),
                icon: None,
                color: None,
                position: 9.0,
            },
        )
        .unwrap();
        let updated = update(
            &conn,
            &row.id,
            &TaskTemplatePatch {
                body: Some("## Spike v2".into()),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.body, "## Spike v2");
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn unknown_kind_rejected() {
        let conn = fresh_db();
        let err = insert(
            &conn,
            &TaskTemplateDraft {
                name: "x".into(),
                kind: "bogus".into(),
                description: String::new(),
                body: String::new(),
                icon: None,
                color: None,
                position: 0.0,
            },
        )
        .expect_err("CHECK kind");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }
}
