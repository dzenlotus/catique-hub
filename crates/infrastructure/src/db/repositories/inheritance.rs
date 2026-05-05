//! Skill / MCP-tool inheritance join tables for boards, columns, spaces.
//!
//! ctq-120 (Phase 1 cat-as-agent inheritance): six pure join tables
//! materialised by migration `014_board_column_space_skills.sql`. Each
//! table has the same shape — composite primary key of
//! `(parent_id, leaf_id)` plus a `position REAL` column for stable
//! ordering. The IPC surface ships only bulk setters (`set_*`); the
//! finer-grained `add_*` / `remove_*` helpers are exposed for the
//! follow-up PRs that wire the resolver, plus internal use by `set_*`.
//!
//! Why a single parametric module instead of 12 hand-written methods on
//! `boards.rs` / `columns.rs` / `spaces.rs`? Each helper is a single SQL
//! statement that differs only in the table name and parent column. We
//! validate the table name against a fixed enum before formatting the
//! query so the SQL string is never user-driven (no injection surface).
//!
//! Idempotency contract:
//! * `add_*`   — `INSERT OR IGNORE` (no `ON CONFLICT … DO UPDATE` to
//!   keep position stable on re-add, matching the `task_skills` /
//!   `task_mcp_tools` direct-attach helpers added in ctq-127).
//! * `remove_*` — `DELETE FROM …`; returning `bool` lets the use case
//!   decide whether to surface NotFound.
//! * `set_*`   — runs inside a single transaction: DELETE every row for
//!   the parent, then INSERT the supplied list with monotonically
//!   increasing positions. Empty input clears the parent.

use rusqlite::{params, Connection, Transaction, TransactionBehavior};

use crate::db::pool::DbError;

/// Parent scope for a skill or MCP-tool inheritance attachment.
/// Encoded as an enum so the SQL emitter validates the table name
/// against a closed set; user-supplied strings never reach `format!`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InheritanceScope {
    /// Attaches via `board_skills` / `board_mcp_tools`.
    Board,
    /// Attaches via `column_skills` / `column_mcp_tools`.
    Column,
    /// Attaches via `space_skills` / `space_mcp_tools`.
    Space,
}

impl InheritanceScope {
    /// Parent column name (`board_id`, `column_id`, `space_id`).
    const fn parent_col(self) -> &'static str {
        match self {
            Self::Board => "board_id",
            Self::Column => "column_id",
            Self::Space => "space_id",
        }
    }

    /// Join table for skills.
    const fn skill_table(self) -> &'static str {
        match self {
            Self::Board => "board_skills",
            Self::Column => "column_skills",
            Self::Space => "space_skills",
        }
    }

    /// Join table for MCP tools.
    const fn mcp_tool_table(self) -> &'static str {
        match self {
            Self::Board => "board_mcp_tools",
            Self::Column => "column_mcp_tools",
            Self::Space => "space_mcp_tools",
        }
    }
}

// =====================================================================
// Skills — list / add / remove / set.
// =====================================================================

/// Return the IDs of skills attached to `parent_id`, ordered by
/// `position ASC`. The use-case layer joins onto `skills` if it needs
/// the full row.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_skills(
    conn: &Connection,
    scope: InheritanceScope,
    parent_id: &str,
) -> Result<Vec<String>, DbError> {
    let table = scope.skill_table();
    let parent = scope.parent_col();
    let sql = format!("SELECT skill_id FROM {table} WHERE {parent} = ?1 ORDER BY position ASC",);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![parent_id], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Attach `skill_id` to `parent_id` at `position`. Idempotent on the
/// composite `(parent_id, skill_id)` key — re-attaching the same pair
/// is a no-op (does NOT bump position).
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn add_skill(
    conn: &Connection,
    scope: InheritanceScope,
    parent_id: &str,
    skill_id: &str,
    position: f64,
) -> Result<(), DbError> {
    let table = scope.skill_table();
    let parent = scope.parent_col();
    let sql = format!(
        "INSERT INTO {table} ({parent}, skill_id, position) VALUES (?1, ?2, ?3) \
         ON CONFLICT({parent}, skill_id) DO NOTHING",
    );
    conn.execute(&sql, params![parent_id, skill_id, position])?;
    Ok(())
}

/// Detach `skill_id` from `parent_id`. Returns `true` if a row was
/// removed.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_skill(
    conn: &Connection,
    scope: InheritanceScope,
    parent_id: &str,
    skill_id: &str,
) -> Result<bool, DbError> {
    let table = scope.skill_table();
    let parent = scope.parent_col();
    let sql = format!("DELETE FROM {table} WHERE {parent} = ?1 AND skill_id = ?2");
    let n = conn.execute(&sql, params![parent_id, skill_id])?;
    Ok(n > 0)
}

/// Replace the entire skill list for `parent_id`. Runs inside one
/// IMMEDIATE transaction:
///   1. `DELETE FROM <table> WHERE <parent> = ?1`
///   2. `INSERT … (parent_id, skill_id, position)` for each `skill_id`
///      with `position = i as f64` to preserve caller-supplied order.
///
/// Empty `skill_ids` clears the parent.
///
/// # Errors
///
/// Surfaces rusqlite errors. FK violations on any `skill_id` are
/// reported as `DbError::Sqlite`; the transaction rolls back so the
/// pre-call state is preserved.
pub fn set_skills(
    conn: &mut Connection,
    scope: InheritanceScope,
    parent_id: &str,
    skill_ids: &[String],
) -> Result<(), DbError> {
    let table = scope.skill_table();
    let parent = scope.parent_col();
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    set_inner(&tx, table, parent, parent_id, "skill_id", skill_ids)?;
    tx.commit()?;
    Ok(())
}

// =====================================================================
// MCP tools — list / add / remove / set.
// =====================================================================

/// Return the IDs of MCP tools attached to `parent_id`, ordered by
/// `position ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_mcp_tools(
    conn: &Connection,
    scope: InheritanceScope,
    parent_id: &str,
) -> Result<Vec<String>, DbError> {
    let table = scope.mcp_tool_table();
    let parent = scope.parent_col();
    let sql = format!("SELECT mcp_tool_id FROM {table} WHERE {parent} = ?1 ORDER BY position ASC",);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![parent_id], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Attach `mcp_tool_id` to `parent_id`. Idempotent.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn add_mcp_tool(
    conn: &Connection,
    scope: InheritanceScope,
    parent_id: &str,
    mcp_tool_id: &str,
    position: f64,
) -> Result<(), DbError> {
    let table = scope.mcp_tool_table();
    let parent = scope.parent_col();
    let sql = format!(
        "INSERT INTO {table} ({parent}, mcp_tool_id, position) VALUES (?1, ?2, ?3) \
         ON CONFLICT({parent}, mcp_tool_id) DO NOTHING",
    );
    conn.execute(&sql, params![parent_id, mcp_tool_id, position])?;
    Ok(())
}

/// Detach `mcp_tool_id` from `parent_id`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_mcp_tool(
    conn: &Connection,
    scope: InheritanceScope,
    parent_id: &str,
    mcp_tool_id: &str,
) -> Result<bool, DbError> {
    let table = scope.mcp_tool_table();
    let parent = scope.parent_col();
    let sql = format!("DELETE FROM {table} WHERE {parent} = ?1 AND mcp_tool_id = ?2");
    let n = conn.execute(&sql, params![parent_id, mcp_tool_id])?;
    Ok(n > 0)
}

/// Replace the entire MCP-tool list for `parent_id`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn set_mcp_tools(
    conn: &mut Connection,
    scope: InheritanceScope,
    parent_id: &str,
    mcp_tool_ids: &[String],
) -> Result<(), DbError> {
    let table = scope.mcp_tool_table();
    let parent = scope.parent_col();
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    set_inner(&tx, table, parent, parent_id, "mcp_tool_id", mcp_tool_ids)?;
    tx.commit()?;
    Ok(())
}

/// Shared body for `set_skills` / `set_mcp_tools`: DELETE + bulk INSERT.
fn set_inner(
    tx: &Transaction<'_>,
    table: &str,
    parent_col: &str,
    parent_id: &str,
    leaf_col: &str,
    leaf_ids: &[String],
) -> Result<(), DbError> {
    let delete_sql = format!("DELETE FROM {table} WHERE {parent_col} = ?1");
    tx.execute(&delete_sql, params![parent_id])?;

    if leaf_ids.is_empty() {
        return Ok(());
    }

    let insert_sql =
        format!("INSERT INTO {table} ({parent_col}, {leaf_col}, position) VALUES (?1, ?2, ?3)",);
    let mut stmt = tx.prepare(&insert_sql)?;
    for (idx, leaf_id) in leaf_ids.iter().enumerate() {
        // `idx` is bounded by the input slice length; in practice the
        // UI never sends more than a few hundred ids, so the f64 cast
        // is exact for any conceivable input.
        #[allow(clippy::cast_precision_loss)]
        let position = idx as f64;
        stmt.execute(params![parent_id, leaf_id, position])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        // Seed fixtures: one space + board + column + two skills + two
        // MCP tools so every scope has a real parent id to anchor on.
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd','B','sp',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('co','bd','C',0,0); \
             INSERT INTO skills (id, name, content, created_at, updated_at) VALUES \
                 ('sk1','S1','',0,0), \
                 ('sk2','S2','',0,0); \
             INSERT INTO mcp_tools (id, name, content, created_at, updated_at) VALUES \
                 ('mt1','M1','',0,0), \
                 ('mt2','M2','',0,0);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn set_skills_replaces_existing_list() {
        let mut conn = fresh_db();
        // Seed: attach sk1 to board.
        add_skill(&conn, InheritanceScope::Board, "bd", "sk1", 0.0).unwrap();
        // Replace with [sk2] only.
        set_skills(
            &mut conn,
            InheritanceScope::Board,
            "bd",
            &["sk2".to_owned()],
        )
        .unwrap();
        let after = list_skills(&conn, InheritanceScope::Board, "bd").unwrap();
        assert_eq!(after, vec!["sk2".to_owned()]);
    }

    #[test]
    fn set_skills_empty_clears_parent() {
        let mut conn = fresh_db();
        add_skill(&conn, InheritanceScope::Board, "bd", "sk1", 0.0).unwrap();
        set_skills(&mut conn, InheritanceScope::Board, "bd", &[]).unwrap();
        let after = list_skills(&conn, InheritanceScope::Board, "bd").unwrap();
        assert!(after.is_empty());
    }

    #[test]
    fn add_skill_idempotent_on_pair() {
        let conn = fresh_db();
        add_skill(&conn, InheritanceScope::Column, "co", "sk1", 1.0).unwrap();
        add_skill(&conn, InheritanceScope::Column, "co", "sk1", 999.0).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM column_skills WHERE column_id = 'co'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn remove_skill_returns_false_when_absent() {
        let conn = fresh_db();
        assert!(!remove_skill(&conn, InheritanceScope::Space, "sp", "ghost").unwrap());
    }

    #[test]
    fn cascade_on_parent_delete_strips_join_rows() {
        let mut conn = fresh_db();
        // Wire skills + tools onto the column, then delete the column —
        // both join tables must be empty after the cascade.
        set_skills(
            &mut conn,
            InheritanceScope::Column,
            "co",
            &["sk1".to_owned(), "sk2".to_owned()],
        )
        .unwrap();
        set_mcp_tools(
            &mut conn,
            InheritanceScope::Column,
            "co",
            &["mt1".to_owned()],
        )
        .unwrap();
        conn.execute("DELETE FROM columns WHERE id = 'co'", [])
            .unwrap();
        let n_skills: i64 = conn
            .query_row("SELECT COUNT(*) FROM column_skills", [], |r| r.get(0))
            .unwrap();
        let n_tools: i64 = conn
            .query_row("SELECT COUNT(*) FROM column_mcp_tools", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n_skills, 0);
        assert_eq!(n_tools, 0);
    }

    #[test]
    fn set_skills_preserves_caller_order_via_position() {
        let mut conn = fresh_db();
        set_skills(
            &mut conn,
            InheritanceScope::Space,
            "sp",
            &["sk2".to_owned(), "sk1".to_owned()],
        )
        .unwrap();
        let after = list_skills(&conn, InheritanceScope::Space, "sp").unwrap();
        assert_eq!(after, vec!["sk2".to_owned(), "sk1".to_owned()]);
    }

    #[test]
    fn set_mcp_tools_round_trip_for_every_scope() {
        let mut conn = fresh_db();
        for scope in [
            InheritanceScope::Board,
            InheritanceScope::Column,
            InheritanceScope::Space,
        ] {
            let parent = match scope {
                InheritanceScope::Board => "bd",
                InheritanceScope::Column => "co",
                InheritanceScope::Space => "sp",
            };
            set_mcp_tools(
                &mut conn,
                scope,
                parent,
                &["mt1".to_owned(), "mt2".to_owned()],
            )
            .unwrap();
            let got = list_mcp_tools(&conn, scope, parent).unwrap();
            assert_eq!(got, vec!["mt1".to_owned(), "mt2".to_owned()]);
        }
    }
}
