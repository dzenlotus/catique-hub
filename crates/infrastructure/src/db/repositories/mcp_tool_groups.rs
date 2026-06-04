//! MCP-tool-groups repository — named collections of MCP tools.
//!
//! The MCP mirror of [`super::prompt_groups`]. Tables (`038_mcp_tool_groups.sql`):
//!   * `mcp_tool_groups`        — the group entity.
//!   * `mcp_tool_group_members` — join table, `ON DELETE CASCADE` on
//!     `group_id`; PK `(group_id, mcp_tool_id)`; `position INTEGER`.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `mcp_tool_groups` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpToolGroupRow {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl McpToolGroupRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            color: row.get("color")?,
            icon: row.get("icon")?,
            position: row.get("position")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new group.
#[derive(Debug, Clone)]
pub struct McpToolGroupDraft {
    pub name: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub position: i64,
}

/// Partial update payload (`Option<Option<_>>` = skip / clear / set).
#[derive(Debug, Clone, Default)]
pub struct McpToolGroupPatch {
    pub name: Option<String>,
    pub color: Option<Option<String>>,
    pub icon: Option<Option<String>>,
    pub position: Option<i64>,
}

/// List all groups ordered by `position ASC, name ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list(conn: &Connection) -> Result<Vec<McpToolGroupRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, icon, position, created_at, updated_at \
         FROM mcp_tool_groups ORDER BY position ASC, name ASC",
    )?;
    let rows = stmt.query_map([], McpToolGroupRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Look up one group by primary key.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get(conn: &Connection, id: &str) -> Result<Option<McpToolGroupRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, icon, position, created_at, updated_at \
         FROM mcp_tool_groups WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], McpToolGroupRow::from_row)
        .optional()?)
}

/// Insert one group. Generates id, stamps timestamps.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn insert(conn: &Connection, draft: &McpToolGroupDraft) -> Result<McpToolGroupRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO mcp_tool_groups \
            (id, name, color, icon, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, draft.name, draft.color, draft.icon, draft.position, now],
    )?;
    Ok(McpToolGroupRow {
        id,
        name: draft.name.clone(),
        color: draft.color.clone(),
        icon: draft.icon.clone(),
        position: draft.position,
        created_at: now,
        updated_at: now,
    })
}

/// Partial update. Bumps `updated_at`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &McpToolGroupPatch,
) -> Result<Option<McpToolGroupRow>, DbError> {
    use std::fmt::Write as _;
    let now = now_millis();

    let mut sql = String::from(
        "UPDATE mcp_tool_groups SET name = COALESCE(?1, name), \
         position = COALESCE(?2, position)",
    );
    let mut next_param = 3_usize;
    let mut params_vec: Vec<rusqlite::types::Value> =
        vec![patch.name.clone().into(), patch.position.into()];
    if let Some(c) = patch.color.as_ref() {
        let _ = write!(sql, ", color = ?{next_param}");
        params_vec.push(rusqlite::types::Value::from(c.clone()));
        next_param += 1;
    }
    if let Some(i) = patch.icon.as_ref() {
        let _ = write!(sql, ", icon = ?{next_param}");
        params_vec.push(rusqlite::types::Value::from(i.clone()));
        next_param += 1;
    }
    let _ = write!(
        sql,
        ", updated_at = ?{next_param} WHERE id = ?{}",
        next_param + 1
    );
    params_vec.push(rusqlite::types::Value::from(now));
    params_vec.push(rusqlite::types::Value::from(id.to_owned()));

    let updated = conn.execute(&sql, rusqlite::params_from_iter(params_vec.iter()))?;
    if updated == 0 {
        return Ok(None);
    }
    get(conn, id)
}

/// Delete one group by id. `ON DELETE CASCADE` removes members.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM mcp_tool_groups WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

// -------------------------------------------------------------------------
// Member operations — mcp_tool_group_members join table.
// -------------------------------------------------------------------------

/// Ordered list of `mcp_tool_id` values for a group.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_members(conn: &Connection, group_id: &str) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT mcp_tool_id FROM mcp_tool_group_members \
         WHERE group_id = ?1 ORDER BY position ASC",
    )?;
    let rows = stmt.query_map(params![group_id], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Upsert an MCP tool into a group at the given position.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn add_member(
    conn: &Connection,
    group_id: &str,
    mcp_tool_id: &str,
    position: i64,
) -> Result<(), DbError> {
    let now = now_millis();
    conn.execute(
        "INSERT INTO mcp_tool_group_members (group_id, mcp_tool_id, position, added_at) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(group_id, mcp_tool_id) DO UPDATE SET position = excluded.position",
        params![group_id, mcp_tool_id, position, now],
    )?;
    Ok(())
}

/// Remove an MCP tool from a group. Returns `true` if a row was deleted.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_member(
    conn: &Connection,
    group_id: &str,
    mcp_tool_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM mcp_tool_group_members WHERE group_id = ?1 AND mcp_tool_id = ?2",
        params![group_id, mcp_tool_id],
    )?;
    Ok(n > 0)
}

/// Atomically replace the full ordered member list (SAVEPOINT-wrapped).
///
/// # Errors
///
/// FK violation (unknown `mcp_tool_id`) or any other rusqlite error.
pub fn set_members(
    conn: &Connection,
    group_id: &str,
    ordered_tool_ids: &[String],
) -> Result<(), DbError> {
    conn.execute("SAVEPOINT set_mcp_members", [])?;
    let result = (|| -> Result<(), DbError> {
        conn.execute(
            "DELETE FROM mcp_tool_group_members WHERE group_id = ?1",
            params![group_id],
        )?;
        let now = now_millis();
        for (idx, tool_id) in ordered_tool_ids.iter().enumerate() {
            #[allow(clippy::cast_possible_wrap)]
            let position = (idx + 1) as i64;
            conn.execute(
                "INSERT INTO mcp_tool_group_members (group_id, mcp_tool_id, position, added_at) \
                 VALUES (?1, ?2, ?3, ?4)",
                params![group_id, tool_id, position, now],
            )?;
        }
        Ok(())
    })();
    if result.is_ok() {
        conn.execute("RELEASE set_mcp_members", [])?;
    } else {
        conn.execute("ROLLBACK TO set_mcp_members", [])?;
        conn.execute("RELEASE set_mcp_members", [])?;
    }
    result
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

    fn insert_tool(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO mcp_tools (id, name, description, schema_json, position, created_at, updated_at) \
             VALUES (?1, ?1, '', '{}', 0, 0, 0)",
            params![id],
        )
        .unwrap();
    }

    #[test]
    fn insert_get_update_delete_round_trip() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &McpToolGroupDraft {
                name: "Deploy kit".into(),
                color: Some("#abcdef".into()),
                icon: Some("bolt".into()),
                position: 0,
            },
        )
        .unwrap();
        assert_eq!(get(&conn, &row.id).unwrap().unwrap(), row);

        let updated = update(
            &conn,
            &row.id,
            &McpToolGroupPatch {
                name: Some("Renamed".into()),
                icon: Some(None),
                ..McpToolGroupPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.icon, None);

        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn members_add_list_set_cascade() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &McpToolGroupDraft {
                name: "g".into(),
                color: None,
                icon: None,
                position: 0,
            },
        )
        .unwrap();
        insert_tool(&conn, "t1");
        insert_tool(&conn, "t2");
        add_member(&conn, &row.id, "t2", 2).unwrap();
        add_member(&conn, &row.id, "t1", 1).unwrap();
        assert_eq!(list_members(&conn, &row.id).unwrap(), vec!["t1", "t2"]);

        set_members(&conn, &row.id, &["t2".into()]).unwrap();
        assert_eq!(list_members(&conn, &row.id).unwrap(), vec!["t2"]);

        delete(&conn, &row.id).unwrap();
        assert!(list_members(&conn, &row.id).unwrap().is_empty());
    }
}
