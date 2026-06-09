//! MCP-tool-group attachments — attach an `McpToolGroup` as a *live unit*.
//!
//! The MCP mirror of [`super::prompt_group_attachments`]: members fan into
//! `task_mcp_tools` with the same composite origin grammar
//! `"<scope>:<id>#group:<gid>"` (`"direct#group:<gid>"` for a task).
//! [`rematerialize_mcp_tool_group`] re-expands every attach site when the
//! group's membership changes. Takes `&Connection`; the use-case owns the
//! transaction. Owns effective-count recompute.

use rusqlite::{params, Connection};

use crate::db::pool::DbError;

use super::mcp_tool_groups;
use super::tasks::{recompute_effective_counts, recompute_effective_counts_for_scope, AttachScope};

/// Scope an MCP-tool group can be attached at (mirrors the prompt-side
/// `GroupAttachScope`; includes `Task` for direct attachment).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpGroupAttachScope {
    Task(String),
    Role(String),
    Column(String),
    Board(String),
    Space(String),
}

impl McpGroupAttachScope {
    fn join_table(&self) -> &'static str {
        match self {
            Self::Task(_) => "task_mcp_tool_groups",
            Self::Role(_) => "role_mcp_tool_groups",
            Self::Column(_) => "column_mcp_tool_groups",
            Self::Board(_) => "board_mcp_tool_groups",
            Self::Space(_) => "space_mcp_tool_groups",
        }
    }

    fn parent_col(&self) -> &'static str {
        match self {
            Self::Task(_) => "task_id",
            Self::Role(_) => "role_id",
            Self::Column(_) => "column_id",
            Self::Board(_) => "board_id",
            Self::Space(_) => "space_id",
        }
    }

    fn parent_id(&self) -> &str {
        match self {
            Self::Task(id)
            | Self::Role(id)
            | Self::Column(id)
            | Self::Board(id)
            | Self::Space(id) => id,
        }
    }

    fn origin_tag(&self, group_id: &str) -> String {
        match self {
            Self::Task(_) => format!("direct#group:{group_id}"),
            Self::Role(id) => format!("role:{id}#group:{group_id}"),
            Self::Column(id) => format!("column:{id}#group:{group_id}"),
            Self::Board(id) => format!("board:{id}#group:{group_id}"),
            Self::Space(id) => format!("space:{id}#group:{group_id}"),
        }
    }

    fn origin_glob(&self) -> String {
        match self {
            Self::Task(_) => "direct#group:*".to_owned(),
            Self::Role(id) => format!("role:{id}#group:*"),
            Self::Column(id) => format!("column:{id}#group:*"),
            Self::Board(id) => format!("board:{id}#group:*"),
            Self::Space(id) => format!("space:{id}#group:*"),
        }
    }

    fn as_attach_scope(&self) -> Option<AttachScope> {
        match self {
            Self::Task(_) => None,
            Self::Role(id) => Some(AttachScope::Role(id.clone())),
            Self::Column(id) => Some(AttachScope::Column(id.clone())),
            Self::Board(id) => Some(AttachScope::Board(id.clone())),
            Self::Space(id) => Some(AttachScope::Space(id.clone())),
        }
    }
}

/// List the MCP-tool-group ids attached at `scope`, in stored order.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_groups_at(
    conn: &Connection,
    scope: &McpGroupAttachScope,
) -> Result<Vec<String>, DbError> {
    let sql = format!(
        "SELECT group_id FROM {} WHERE {} = ?1 ORDER BY position ASC, group_id ASC",
        scope.join_table(),
        scope.parent_col(),
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![scope.parent_id()], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Bulk-set the MCP-tool groups attached at `scope`. Clears prior group
/// rows (join + materialised), re-inserts join rows, expands each group's
/// members, recomputes counts. Mirrors `set_*_mcp_tools`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn set_groups_at(
    conn: &Connection,
    scope: &McpGroupAttachScope,
    group_ids: &[String],
) -> Result<(), DbError> {
    let del_join = format!(
        "DELETE FROM {} WHERE {} = ?1",
        scope.join_table(),
        scope.parent_col(),
    );
    conn.execute(&del_join, params![scope.parent_id()])?;

    clear_all_groups_at(conn, scope)?;

    let ins_join = format!(
        "INSERT INTO {} ({}, group_id, position) VALUES (?1, ?2, ?3)",
        scope.join_table(),
        scope.parent_col(),
    );
    for (idx, group_id) in group_ids.iter().enumerate() {
        #[allow(clippy::cast_precision_loss)]
        let position = idx as f64;
        conn.execute(&ins_join, params![scope.parent_id(), group_id, position])?;
        expand_group_at(conn, scope, group_id, position)?;
    }

    recompute_for(conn, scope)?;
    Ok(())
}

/// Re-materialise an MCP-tool group everywhere it is attached (live link).
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn rematerialize_mcp_tool_group(conn: &Connection, group_id: &str) -> Result<(), DbError> {
    for_each_site(conn, group_id, |conn, scope, position| {
        clear_group_at(conn, scope, group_id)?;
        expand_group_at(conn, scope, group_id, position)?;
        recompute_for(conn, scope)
    })
}

/// Clear an MCP-tool group's rows from every attach site (no re-expand) +
/// recompute counts. Used on group delete (the on-delete trigger sweeps
/// rows defensively but leaves `effective_tool_count` stale).
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn clear_group_everywhere(conn: &Connection, group_id: &str) -> Result<(), DbError> {
    for_each_site(conn, group_id, |conn, scope, _position| {
        clear_group_at(conn, scope, group_id)?;
        recompute_for(conn, scope)
    })
}

// ── internals ────────────────────────────────────────────────────────

type Dimension = (
    &'static str,
    &'static str,
    fn(String) -> McpGroupAttachScope,
);

fn for_each_site<F>(conn: &Connection, group_id: &str, mut f: F) -> Result<(), DbError>
where
    F: FnMut(&Connection, &McpGroupAttachScope, f64) -> Result<(), DbError>,
{
    let dimensions: [Dimension; 5] = [
        ("task_mcp_tool_groups", "task_id", McpGroupAttachScope::Task),
        ("role_mcp_tool_groups", "role_id", McpGroupAttachScope::Role),
        (
            "column_mcp_tool_groups",
            "column_id",
            McpGroupAttachScope::Column,
        ),
        (
            "board_mcp_tool_groups",
            "board_id",
            McpGroupAttachScope::Board,
        ),
        (
            "space_mcp_tool_groups",
            "space_id",
            McpGroupAttachScope::Space,
        ),
    ];

    for (table, col, ctor) in dimensions {
        let sql = format!("SELECT {col}, position FROM {table} WHERE group_id = ?1");
        let mut stmt = conn.prepare(&sql)?;
        let sites = stmt
            .query_map(params![group_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
            })?
            .collect::<Result<Vec<(String, f64)>, _>>()?;
        drop(stmt);

        for (parent_id, position) in sites {
            let scope = ctor(parent_id);
            f(conn, &scope, position)?;
        }
    }
    Ok(())
}

fn expand_group_at(
    conn: &Connection,
    scope: &McpGroupAttachScope,
    group_id: &str,
    group_position: f64,
) -> Result<(), DbError> {
    let members = mcp_tool_groups::list_members(conn, group_id)?;
    let origin = scope.origin_tag(group_id);
    for (idx, tool_id) in members.iter().enumerate() {
        #[allow(clippy::cast_precision_loss)]
        let position = group_position * 1000.0 + idx as f64;
        insert_member_row(conn, scope, tool_id, &origin, position)?;
    }
    Ok(())
}

fn insert_member_row(
    conn: &Connection,
    scope: &McpGroupAttachScope,
    mcp_tool_id: &str,
    origin: &str,
    position: f64,
) -> Result<usize, DbError> {
    let n = match scope {
        McpGroupAttachScope::Task(task_id) => conn.execute(
            "INSERT INTO task_mcp_tools (task_id, mcp_tool_id, origin, position) \
             VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(task_id, mcp_tool_id) DO NOTHING",
            params![task_id, mcp_tool_id, origin, position],
        )?,
        McpGroupAttachScope::Role(id) => conn.execute(
            "INSERT INTO task_mcp_tools (task_id, mcp_tool_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 FROM tasks t WHERE t.role_id = ?1 \
             ON CONFLICT(task_id, mcp_tool_id) DO NOTHING",
            params![id, mcp_tool_id, origin, position],
        )?,
        McpGroupAttachScope::Column(id) => conn.execute(
            "INSERT INTO task_mcp_tools (task_id, mcp_tool_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 FROM tasks t WHERE t.column_id = ?1 \
             ON CONFLICT(task_id, mcp_tool_id) DO NOTHING",
            params![id, mcp_tool_id, origin, position],
        )?,
        McpGroupAttachScope::Board(id) => conn.execute(
            "INSERT INTO task_mcp_tools (task_id, mcp_tool_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 FROM tasks t WHERE t.board_id = ?1 \
             ON CONFLICT(task_id, mcp_tool_id) DO NOTHING",
            params![id, mcp_tool_id, origin, position],
        )?,
        McpGroupAttachScope::Space(id) => conn.execute(
            "INSERT INTO task_mcp_tools (task_id, mcp_tool_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 FROM tasks t \
             JOIN boards b ON b.id = t.board_id WHERE b.space_id = ?1 \
             ON CONFLICT(task_id, mcp_tool_id) DO NOTHING",
            params![id, mcp_tool_id, origin, position],
        )?,
    };
    Ok(n)
}

fn clear_all_groups_at(conn: &Connection, scope: &McpGroupAttachScope) -> Result<usize, DbError> {
    let n = match scope {
        McpGroupAttachScope::Task(task_id) => conn.execute(
            "DELETE FROM task_mcp_tools WHERE task_id = ?1 AND origin GLOB ?2",
            params![task_id, scope.origin_glob()],
        )?,
        _ => conn.execute(
            "DELETE FROM task_mcp_tools WHERE origin GLOB ?1",
            params![scope.origin_glob()],
        )?,
    };
    Ok(n)
}

fn clear_group_at(
    conn: &Connection,
    scope: &McpGroupAttachScope,
    group_id: &str,
) -> Result<usize, DbError> {
    let origin = scope.origin_tag(group_id);
    let n = match scope {
        McpGroupAttachScope::Task(task_id) => conn.execute(
            "DELETE FROM task_mcp_tools WHERE task_id = ?1 AND origin = ?2",
            params![task_id, origin],
        )?,
        _ => conn.execute(
            "DELETE FROM task_mcp_tools WHERE origin = ?1",
            params![origin],
        )?,
    };
    Ok(n)
}

fn recompute_for(conn: &Connection, scope: &McpGroupAttachScope) -> Result<(), DbError> {
    match scope.as_attach_scope() {
        Some(attach) => {
            recompute_effective_counts_for_scope(conn, &attach)?;
        }
        None => {
            recompute_effective_counts(conn, scope.parent_id())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repositories::tasks::{self, TaskDraft};
    use crate::db::runner::run_pending;

    fn fresh() -> (Connection, String, String) {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','S','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd1','B','sp1',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c1','bd1','Todo',0,0); \
             INSERT INTO roles (id, name, content, created_at, updated_at) \
                 VALUES ('rl1','R','',0,0);",
        )
        .unwrap();
        (conn, "bd1".into(), "c1".into())
    }

    fn task_on_role(conn: &Connection, board: &str, col: &str, role: Option<&str>) -> String {
        tasks::insert(
            conn,
            &TaskDraft {
                board_id: board.into(),
                column_id: col.into(),
                title: "T".into(),
                description: None,
                kind: "blank".into(),
                position: 1.0,
                role_id: role.map(str::to_owned),
            },
        )
        .unwrap()
        .id
    }

    fn seed_tool(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO mcp_tools (id, name, description, schema_json, position, created_at, updated_at) \
             VALUES (?1, ?1, '', '{}', 0, 0, 0)",
            params![id],
        )
        .unwrap();
    }

    fn seed_group(conn: &Connection, gid: &str, members: &[&str]) {
        conn.execute(
            "INSERT INTO mcp_tool_groups (id, name, position, created_at, updated_at) VALUES (?1,?1,0,0,0)",
            params![gid],
        )
        .unwrap();
        for (i, m) in members.iter().enumerate() {
            let pos = i64::try_from(i).unwrap();
            conn.execute(
                "INSERT INTO mcp_tool_group_members (group_id, mcp_tool_id, position, added_at) VALUES (?1,?2,?3,0)",
                params![gid, m, pos],
            )
            .unwrap();
        }
    }

    fn tool_origins(conn: &Connection, task_id: &str) -> Vec<(String, String)> {
        let mut stmt = conn
            .prepare(
                "SELECT mcp_tool_id, origin FROM task_mcp_tools WHERE task_id=?1 ORDER BY position",
            )
            .unwrap();
        stmt.query_map(params![task_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
    }

    #[test]
    fn attach_group_to_role_materialises_and_is_live() {
        let (conn, bd, col) = fresh();
        seed_tool(&conn, "t1");
        seed_tool(&conn, "t2");
        seed_group(&conn, "g1", &["t1"]);
        let t = task_on_role(&conn, &bd, &col, Some("rl1"));

        set_groups_at(
            &conn,
            &McpGroupAttachScope::Role("rl1".into()),
            &["g1".into()],
        )
        .unwrap();
        assert_eq!(
            tool_origins(&conn, &t),
            vec![("t1".into(), "role:rl1#group:g1".into())]
        );

        // Add t2 to the group → rematerialise picks it up.
        conn.execute(
            "INSERT INTO mcp_tool_group_members (group_id, mcp_tool_id, position, added_at) VALUES ('g1','t2',1,0)",
            [],
        )
        .unwrap();
        rematerialize_mcp_tool_group(&conn, "g1").unwrap();
        assert_eq!(tool_origins(&conn, &t).len(), 2);

        // effective_tool_count tracks it.
        let cnt: i64 = conn
            .query_row(
                "SELECT effective_tool_count FROM tasks WHERE id=?1",
                params![t],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 2);

        // Detach clears the rows.
        set_groups_at(&conn, &McpGroupAttachScope::Role("rl1".into()), &[]).unwrap();
        assert!(tool_origins(&conn, &t).is_empty());
    }

    #[test]
    fn deleting_group_sweeps_materialised_rows_via_trigger() {
        let (conn, bd, col) = fresh();
        seed_tool(&conn, "t1");
        seed_group(&conn, "g1", &["t1"]);
        let t = task_on_role(&conn, &bd, &col, Some("rl1"));
        set_groups_at(
            &conn,
            &McpGroupAttachScope::Role("rl1".into()),
            &["g1".into()],
        )
        .unwrap();
        assert_eq!(tool_origins(&conn, &t).len(), 1);

        conn.execute("DELETE FROM mcp_tool_groups WHERE id='g1'", [])
            .unwrap();
        assert!(tool_origins(&conn, &t).is_empty());
    }
}
