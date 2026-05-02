//! Roles repository — agent-role records + their join tables.
//!
//! Schema: `001_initial.sql`, Promptery v0.4 lines 77-84 (table) and
//! 101-120 (`role_prompts`, `role_skills`, `role_mcp_tools`).
//!
//! Wave-E2.4 (Olga): full CRUD on `roles` + `add_*` / `remove_*`
//! helpers for the three join tables. Per the wave-brief join tables
//! are NOT exposed as full entities — they're relationships, not
//! user-facing rows.
//!
//! `cleanup_role_origin_on_role_delete` (declared in `001_initial.sql`)
//! handles inherited-prompt cleanup automatically when a role is
//! deleted via `DELETE FROM roles WHERE …`.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `roles` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleRow {
    pub id: String,
    pub name: String,
    pub content: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// `true` for app-owned rows (Maintainer, Dirizher) seeded by
    /// migration `004_cat_as_agent_phase1.sql`. The schema column is
    /// `INTEGER NOT NULL DEFAULT 0`; `from_row` reads it as `0|1`.
    pub is_system: bool,
}

impl RoleRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let is_system_int: i64 = row.get("is_system")?;
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            content: row.get("content")?,
            color: row.get("color")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            is_system: is_system_int != 0,
        })
    }
}

/// Draft for inserting a new role.
#[derive(Debug, Clone)]
pub struct RoleDraft {
    pub name: String,
    pub content: String,
    pub color: Option<String>,
}

/// Partial update payload.
#[derive(Debug, Clone, Default)]
pub struct RolePatch {
    pub name: Option<String>,
    pub content: Option<String>,
    pub color: Option<Option<String>>,
}

/// `SELECT … FROM roles ORDER BY name ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<RoleRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, content, color, created_at, updated_at, is_system \
         FROM roles ORDER BY name ASC",
    )?;
    let rows = stmt.query_map([], RoleRow::from_row)?;
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
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<RoleRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, content, color, created_at, updated_at, is_system \
         FROM roles WHERE id = ?1",
    )?;
    Ok(stmt.query_row(params![id], RoleRow::from_row).optional()?)
}

/// `SELECT … FROM roles WHERE is_system = 1 ORDER BY name ASC`.
/// Convenience for diagnostics and the Phase 1 review modal that needs
/// to enumerate the seeded `maintainer-system` / `dirizher-system`
/// rows without scanning the full table.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_system_roles(conn: &Connection) -> Result<Vec<RoleRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, content, color, created_at, updated_at, is_system \
         FROM roles WHERE is_system = 1 ORDER BY name ASC",
    )?;
    let rows = stmt.query_map([], RoleRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Insert one role. Generates id, stamps timestamps.
///
/// # Errors
///
/// UNIQUE(name) violation surfaces as [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &RoleDraft) -> Result<RoleRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO roles (id, name, content, color, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, draft.name, draft.content, draft.color, now],
    )?;
    Ok(RoleRow {
        id,
        name: draft.name.clone(),
        content: draft.content.clone(),
        color: draft.color.clone(),
        created_at: now,
        updated_at: now,
        // User-created roles are never system rows. The seeded
        // `maintainer-system` / `dirizher-system` rows arrive via
        // migration 004's INSERT OR IGNORE, not through this path.
        is_system: false,
    })
}

/// Partial update via `COALESCE`. Bumps `updated_at` regardless.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn update(conn: &Connection, id: &str, patch: &RolePatch) -> Result<Option<RoleRow>, DbError> {
    let now = now_millis();
    let updated = match &patch.color {
        Some(new_color) => conn.execute(
            "UPDATE roles SET \
                 name = COALESCE(?1, name), \
                 content = COALESCE(?2, content), \
                 color = ?3, \
                 updated_at = ?4 \
             WHERE id = ?5",
            params![patch.name, patch.content, new_color, now, id],
        )?,
        None => conn.execute(
            "UPDATE roles SET \
                 name = COALESCE(?1, name), \
                 content = COALESCE(?2, content), \
                 updated_at = ?3 \
             WHERE id = ?4",
            params![patch.name, patch.content, now, id],
        )?,
    };
    if updated == 0 {
        return Ok(None);
    }
    get_by_id(conn, id)
}

/// Delete one role by id. The
/// `cleanup_role_origin_on_role_delete` trigger strips inherited
/// `task_prompts` / `task_skills` / `task_mcp_tools` rows automatically.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM roles WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

// ---------------------------------------------------------------------
// Join-table helpers — relationships, not full entities.
// ---------------------------------------------------------------------

/// Attach a prompt to a role at the given `position`. Idempotent on
/// `(role_id, prompt_id)`: re-insert silently no-ops via `ON CONFLICT`.
///
/// # Errors
///
/// FK violation on either id surfaces as [`DbError::Sqlite`].
pub fn add_role_prompt(
    conn: &Connection,
    role_id: &str,
    prompt_id: &str,
    position: f64,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO role_prompts (role_id, prompt_id, position) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(role_id, prompt_id) DO UPDATE SET position = excluded.position",
        params![role_id, prompt_id, position],
    )?;
    Ok(())
}

/// Detach a prompt from a role. Returns `true` if a row was removed.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_role_prompt(
    conn: &Connection,
    role_id: &str,
    prompt_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM role_prompts WHERE role_id = ?1 AND prompt_id = ?2",
        params![role_id, prompt_id],
    )?;
    Ok(n > 0)
}

/// Attach a skill to a role.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn add_role_skill(
    conn: &Connection,
    role_id: &str,
    skill_id: &str,
    position: f64,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO role_skills (role_id, skill_id, position) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(role_id, skill_id) DO UPDATE SET position = excluded.position",
        params![role_id, skill_id, position],
    )?;
    Ok(())
}

/// Detach a skill from a role.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_role_skill(
    conn: &Connection,
    role_id: &str,
    skill_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM role_skills WHERE role_id = ?1 AND skill_id = ?2",
        params![role_id, skill_id],
    )?;
    Ok(n > 0)
}

/// Attach an MCP tool to a role.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn add_role_mcp_tool(
    conn: &Connection,
    role_id: &str,
    mcp_tool_id: &str,
    position: f64,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO role_mcp_tools (role_id, mcp_tool_id, position) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(role_id, mcp_tool_id) DO UPDATE SET position = excluded.position",
        params![role_id, mcp_tool_id, position],
    )?;
    Ok(())
}

/// Detach an MCP tool from a role.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_role_mcp_tool(
    conn: &Connection,
    role_id: &str,
    mcp_tool_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM role_mcp_tools WHERE role_id = ?1 AND mcp_tool_id = ?2",
        params![role_id, mcp_tool_id],
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
            &RoleDraft {
                name: "Backend".into(),
                content: "rust dev".into(),
                color: Some("#abcdef".into()),
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
            &RoleDraft {
                name: "Same".into(),
                content: String::new(),
                color: None,
            },
        )
        .unwrap();
        let err = insert(
            &conn,
            &RoleDraft {
                name: "Same".into(),
                content: String::new(),
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
        assert!(update(&conn, "ghost", &RolePatch::default())
            .unwrap()
            .is_none());
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &RoleDraft {
                name: "R".into(),
                content: String::new(),
                color: None,
            },
        )
        .unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn role_prompt_join_idempotent() {
        let conn = fresh_db();
        let role = insert(
            &conn,
            &RoleDraft {
                name: "R".into(),
                content: String::new(),
                color: None,
            },
        )
        .unwrap();
        conn.execute(
            "INSERT INTO prompts (id, name, content, created_at, updated_at) \
             VALUES ('p1', 'P', '', 0, 0)",
            [],
        )
        .unwrap();
        add_role_prompt(&conn, &role.id, "p1", 1.0).unwrap();
        add_role_prompt(&conn, &role.id, "p1", 2.0).unwrap(); // upsert
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM role_prompts WHERE role_id = ?1",
                params![role.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert!(remove_role_prompt(&conn, &role.id, "p1").unwrap());
        assert!(!remove_role_prompt(&conn, &role.id, "p1").unwrap());
    }

    #[test]
    fn list_system_roles_returns_seeded_rows() {
        // Migration 004 seeds Maintainer + Dirizher; a freshly-applied
        // schema should expose both via list_system_roles.
        let conn = fresh_db();
        let system = list_system_roles(&conn).unwrap();
        let ids: Vec<String> = system.iter().map(|r| r.id.clone()).collect();
        assert!(ids.contains(&"maintainer-system".to_owned()));
        assert!(ids.contains(&"dirizher-system".to_owned()));
        // Sanity: every returned row has is_system set.
        assert!(system.iter().all(|r| r.is_system));
    }

    #[test]
    fn user_inserted_role_is_not_system() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &RoleDraft {
                name: "Plain".into(),
                content: String::new(),
                color: None,
            },
        )
        .unwrap();
        assert!(!row.is_system);
        let from_db = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert!(!from_db.is_system);
    }

    #[test]
    fn role_delete_clears_inherited_task_prompts() {
        let conn = fresh_db();
        // Set up a task and an inherited row in task_prompts.
        let role = insert(
            &conn,
            &RoleDraft {
                name: "R".into(),
                content: String::new(),
                color: None,
            },
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd1','B','sp1',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c1','bd1','C',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1','bd1','c1','sp-1','T',0,0,0); \
             INSERT INTO prompts (id, name, content, created_at, updated_at) \
                 VALUES ('p1','P','',0,0);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO task_prompts (task_id, prompt_id, origin, position) \
             VALUES ('t1', 'p1', ?1, 0)",
            params![format!("role:{}", role.id)],
        )
        .unwrap();
        delete(&conn, &role.id).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_prompts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "trigger should have stripped inherited row");
    }
}
