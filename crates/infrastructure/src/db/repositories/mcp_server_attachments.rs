//! MCP-server attachments — attach a whole MCP server as a *live unit*.
//!
//! Like [`super::mcp_tool_group_attachments`], but the "members" are not a
//! join table — they are every non-soft-deleted `mcp_tools` row whose
//! `server_id` matches. Selecting a server materialises all its tools into
//! `task_mcp_tools` with origin `"<scope>:<id>#server:<sid>"`
//! (`"direct#server:<sid>"` for a task); [`rematerialize_mcp_server`]
//! re-expands on re-introspection so new/removed upstream tools sync.
//!
//! Takes `&Connection`; the caller owns the transaction. Owns
//! effective-count recompute.

use rusqlite::{params, Connection};

use crate::db::pool::DbError;

use super::tasks::{recompute_effective_counts, recompute_effective_counts_for_scope, AttachScope};

/// Scope an MCP server can be attached at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServerAttachScope {
    Task(String),
    Role(String),
    Column(String),
    Board(String),
    Space(String),
}

impl ServerAttachScope {
    fn join_table(&self) -> &'static str {
        match self {
            Self::Task(_) => "task_mcp_servers",
            Self::Role(_) => "role_mcp_servers",
            Self::Column(_) => "column_mcp_servers",
            Self::Board(_) => "board_mcp_servers",
            Self::Space(_) => "space_mcp_servers",
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

    fn origin_tag(&self, server_id: &str) -> String {
        match self {
            Self::Task(_) => format!("direct#server:{server_id}"),
            Self::Role(id) => format!("role:{id}#server:{server_id}"),
            Self::Column(id) => format!("column:{id}#server:{server_id}"),
            Self::Board(id) => format!("board:{id}#server:{server_id}"),
            Self::Space(id) => format!("space:{id}#server:{server_id}"),
        }
    }

    fn origin_glob(&self) -> String {
        match self {
            Self::Task(_) => "direct#server:*".to_owned(),
            Self::Role(id) => format!("role:{id}#server:*"),
            Self::Column(id) => format!("column:{id}#server:*"),
            Self::Board(id) => format!("board:{id}#server:*"),
            Self::Space(id) => format!("space:{id}#server:*"),
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

/// List the server ids attached at `scope`, in stored order.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_servers_at(
    conn: &Connection,
    scope: &ServerAttachScope,
) -> Result<Vec<String>, DbError> {
    let sql = format!(
        "SELECT server_id FROM {} WHERE {} = ?1 ORDER BY position ASC, server_id ASC",
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

/// Bulk-set the servers attached at `scope`. Clears prior server rows
/// (join + materialised), re-inserts join rows, expands each server's
/// live tool set, recomputes counts.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn set_servers_at(
    conn: &Connection,
    scope: &ServerAttachScope,
    server_ids: &[String],
) -> Result<(), DbError> {
    let del_join = format!(
        "DELETE FROM {} WHERE {} = ?1",
        scope.join_table(),
        scope.parent_col(),
    );
    conn.execute(&del_join, params![scope.parent_id()])?;

    clear_all_servers_at(conn, scope)?;

    let ins_join = format!(
        "INSERT INTO {} ({}, server_id, position) VALUES (?1, ?2, ?3)",
        scope.join_table(),
        scope.parent_col(),
    );
    for (idx, server_id) in server_ids.iter().enumerate() {
        #[allow(clippy::cast_precision_loss)]
        let position = idx as f64;
        conn.execute(&ins_join, params![scope.parent_id(), server_id, position])?;
        expand_server_at(conn, scope, server_id, position)?;
    }

    recompute_for(conn, scope)?;
    Ok(())
}

/// Re-materialise a server everywhere it is attached (live link). Called
/// after re-introspection so new/removed upstream tools sync into every
/// attach site.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn rematerialize_mcp_server(conn: &Connection, server_id: &str) -> Result<(), DbError> {
    for_each_site(conn, server_id, |conn, scope, position| {
        clear_server_at(conn, scope, server_id)?;
        expand_server_at(conn, scope, server_id, position)?;
        recompute_for(conn, scope)
    })
}

// ── internals ────────────────────────────────────────────────────────

type Dimension = (&'static str, &'static str, fn(String) -> ServerAttachScope);

fn for_each_site<F>(conn: &Connection, server_id: &str, mut f: F) -> Result<(), DbError>
where
    F: FnMut(&Connection, &ServerAttachScope, f64) -> Result<(), DbError>,
{
    let dimensions: [Dimension; 5] = [
        ("task_mcp_servers", "task_id", ServerAttachScope::Task),
        ("role_mcp_servers", "role_id", ServerAttachScope::Role),
        ("column_mcp_servers", "column_id", ServerAttachScope::Column),
        ("board_mcp_servers", "board_id", ServerAttachScope::Board),
        ("space_mcp_servers", "space_id", ServerAttachScope::Space),
    ];

    for (table, col, ctor) in dimensions {
        let sql = format!("SELECT {col}, position FROM {table} WHERE server_id = ?1");
        let mut stmt = conn.prepare(&sql)?;
        let sites = stmt
            .query_map(params![server_id], |r| {
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

/// The server's live tool set: non-soft-deleted tools tagged with the
/// server, in position order.
fn server_tool_ids(conn: &Connection, server_id: &str) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id FROM mcp_tools \
         WHERE server_id = ?1 AND last_synced_at IS NOT NULL \
         ORDER BY position ASC, name ASC",
    )?;
    let rows = stmt.query_map(params![server_id], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn expand_server_at(
    conn: &Connection,
    scope: &ServerAttachScope,
    server_id: &str,
    server_position: f64,
) -> Result<(), DbError> {
    let tools = server_tool_ids(conn, server_id)?;
    let origin = scope.origin_tag(server_id);
    for (idx, tool_id) in tools.iter().enumerate() {
        #[allow(clippy::cast_precision_loss)]
        let position = server_position * 1000.0 + idx as f64;
        insert_member_row(conn, scope, tool_id, &origin, position)?;
    }
    Ok(())
}

fn insert_member_row(
    conn: &Connection,
    scope: &ServerAttachScope,
    mcp_tool_id: &str,
    origin: &str,
    position: f64,
) -> Result<usize, DbError> {
    let n = match scope {
        ServerAttachScope::Task(task_id) => conn.execute(
            "INSERT INTO task_mcp_tools (task_id, mcp_tool_id, origin, position) \
             VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(task_id, mcp_tool_id) DO NOTHING",
            params![task_id, mcp_tool_id, origin, position],
        )?,
        ServerAttachScope::Role(id) => conn.execute(
            "INSERT INTO task_mcp_tools (task_id, mcp_tool_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 FROM tasks t WHERE t.role_id = ?1 \
             ON CONFLICT(task_id, mcp_tool_id) DO NOTHING",
            params![id, mcp_tool_id, origin, position],
        )?,
        ServerAttachScope::Column(id) => conn.execute(
            "INSERT INTO task_mcp_tools (task_id, mcp_tool_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 FROM tasks t WHERE t.column_id = ?1 \
             ON CONFLICT(task_id, mcp_tool_id) DO NOTHING",
            params![id, mcp_tool_id, origin, position],
        )?,
        ServerAttachScope::Board(id) => conn.execute(
            "INSERT INTO task_mcp_tools (task_id, mcp_tool_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 FROM tasks t WHERE t.board_id = ?1 \
             ON CONFLICT(task_id, mcp_tool_id) DO NOTHING",
            params![id, mcp_tool_id, origin, position],
        )?,
        ServerAttachScope::Space(id) => conn.execute(
            "INSERT INTO task_mcp_tools (task_id, mcp_tool_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 FROM tasks t \
             JOIN boards b ON b.id = t.board_id WHERE b.space_id = ?1 \
             ON CONFLICT(task_id, mcp_tool_id) DO NOTHING",
            params![id, mcp_tool_id, origin, position],
        )?,
    };
    Ok(n)
}

fn clear_all_servers_at(conn: &Connection, scope: &ServerAttachScope) -> Result<usize, DbError> {
    let n = match scope {
        ServerAttachScope::Task(task_id) => conn.execute(
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

fn clear_server_at(
    conn: &Connection,
    scope: &ServerAttachScope,
    server_id: &str,
) -> Result<usize, DbError> {
    let origin = scope.origin_tag(server_id);
    let n = match scope {
        ServerAttachScope::Task(task_id) => conn.execute(
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

fn recompute_for(conn: &Connection, scope: &ServerAttachScope) -> Result<(), DbError> {
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
                 VALUES ('rl1','R','',0,0); \
             INSERT INTO mcp_servers (id, name, transport, command, enabled, created_at, updated_at) \
                 VALUES ('srv1','Context7','stdio','ctx7',1,0,0);",
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
                position: 1.0,
                role_id: role.map(str::to_owned),
            },
        )
        .unwrap()
        .id
    }

    /// Seed an upstream tool for a server (synced = visible).
    fn seed_tool(conn: &Connection, id: &str, server: &str, synced: bool) {
        let ts: Option<i64> = if synced { Some(1) } else { None };
        conn.execute(
            "INSERT INTO mcp_tools \
               (id, name, description, schema_json, color, position, server_id, upstream_name, source, last_synced_at, created_at, updated_at) \
             VALUES (?1, ?1, '', '{}', NULL, 0, ?2, ?1, 'upstream', ?3, 0, 0)",
            params![id, server, ts],
        )
        .unwrap();
    }

    fn tool_ids(conn: &Connection, task_id: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT mcp_tool_id FROM task_mcp_tools WHERE task_id=?1 ORDER BY position")
            .unwrap();
        stmt.query_map(params![task_id], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn attach_server_materialises_its_live_tools() {
        let (conn, bd, col) = fresh();
        seed_tool(&conn, "t1", "srv1", true);
        seed_tool(&conn, "t2", "srv1", true);
        seed_tool(&conn, "tx", "srv1", false); // soft-deleted → excluded
        let t = task_on_role(&conn, &bd, &col, Some("rl1"));

        set_servers_at(
            &conn,
            &ServerAttachScope::Role("rl1".into()),
            &["srv1".into()],
        )
        .unwrap();
        assert_eq!(tool_ids(&conn, &t), vec!["t1", "t2"]);

        // New upstream tool appears → rematerialise pulls it in (live).
        seed_tool(&conn, "t3", "srv1", true);
        rematerialize_mcp_server(&conn, "srv1").unwrap();
        assert_eq!(tool_ids(&conn, &t).len(), 3);

        // Detach clears the server's rows.
        set_servers_at(&conn, &ServerAttachScope::Role("rl1".into()), &[]).unwrap();
        assert!(tool_ids(&conn, &t).is_empty());
    }

    #[test]
    fn deleting_server_cascades_tool_rows() {
        let (conn, bd, col) = fresh();
        seed_tool(&conn, "t1", "srv1", true);
        let t = task_on_role(&conn, &bd, &col, Some("rl1"));
        set_servers_at(
            &conn,
            &ServerAttachScope::Role("rl1".into()),
            &["srv1".into()],
        )
        .unwrap();
        assert_eq!(tool_ids(&conn, &t).len(), 1);

        // Server delete → mcp_tools cascade → task_mcp_tools cascade.
        conn.execute("DELETE FROM mcp_servers WHERE id='srv1'", [])
            .unwrap();
        assert!(tool_ids(&conn, &t).is_empty());
    }
}
