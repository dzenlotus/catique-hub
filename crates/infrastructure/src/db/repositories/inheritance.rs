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

use super::tasks::AttachScope;
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
///   3. `cascade_clear_skill_scope` followed by one
///      `cascade_skill_attachment` per leaf — the resolver's
///      materialised `task_skills` rows are kept in sync inside the
///      same transaction (ctq-121).
///
/// Empty `skill_ids` clears the parent and wipes the scope's
/// materialised rows.
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
    let attach_scope = inheritance_to_attach_scope(scope, parent_id);
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    set_inner(&tx, table, parent, parent_id, "skill_id", skill_ids)?;
    // Materialised rows: wipe the prior scope contribution and
    // re-cascade each leaf with `position = idx as f64` (matches the
    // join-table numbering set by `set_inner`).
    cascade_clear_skill_scope(&tx, &attach_scope)?;
    for (idx, skill_id) in skill_ids.iter().enumerate() {
        #[allow(clippy::cast_precision_loss)]
        let position = idx as f64;
        cascade_skill_attachment(&tx, &attach_scope, skill_id, position)?;
    }
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

/// Replace the entire MCP-tool list for `parent_id`. Mirrors
/// [`set_skills`] — also clears + re-cascades the materialised
/// `task_mcp_tools` rows in the same transaction (ctq-121).
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
    let attach_scope = inheritance_to_attach_scope(scope, parent_id);
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    set_inner(&tx, table, parent, parent_id, "mcp_tool_id", mcp_tool_ids)?;
    cascade_clear_mcp_tool_scope(&tx, &attach_scope)?;
    for (idx, mcp_tool_id) in mcp_tool_ids.iter().enumerate() {
        #[allow(clippy::cast_precision_loss)]
        let position = idx as f64;
        cascade_mcp_tool_attachment(&tx, &attach_scope, mcp_tool_id, position)?;
    }
    tx.commit()?;
    Ok(())
}

/// Bridge between the [`InheritanceScope`] (board/column/space — used
/// by the join tables in this module) and the cascade-side
/// [`AttachScope`] (which also covers role).
fn inheritance_to_attach_scope(scope: InheritanceScope, parent_id: &str) -> AttachScope {
    match scope {
        InheritanceScope::Board => AttachScope::Board(parent_id.to_owned()),
        InheritanceScope::Column => AttachScope::Column(parent_id.to_owned()),
        InheritanceScope::Space => AttachScope::Space(parent_id.to_owned()),
    }
}

// =====================================================================
// Cascade helpers — write-time materialisation onto task_skills /
// task_mcp_tools (ctq-121, mirrors ADR-0006 prompt cascades).
//
// Whenever a skill/mcp_tool is attached at any scope above task-direct,
// the application layer calls `cascade_skill_attachment` / mirror to
// INSERT one row into `task_skills` (or `task_mcp_tools`) for every task
// that inherits the attachment, tagging `origin` with the source scope
// id. Detachment uses the symmetric `cascade_*_detachment` helpers; the
// scope-clear sweeper supports the bulk `set_*` setters that need to
// wipe a scope's contributions before re-cascading.
//
// Idempotency: `INSERT OR IGNORE` (via `ON CONFLICT … DO NOTHING`) so
// re-runs and the override rule (direct beats inherited at read time)
// never clobber an existing row.
//
// The `task_skills` / `task_mcp_tools` schema (see `001_initial.sql:186-200`)
// uses `(task_id, leaf_id)` as the composite primary key with an
// `origin` column on top — same shape as `task_prompts`. The cleanup
// trigger `cleanup_role_origin_on_role_delete` already strips
// `origin = 'role:<id>'` rows on role delete (`001_initial.sql:248-250`),
// so role-scoped cascades survive the FK-cascade boundary cleanly.
// =====================================================================

/// Format the SQL-side origin tag for a scope: `role:<id>` /
/// `column:<id>` / `board:<id>` / `space:<id>`. Mirrors
/// `tasks::AttachScope::origin_tag` (which is private to that module —
/// we recompute here to keep the inheritance module self-contained).
fn origin_tag(scope: &AttachScope) -> String {
    match scope {
        AttachScope::Role(id) => format!("role:{id}"),
        AttachScope::Column(id) => format!("column:{id}"),
        AttachScope::Board(id) => format!("board:{id}"),
        AttachScope::Space(id) => format!("space:{id}"),
    }
}

/// Materialise one skill onto every task in scope. Idempotent on
/// `(task_id, skill_id)` — `ON CONFLICT DO NOTHING` so an existing
/// direct attachment is never overwritten.
///
/// Returns the number of rows materialised (zero if no tasks live under
/// the scope).
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`]. The cascade is
/// FK-safe by construction (it enumerates existing tasks).
pub fn cascade_skill_attachment(
    conn: &Connection,
    scope: &AttachScope,
    skill_id: &str,
    position: f64,
) -> Result<usize, DbError> {
    cascade_leaf_attachment(conn, scope, "task_skills", "skill_id", skill_id, position)
}

/// Symmetric inverse of [`cascade_skill_attachment`]: strip every row
/// inherited from this scope+skill pair. Direct rows
/// (`origin = 'direct'`) survive — the override rule keeps a user's
/// manual attachment alive across a board-level detach.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn cascade_skill_detachment(
    conn: &Connection,
    scope: &AttachScope,
    skill_id: &str,
) -> Result<usize, DbError> {
    let origin = origin_tag(scope);
    let n = conn.execute(
        "DELETE FROM task_skills WHERE skill_id = ?1 AND origin = ?2",
        params![skill_id, origin],
    )?;
    Ok(n)
}

/// Strip every inherited row in `task_skills` carrying this scope's
/// origin (regardless of `skill_id`). Used by `set_*_skills` bulk
/// setters that need to wipe the scope's contribution before
/// re-cascading the new ordered list.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn cascade_clear_skill_scope(
    conn: &Connection,
    scope: &AttachScope,
) -> Result<usize, DbError> {
    let origin = origin_tag(scope);
    let n = conn.execute(
        "DELETE FROM task_skills WHERE origin = ?1",
        params![origin],
    )?;
    Ok(n)
}

/// Materialise one MCP tool onto every task in scope. Symmetric mirror
/// of [`cascade_skill_attachment`] over `task_mcp_tools`.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn cascade_mcp_tool_attachment(
    conn: &Connection,
    scope: &AttachScope,
    mcp_tool_id: &str,
    position: f64,
) -> Result<usize, DbError> {
    cascade_leaf_attachment(
        conn,
        scope,
        "task_mcp_tools",
        "mcp_tool_id",
        mcp_tool_id,
        position,
    )
}

/// Symmetric inverse of [`cascade_mcp_tool_attachment`].
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn cascade_mcp_tool_detachment(
    conn: &Connection,
    scope: &AttachScope,
    mcp_tool_id: &str,
) -> Result<usize, DbError> {
    let origin = origin_tag(scope);
    let n = conn.execute(
        "DELETE FROM task_mcp_tools WHERE mcp_tool_id = ?1 AND origin = ?2",
        params![mcp_tool_id, origin],
    )?;
    Ok(n)
}

/// Strip every inherited row in `task_mcp_tools` carrying this scope's
/// origin.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn cascade_clear_mcp_tool_scope(
    conn: &Connection,
    scope: &AttachScope,
) -> Result<usize, DbError> {
    let origin = origin_tag(scope);
    let n = conn.execute(
        "DELETE FROM task_mcp_tools WHERE origin = ?1",
        params![origin],
    )?;
    Ok(n)
}

/// Shared body for `cascade_skill_attachment` / `cascade_mcp_tool_attachment`.
/// `table` is `task_skills` or `task_mcp_tools`; `leaf_col` is the
/// per-table leaf column name (`skill_id` / `mcp_tool_id`). The fixed
/// `task_*` prefix and the closed `AttachScope` set make this safe
/// against SQL injection — we never format a user-supplied string into
/// the SQL body.
fn cascade_leaf_attachment(
    conn: &Connection,
    scope: &AttachScope,
    table: &'static str,
    leaf_col: &'static str,
    leaf_id: &str,
    position: f64,
) -> Result<usize, DbError> {
    debug_assert!(
        matches!(table, "task_skills" | "task_mcp_tools"),
        "cascade_leaf_attachment only handles task_skills / task_mcp_tools",
    );
    debug_assert!(
        matches!(leaf_col, "skill_id" | "mcp_tool_id"),
        "leaf_col must match the table",
    );
    let origin = origin_tag(scope);
    let n = match scope {
        AttachScope::Role(id) => {
            let sql = format!(
                "INSERT INTO {table} (task_id, {leaf_col}, origin, position) \
                 SELECT t.id, ?2, ?3, ?4 \
                 FROM tasks t \
                 WHERE t.role_id = ?1 \
                 ON CONFLICT(task_id, {leaf_col}) DO NOTHING",
            );
            conn.execute(&sql, params![id, leaf_id, origin, position])?
        }
        AttachScope::Column(id) => {
            let sql = format!(
                "INSERT INTO {table} (task_id, {leaf_col}, origin, position) \
                 SELECT t.id, ?2, ?3, ?4 \
                 FROM tasks t \
                 WHERE t.column_id = ?1 \
                 ON CONFLICT(task_id, {leaf_col}) DO NOTHING",
            );
            conn.execute(&sql, params![id, leaf_id, origin, position])?
        }
        AttachScope::Board(id) => {
            let sql = format!(
                "INSERT INTO {table} (task_id, {leaf_col}, origin, position) \
                 SELECT t.id, ?2, ?3, ?4 \
                 FROM tasks t \
                 WHERE t.board_id = ?1 \
                 ON CONFLICT(task_id, {leaf_col}) DO NOTHING",
            );
            conn.execute(&sql, params![id, leaf_id, origin, position])?
        }
        AttachScope::Space(id) => {
            let sql = format!(
                "INSERT INTO {table} (task_id, {leaf_col}, origin, position) \
                 SELECT t.id, ?2, ?3, ?4 \
                 FROM tasks t \
                 JOIN boards b ON b.id = t.board_id \
                 WHERE b.space_id = ?1 \
                 ON CONFLICT(task_id, {leaf_col}) DO NOTHING",
            );
            conn.execute(&sql, params![id, leaf_id, origin, position])?
        }
    };
    Ok(n)
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

    // -----------------------------------------------------------------
    // ctq-121 — skill / mcp_tool inheritance cascade onto task_skills /
    // task_mcp_tools. Mirrors the prompt-cascade unit tests in
    // `tasks.rs`.
    // -----------------------------------------------------------------

    /// Seed two tasks under the column `co` so cascade has somewhere
    /// to materialise into.
    fn seed_two_tasks_on_column(conn: &Connection) -> [&'static str; 2] {
        conn.execute_batch(
            "INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES \
                 ('t1','bd','co','sp-1','T1',0,0,0), \
                 ('t2','bd','co','sp-2','T2',1,0,0);",
        )
        .unwrap();
        ["t1", "t2"]
    }

    #[test]
    fn cascade_skill_attachment_materialises_for_column_scope() {
        let conn = fresh_db();
        let _ = seed_two_tasks_on_column(&conn);
        let n = cascade_skill_attachment(
            &conn,
            &AttachScope::Column("co".into()),
            "sk1",
            1.0,
        )
        .unwrap();
        assert_eq!(n, 2);
        let origin: String = conn
            .query_row(
                "SELECT origin FROM task_skills WHERE task_id = 't1' AND skill_id = 'sk1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(origin, "column:co");
    }

    #[test]
    fn cascade_skill_detachment_strips_only_scope_origin() {
        let conn = fresh_db();
        let _ = seed_two_tasks_on_column(&conn);

        // Direct attachment + column cascade with the same skill — the
        // cascade INSERT-OR-IGNORE preserves the direct row.
        conn.execute(
            "INSERT INTO task_skills (task_id, skill_id, origin, position) \
             VALUES ('t1','sk1','direct',0.0)",
            [],
        )
        .unwrap();
        cascade_skill_attachment(&conn, &AttachScope::Column("co".into()), "sk1", 1.0).unwrap();

        // Detach the cascade — direct row must survive on t1.
        cascade_skill_detachment(&conn, &AttachScope::Column("co".into()), "sk1").unwrap();
        let origin_t1: String = conn
            .query_row(
                "SELECT origin FROM task_skills WHERE task_id = 't1' AND skill_id = 'sk1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(origin_t1, "direct");
        // t2 had only the cascade row — must be gone.
        let n_t2: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_skills WHERE task_id = 't2' AND skill_id = 'sk1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n_t2, 0);
    }

    #[test]
    fn set_skills_cascades_via_inheritance_setter() {
        // ctq-121 contract: invoking `set_skills` on a board with two
        // tasks must materialise origin-tagged rows in task_skills.
        let mut conn = fresh_db();
        conn.execute_batch(
            "INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES \
                 ('t1','bd','co','sp-1','T1',0,0,0), \
                 ('t2','bd','co','sp-2','T2',1,0,0);",
        )
        .unwrap();
        set_skills(
            &mut conn,
            InheritanceScope::Board,
            "bd",
            &["sk1".to_owned(), "sk2".to_owned()],
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_skills WHERE origin = 'board:bd'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 4, "two tasks × two skills = 4 rows");

        // Replace with [sk1] — must drop the sk2 cascade rows in lockstep.
        set_skills(
            &mut conn,
            InheritanceScope::Board,
            "bd",
            &["sk1".to_owned()],
        )
        .unwrap();
        let count_after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_skills WHERE origin = 'board:bd'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count_after, 2, "only sk1 cascade survives");
        let count_sk2: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_skills WHERE skill_id = 'sk2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count_sk2, 0);
    }

    #[test]
    fn set_skills_clears_cascade_rows_when_input_empty() {
        let mut conn = fresh_db();
        conn.execute(
            "INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1','bd','co','sp-1','T1',0,0,0)",
            [],
        )
        .unwrap();
        set_skills(
            &mut conn,
            InheritanceScope::Space,
            "sp",
            &["sk1".to_owned()],
        )
        .unwrap();
        // Sanity: cascade landed.
        let before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_skills WHERE origin = 'space:sp'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(before, 1);

        set_skills(&mut conn, InheritanceScope::Space, "sp", &[]).unwrap();
        let after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_skills WHERE origin = 'space:sp'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(after, 0);
    }

    #[test]
    fn cascade_mcp_tool_attachment_materialises_for_space_scope() {
        let conn = fresh_db();
        let _ = seed_two_tasks_on_column(&conn);
        let n =
            cascade_mcp_tool_attachment(&conn, &AttachScope::Space("sp".into()), "mt1", 0.0)
                .unwrap();
        assert_eq!(n, 2, "both tasks live in space sp");
        let origin: String = conn
            .query_row(
                "SELECT origin FROM task_mcp_tools WHERE task_id = 't1' AND mcp_tool_id = 'mt1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(origin, "space:sp");
    }

    #[test]
    fn set_mcp_tools_cascades_and_clear_lifecycle() {
        let mut conn = fresh_db();
        conn.execute(
            "INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1','bd','co','sp-1','T1',0,0,0)",
            [],
        )
        .unwrap();
        set_mcp_tools(
            &mut conn,
            InheritanceScope::Column,
            "co",
            &["mt1".to_owned(), "mt2".to_owned()],
        )
        .unwrap();
        let mat: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_mcp_tools WHERE origin = 'column:co'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mat, 2);
        set_mcp_tools(&mut conn, InheritanceScope::Column, "co", &[]).unwrap();
        let after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_mcp_tools WHERE origin = 'column:co'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(after, 0);
    }

    #[test]
    fn cascade_skill_role_attachment_only_hits_role_bearing_tasks() {
        let conn = fresh_db();
        // Seed roles and three tasks: two on rl1, one off-role.
        conn.execute_batch(
            "INSERT INTO roles (id, name, content, created_at, updated_at) VALUES \
                 ('rl1','R1','',0,0), ('rl2','R2','',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, role_id, position, created_at, updated_at) VALUES \
                 ('ta','bd','co','sp-a','T1','rl1',0,0,0), \
                 ('tb','bd','co','sp-b','T2','rl1',1,0,0), \
                 ('tc','bd','co','sp-c','T3','rl2',2,0,0);",
        )
        .unwrap();
        let n = cascade_skill_attachment(&conn, &AttachScope::Role("rl1".into()), "sk1", 1.0)
            .unwrap();
        assert_eq!(n, 2, "rl1 has exactly two tasks");
        let off_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_skills WHERE task_id = 'tc'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(off_count, 0, "tc is on rl2; cascade must not hit it");
    }
}
