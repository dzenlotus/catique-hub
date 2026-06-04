//! `task_*_overrides_v2` repositories — refactor-v3 D-A.
//!
//! Replace-OR-suppress overrides for the three attached-entity kinds on
//! a single task: prompts, skills, and mcp_tools. One table per kind,
//! identical shape:
//!
//! ```text
//! task_<kind>_overrides_v2(
//!     task_id, source_<kind>_id, replacement_<kind>_id NULL, created_at
//! )
//! PRIMARY KEY (task_id, source_<kind>_id)
//! ```
//!
//! Migration: `032_task_overrides_v2.sql`. Decision memo:
//! `docs/refactor-v3/decisions/D-A-override-semantics-skills-integrations.md`.
//!
//! Semantics applied at read-time by
//! [`crate::db::repositories::tasks::resolve_task_bundle`] post-pass:
//!
//!   * `replacement_*_id IS NULL`     → drop the inherited row from the
//!     bundle and surface it under `suppressed_*`.
//!   * `replacement_*_id IS NOT NULL` → substitute the entity, keep the
//!     original `OriginRef`, flag `overridden = true`.
//!
//! The set helpers UPSERT on `(task_id, source_id)` so a follow-up call
//! flips suppress ↔ replace atomically. The clear helpers return whether
//! a row matched, mirroring `clear_task_prompt_override` from the legacy
//! suppress-only path.

use rusqlite::{params, Connection};

use super::util::now_millis;
use crate::db::pool::DbError;

/// One row of `task_prompt_overrides_v2`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptOverrideRow {
    pub task_id: String,
    pub source_prompt_id: String,
    /// `None` = suppress; `Some(id)` = replace with `id`.
    pub replacement_prompt_id: Option<String>,
    pub created_at: i64,
}

/// One row of `task_skill_overrides_v2`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillOverrideRow {
    pub task_id: String,
    pub source_skill_id: String,
    pub replacement_skill_id: Option<String>,
    pub created_at: i64,
}

/// One row of `task_mcp_tool_overrides_v2`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpToolOverrideRow {
    pub task_id: String,
    pub source_tool_id: String,
    pub replacement_tool_id: Option<String>,
    pub created_at: i64,
}

// ------------------------------------------------------------------ prompts

/// UPSERT a per-task prompt override. `replacement_prompt_id = None`
/// suppresses the inherited prompt; `Some(id)` substitutes it.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn set_task_prompt_override_v2(
    conn: &Connection,
    task_id: &str,
    source_prompt_id: &str,
    replacement_prompt_id: Option<&str>,
) -> Result<(), DbError> {
    let now = now_millis();
    conn.execute(
        "INSERT INTO task_prompt_overrides_v2 \
            (task_id, source_prompt_id, replacement_prompt_id, created_at) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(task_id, source_prompt_id) DO UPDATE SET \
             replacement_prompt_id = excluded.replacement_prompt_id",
        params![task_id, source_prompt_id, replacement_prompt_id, now],
    )?;
    Ok(())
}

/// Clear one per-task prompt override. Returns whether a row matched.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn clear_task_prompt_override_v2(
    conn: &Connection,
    task_id: &str,
    source_prompt_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM task_prompt_overrides_v2 \
         WHERE task_id = ?1 AND source_prompt_id = ?2",
        params![task_id, source_prompt_id],
    )?;
    Ok(n > 0)
}

/// List every prompt-override row for `task_id`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_task_prompt_overrides_v2(
    conn: &Connection,
    task_id: &str,
) -> Result<Vec<PromptOverrideRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT task_id, source_prompt_id, replacement_prompt_id, created_at \
         FROM task_prompt_overrides_v2 WHERE task_id = ?1",
    )?;
    let rows = stmt.query_map(params![task_id], |row| {
        Ok(PromptOverrideRow {
            task_id: row.get(0)?,
            source_prompt_id: row.get(1)?,
            replacement_prompt_id: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

// ------------------------------------------------------------------- skills

/// UPSERT a per-task skill override.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn set_task_skill_override_v2(
    conn: &Connection,
    task_id: &str,
    source_skill_id: &str,
    replacement_skill_id: Option<&str>,
) -> Result<(), DbError> {
    let now = now_millis();
    conn.execute(
        "INSERT INTO task_skill_overrides_v2 \
            (task_id, source_skill_id, replacement_skill_id, created_at) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(task_id, source_skill_id) DO UPDATE SET \
             replacement_skill_id = excluded.replacement_skill_id",
        params![task_id, source_skill_id, replacement_skill_id, now],
    )?;
    Ok(())
}

/// Clear one per-task skill override.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn clear_task_skill_override_v2(
    conn: &Connection,
    task_id: &str,
    source_skill_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM task_skill_overrides_v2 \
         WHERE task_id = ?1 AND source_skill_id = ?2",
        params![task_id, source_skill_id],
    )?;
    Ok(n > 0)
}

/// List every skill-override row for `task_id`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_task_skill_overrides_v2(
    conn: &Connection,
    task_id: &str,
) -> Result<Vec<SkillOverrideRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT task_id, source_skill_id, replacement_skill_id, created_at \
         FROM task_skill_overrides_v2 WHERE task_id = ?1",
    )?;
    let rows = stmt.query_map(params![task_id], |row| {
        Ok(SkillOverrideRow {
            task_id: row.get(0)?,
            source_skill_id: row.get(1)?,
            replacement_skill_id: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

// ----------------------------------------------------------------- mcp_tools

/// UPSERT a per-task mcp-tool override.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn set_task_mcp_tool_override_v2(
    conn: &Connection,
    task_id: &str,
    source_tool_id: &str,
    replacement_tool_id: Option<&str>,
) -> Result<(), DbError> {
    let now = now_millis();
    conn.execute(
        "INSERT INTO task_mcp_tool_overrides_v2 \
            (task_id, source_tool_id, replacement_tool_id, created_at) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(task_id, source_tool_id) DO UPDATE SET \
             replacement_tool_id = excluded.replacement_tool_id",
        params![task_id, source_tool_id, replacement_tool_id, now],
    )?;
    Ok(())
}

/// Clear one per-task mcp-tool override.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn clear_task_mcp_tool_override_v2(
    conn: &Connection,
    task_id: &str,
    source_tool_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM task_mcp_tool_overrides_v2 \
         WHERE task_id = ?1 AND source_tool_id = ?2",
        params![task_id, source_tool_id],
    )?;
    Ok(n > 0)
}

/// List every mcp-tool-override row for `task_id`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_task_mcp_tool_overrides_v2(
    conn: &Connection,
    task_id: &str,
) -> Result<Vec<McpToolOverrideRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT task_id, source_tool_id, replacement_tool_id, created_at \
         FROM task_mcp_tool_overrides_v2 WHERE task_id = ?1",
    )?;
    let rows = stmt.query_map(params![task_id], |row| {
        Ok(McpToolOverrideRow {
            task_id: row.get(0)?,
            source_tool_id: row.get(1)?,
            replacement_tool_id: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;
    use rusqlite::Connection;

    /// Seed one space + board + column + task + the three entities the
    /// override tables reference. Returns `(conn, task_id)`.
    fn fresh_db_with_task() -> (Connection, String) {
        let mut conn = Connection::open_in_memory().expect("open mem");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("PRAGMA");
        run_pending(&mut conn).expect("migrations");
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','S','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd1','B','sp1',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c1','bd1','C',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1','bd1','c1','sp-1','T',0,0,0); \
             INSERT INTO prompts (id, name, content, created_at, updated_at) \
                 VALUES ('p1','P1','',0,0), ('p2','P2','',0,0); \
             INSERT INTO skills (id, name, content, created_at, updated_at) \
                 VALUES ('s1','S1','',0,0), ('s2','S2','',0,0); \
             INSERT INTO mcp_tools (id, name, content, created_at, updated_at) \
                 VALUES ('m1','M1','',0,0), ('m2','M2','',0,0);",
        )
        .expect("seed");
        (conn, "t1".into())
    }

    #[test]
    fn prompt_override_suppress_round_trip() {
        let (conn, task_id) = fresh_db_with_task();
        set_task_prompt_override_v2(&conn, &task_id, "p1", None).expect("set");
        let rows = list_task_prompt_overrides_v2(&conn, &task_id).expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source_prompt_id, "p1");
        assert!(rows[0].replacement_prompt_id.is_none());
        assert!(clear_task_prompt_override_v2(&conn, &task_id, "p1").expect("clear"));
        assert!(!clear_task_prompt_override_v2(&conn, &task_id, "p1").expect("clear-2"));
    }

    #[test]
    fn prompt_override_replace_upsert_flips_suppress() {
        let (conn, task_id) = fresh_db_with_task();
        // suppress first, then upgrade to replace.
        set_task_prompt_override_v2(&conn, &task_id, "p1", None).expect("set-suppress");
        set_task_prompt_override_v2(&conn, &task_id, "p1", Some("p2")).expect("set-replace");
        let rows = list_task_prompt_overrides_v2(&conn, &task_id).expect("list");
        assert_eq!(rows.len(), 1, "UPSERT must not create duplicates");
        assert_eq!(rows[0].replacement_prompt_id.as_deref(), Some("p2"));
    }

    #[test]
    fn skill_override_round_trip() {
        let (conn, task_id) = fresh_db_with_task();
        set_task_skill_override_v2(&conn, &task_id, "s1", Some("s2")).expect("set");
        let rows = list_task_skill_overrides_v2(&conn, &task_id).expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].replacement_skill_id.as_deref(), Some("s2"));
        assert!(clear_task_skill_override_v2(&conn, &task_id, "s1").expect("clear"));
    }

    #[test]
    fn mcp_tool_override_round_trip() {
        let (conn, task_id) = fresh_db_with_task();
        set_task_mcp_tool_override_v2(&conn, &task_id, "m1", None).expect("set");
        let rows = list_task_mcp_tool_overrides_v2(&conn, &task_id).expect("list");
        assert_eq!(rows.len(), 1);
        assert!(rows[0].replacement_tool_id.is_none());
        assert!(clear_task_mcp_tool_override_v2(&conn, &task_id, "m1").expect("clear"));
    }

    #[test]
    fn delete_task_cascades_overrides() {
        // FK ON DELETE CASCADE — overrides go with the task.
        let (conn, task_id) = fresh_db_with_task();
        set_task_prompt_override_v2(&conn, &task_id, "p1", Some("p2")).expect("set-p");
        set_task_skill_override_v2(&conn, &task_id, "s1", None).expect("set-s");
        set_task_mcp_tool_override_v2(&conn, &task_id, "m1", Some("m2")).expect("set-m");
        conn.execute("DELETE FROM tasks WHERE id = ?1", params![task_id])
            .expect("delete task");
        assert!(list_task_prompt_overrides_v2(&conn, &task_id)
            .expect("list")
            .is_empty());
        assert!(list_task_skill_overrides_v2(&conn, &task_id)
            .expect("list")
            .is_empty());
        assert!(list_task_mcp_tool_overrides_v2(&conn, &task_id)
            .expect("list")
            .is_empty());
    }
}
