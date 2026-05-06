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
    /// Optional pixel-icon identifier (migration `018_role_icon.sql`).
    /// The frontend maps this string onto a React component from
    /// `src/shared/ui/Icon/`.
    pub icon: Option<String>,
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
            icon: row.get("icon")?,
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
    /// Pixel-icon identifier (`None` means no icon).
    pub icon: Option<String>,
}

/// Partial update payload.
#[derive(Debug, Clone, Default)]
pub struct RolePatch {
    pub name: Option<String>,
    pub content: Option<String>,
    pub color: Option<Option<String>>,
    /// `None` = leave alone; `Some(None)` = clear; `Some(Some(s))` = set.
    /// Mirrors the `color` encoding used everywhere else in the repo
    /// layer.
    pub icon: Option<Option<String>>,
}

/// `SELECT … FROM roles ORDER BY name ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<RoleRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, content, color, icon, created_at, updated_at, is_system \
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
        "SELECT id, name, content, color, icon, created_at, updated_at, is_system \
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
        "SELECT id, name, content, color, icon, created_at, updated_at, is_system \
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
        "INSERT INTO roles (id, name, content, color, icon, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, draft.name, draft.content, draft.color, draft.icon, now],
    )?;
    Ok(RoleRow {
        id,
        name: draft.name.clone(),
        content: draft.content.clone(),
        color: draft.color.clone(),
        icon: draft.icon.clone(),
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
    use std::fmt::Write as _;
    // `color` and `icon` are both `Option<Option<String>>` — a single
    // `UPDATE … COALESCE …` cannot express the "set me to NULL" branch
    // for either, so we build the statement dynamically. Mirrors the
    // `prompts` repo (see `update` in `prompts.rs`) — at most four
    // combinations of (color, icon) presence, every one is a straight
    // UPDATE that SQLite optimises identically. `name` / `content`
    // keep the COALESCE pattern.
    let now = now_millis();
    let color_new = patch.color.as_ref();
    let icon_new = patch.icon.as_ref();

    let mut sql = String::from(
        "UPDATE roles SET name = COALESCE(?1, name), content = COALESCE(?2, content)",
    );
    let mut next_param = 3_usize;
    let mut params_vec: Vec<rusqlite::types::Value> =
        vec![patch.name.clone().into(), patch.content.clone().into()];
    if let Some(c) = color_new {
        let _ = write!(sql, ", color = ?{next_param}");
        params_vec.push(rusqlite::types::Value::from(c.clone()));
        next_param += 1;
    }
    if let Some(i) = icon_new {
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
                icon: Some("PixelInterfaceEssentialList".into()),
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
                icon: None,
            },
        )
        .unwrap();
        let err = insert(
            &conn,
            &RoleDraft {
                name: "Same".into(),
                content: String::new(),
                color: None,
                icon: None,
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
    fn update_round_trips_icon_set_and_clear() {
        // Migration 018 added the `icon` column. The patch is
        // `Option<Option<String>>`: `Some(Some(_))` sets, `Some(None)`
        // clears, `None` leaves the column alone. Verify all three.
        let conn = fresh_db();
        let row = insert(
            &conn,
            &RoleDraft {
                name: "Iconful".into(),
                content: String::new(),
                color: None,
                icon: Some("PixelInterfaceEssentialList".into()),
            },
        )
        .unwrap();
        assert_eq!(row.icon.as_deref(), Some("PixelInterfaceEssentialList"));

        // Set to a different identifier.
        let updated = update(
            &conn,
            &row.id,
            &RolePatch {
                icon: Some(Some("PixelInterfaceEssentialStar".into())),
                ..RolePatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.icon.as_deref(), Some("PixelInterfaceEssentialStar"));

        // Clear via Some(None).
        let cleared = update(
            &conn,
            &row.id,
            &RolePatch {
                icon: Some(None),
                ..RolePatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert!(cleared.icon.is_none());

        // Untouched (icon: None) leaves the column at its current value
        // — set a fresh identifier first so we can observe the no-op.
        update(
            &conn,
            &row.id,
            &RolePatch {
                icon: Some(Some("PixelInterfaceEssentialHeart".into())),
                ..RolePatch::default()
            },
        )
        .unwrap();
        let untouched = update(
            &conn,
            &row.id,
            &RolePatch {
                name: Some("Renamed".into()),
                ..RolePatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(untouched.name, "Renamed");
        assert_eq!(
            untouched.icon.as_deref(),
            Some("PixelInterfaceEssentialHeart"),
            "icon: None on the patch must not touch the column"
        );
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
                icon: None,
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
                icon: None,
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
                icon: None,
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
                icon: None,
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
