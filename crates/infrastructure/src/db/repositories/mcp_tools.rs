//! MCP tools repository — CRUD on the `mcp_tools` table.
//!
//! Schema: `001_initial.sql` (base columns) + `002_skills_mcp_tools.sql`
//! (description, schema_json, position columns).

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// Source discriminator for an `mcp_tools` row.
///
/// Mirrored from `catique_domain::McpToolSource`; kept as a string at
/// the storage layer because rusqlite has no native enum-as-text
/// support and the column is a TEXT-CHECK.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpToolSourceRow {
    Upstream,
    Manual,
}

impl McpToolSourceRow {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Upstream => "upstream",
            Self::Manual => "manual",
        }
    }

    /// Cross-module accessor used by repository code that hand-builds
    /// an [`McpToolRow`] from a JOIN row (see `tasks::resolve_task_mcp_tools`).
    pub fn from_str_pub(s: &str) -> rusqlite::Result<Self> {
        Self::from_str(s)
    }

    fn from_str(s: &str) -> rusqlite::Result<Self> {
        match s {
            "upstream" => Ok(Self::Upstream),
            "manual" => Ok(Self::Manual),
            other => Err(rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("mcp_tools.source = `{other}` (expected `upstream` or `manual`)"),
                )),
            )),
        }
    }
}

/// One row of the `mcp_tools` table.
#[derive(Debug, Clone, PartialEq)]
pub struct McpToolRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub schema_json: String,
    pub color: Option<String>,
    pub position: f64,
    /// FK to `mcp_servers(id)`. `None` for `Manual` rows.
    pub server_id: Option<String>,
    pub upstream_name: Option<String>,
    pub source: McpToolSourceRow,
    pub last_synced_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl McpToolRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let source_text: String = row.get("source")?;
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            description: row.get("description")?,
            schema_json: row.get("schema_json")?,
            color: row.get("color")?,
            position: row.get("position")?,
            server_id: row.get("server_id")?,
            upstream_name: row.get("upstream_name")?,
            source: McpToolSourceRow::from_str(&source_text)?,
            last_synced_at: row.get("last_synced_at")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new MCP tool.
///
/// The four upstream-only fields (`server_id`, `upstream_name`,
/// `source`, `last_synced_at`) carry `Option<…>` so manual-path callers
/// can keep using the old shape — `McpToolDraft::manual(…)` constructor
/// is the ergonomic entry point for that case.
#[derive(Debug, Clone)]
pub struct McpToolDraft {
    pub name: String,
    pub description: Option<String>,
    pub schema_json: String,
    pub color: Option<String>,
    pub position: f64,
    pub server_id: Option<String>,
    pub upstream_name: Option<String>,
    pub source: McpToolSourceRow,
    pub last_synced_at: Option<i64>,
}

impl McpToolDraft {
    /// Convenience constructor for the manual (user-typed) path — sets
    /// `source = Manual` and leaves the four upstream fields `None`.
    pub fn manual(
        name: String,
        description: Option<String>,
        schema_json: String,
        color: Option<String>,
        position: f64,
    ) -> Self {
        Self {
            name,
            description,
            schema_json,
            color,
            position,
            server_id: None,
            upstream_name: None,
            source: McpToolSourceRow::Manual,
            last_synced_at: None,
        }
    }
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
        "SELECT id, name, description, schema_json, color, position, \
                server_id, upstream_name, source, last_synced_at, \
                created_at, updated_at \
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
        "SELECT id, name, description, schema_json, color, position, \
                server_id, upstream_name, source, last_synced_at, \
                created_at, updated_at \
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
         (id, name, description, schema_json, color, position, \
          server_id, upstream_name, source, last_synced_at, \
          created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![
            id,
            draft.name,
            draft.description,
            draft.schema_json,
            draft.color,
            draft.position,
            draft.server_id,
            draft.upstream_name,
            draft.source.as_str(),
            draft.last_synced_at,
            now,
        ],
    )?;
    Ok(McpToolRow {
        id,
        name: draft.name.clone(),
        description: draft.description.clone(),
        schema_json: draft.schema_json.clone(),
        color: draft.color.clone(),
        position: draft.position,
        server_id: draft.server_id.clone(),
        upstream_name: draft.upstream_name.clone(),
        source: draft.source,
        last_synced_at: draft.last_synced_at,
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

/// Mark an existing `source = 'upstream'` row as freshly synced.
/// Updates `description`, `schema_json`, `last_synced_at`, and
/// `updated_at` to `now_millis()`. ADR-0008 / PROXY-S4 round 2.
///
/// Returns `true` iff a row was actually updated (1 → matched id +
/// `source = 'upstream'` filter). `false` means the id was not
/// found or it was a `Manual` row.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn mark_upstream_synced(
    conn: &Connection,
    id: &str,
    description: Option<&str>,
    schema_json: &str,
    last_synced_at: i64,
) -> Result<bool, DbError> {
    let now = now_millis();
    let n = conn.execute(
        "UPDATE mcp_tools \
         SET description = ?1, schema_json = ?2, last_synced_at = ?3, updated_at = ?4 \
         WHERE id = ?5 AND source = 'upstream'",
        params![description, schema_json, last_synced_at, now, id],
    )?;
    Ok(n > 0)
}

/// Soft-delete an upstream tool — clears `last_synced_at` so the
/// row stays for audit but UI marks it as removed-upstream.
/// ADR-0008 / PROXY-S4 round 2.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn soft_delete_upstream(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let now = now_millis();
    let n = conn.execute(
        "UPDATE mcp_tools \
         SET last_synced_at = NULL, updated_at = ?1 \
         WHERE id = ?2 AND source = 'upstream'",
        params![now, id],
    )?;
    Ok(n > 0)
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

/// List every MCP tool attached to `role_id`, ordered by
/// `role_mcp_tools.position ASC`.
///
/// List every MCP tool tagged with `server_id`, ordered by
/// `position ASC, name ASC`. Includes BOTH `Upstream` rows (auto
/// materialised via introspection) and any `Manual` rows that may
/// have been hand-attached.
///
/// ADR-0008 / PROXY-S4. Backs the UI group view's tool list.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_for_server(
    conn: &Connection,
    server_id: &str,
) -> Result<Vec<McpToolRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, schema_json, color, position, \
                server_id, upstream_name, source, last_synced_at, \
                created_at, updated_at \
         FROM mcp_tools \
         WHERE server_id = ?1 \
         ORDER BY position ASC, name ASC",
    )?;
    let rows = stmt.query_map(params![server_id], McpToolRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// ctq-117.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_for_role(conn: &Connection, role_id: &str) -> Result<Vec<McpToolRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT m.id, m.name, m.description, m.schema_json, m.color, m.position, \
                m.server_id, m.upstream_name, m.source, m.last_synced_at, \
                m.created_at, m.updated_at \
         FROM role_mcp_tools rm \
         JOIN mcp_tools m ON m.id = rm.mcp_tool_id \
         WHERE rm.role_id = ?1 \
         ORDER BY rm.position ASC, m.name ASC",
    )?;
    let rows = stmt.query_map(params![role_id], McpToolRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// List every MCP tool attached to `task_id`, ordered by
/// `task_mcp_tools.position ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_for_task(conn: &Connection, task_id: &str) -> Result<Vec<McpToolRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT m.id, m.name, m.description, m.schema_json, m.color, m.position, \
                m.server_id, m.upstream_name, m.source, m.last_synced_at, \
                m.created_at, m.updated_at \
         FROM task_mcp_tools tm \
         JOIN mcp_tools m ON m.id = tm.mcp_tool_id \
         WHERE tm.task_id = ?1 \
         ORDER BY tm.position ASC, m.name ASC",
    )?;
    let rows = stmt.query_map(params![task_id], McpToolRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Attach an MCP tool directly to a task (origin = 'direct'). Idempotent
/// on `(task_id, mcp_tool_id)`: re-insert silently no-ops via
/// INSERT OR IGNORE.
///
/// ctq-127.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn add_task_mcp_tool(
    conn: &Connection,
    task_id: &str,
    mcp_tool_id: &str,
    position: f64,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO task_mcp_tools (task_id, mcp_tool_id, origin, position) \
         VALUES (?1, ?2, 'direct', ?3) \
         ON CONFLICT(task_id, mcp_tool_id) DO NOTHING",
        params![task_id, mcp_tool_id, position],
    )?;
    Ok(())
}

/// Detach a direct MCP tool from a task. Inherited rows (origin
/// `role:…`, `board:…`, `column:…`) are not touched. Returns `true` if
/// a row was removed.
///
/// ctq-127.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_task_mcp_tool(
    conn: &Connection,
    task_id: &str,
    mcp_tool_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM task_mcp_tools WHERE task_id = ?1 AND mcp_tool_id = ?2 AND origin = 'direct'",
        params![task_id, mcp_tool_id],
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
            &McpToolDraft::manual(
                "bash".into(),
                Some("Run shell commands".into()),
                r#"{"type":"object","properties":{"cmd":{"type":"string"}}}"#.into(),
                Some("#123456".into()),
                1.0,
            ),
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
            &McpToolDraft::manual("b_tool".into(), None, "{}".into(), None, 2.0),
        )
        .unwrap();
        insert(
            &conn,
            &McpToolDraft::manual("a_tool".into(), None, "{}".into(), None, 1.0),
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
            &McpToolDraft::manual("old_tool".into(), None, "{}".into(), None, 0.0),
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
            &McpToolDraft::manual("t".into(), None, "{}".into(), None, 0.0),
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
            &McpToolDraft::manual("same_tool".into(), None, "{}".into(), None, 0.0),
        )
        .unwrap();
        let err = insert(
            &conn,
            &McpToolDraft::manual("same_tool".into(), None, "{}".into(), None, 1.0),
        )
        .expect_err("UNIQUE");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }

    /// ctq-127: add_task_mcp_tool is idempotent on
    /// `(task_id, mcp_tool_id)`.
    #[test]
    fn add_task_mcp_tool_idempotent() {
        let conn = fresh_db();
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd','B','sp',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('co','bd','C',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1','bd','co','sp-1','T',0,0,0);",
        )
        .unwrap();
        let m = insert(
            &conn,
            &McpToolDraft::manual("bash".into(), None, "{}".into(), None, 0.0),
        )
        .unwrap();
        add_task_mcp_tool(&conn, "t1", &m.id, 1.0).unwrap();
        add_task_mcp_tool(&conn, "t1", &m.id, 999.0).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_mcp_tools WHERE task_id = 't1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert!(remove_task_mcp_tool(&conn, "t1", &m.id).unwrap());
        assert!(!remove_task_mcp_tool(&conn, "t1", &m.id).unwrap());
    }
}
