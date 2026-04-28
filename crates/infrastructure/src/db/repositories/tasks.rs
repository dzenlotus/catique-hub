//! Tasks repository — kanban cards.
//!
//! Schema: `001_initial.sql`, Promptery v0.4 lines 86-99 (table) plus
//! `task_prompts` / `task_attachments` / `task_prompt_overrides` (link
//! tables). Wave-E2.4 (Olga) ships the table CRUD plus `add_task_prompt`
//! / `remove_task_prompt` and `set_task_prompt_override` helpers.
//!
//! Slug semantics: per the wave-brief we use the "simple" form
//! `<space-prefix>-<6-char-nanoid>` rather than Promptery's
//! `space_counters`-driven `<prefix>-NN`. This keeps the migration
//! collapsing trick (D-028) self-contained — `space_counters` exists in
//! the schema for import-module compatibility but Catique itself doesn't
//! drive it. A follow-up E3 ticket can wire `space_counters` if the UI
//! requires monotonic numbers.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `tasks` table.
#[derive(Debug, Clone, PartialEq)]
pub struct TaskRow {
    pub id: String,
    pub board_id: String,
    pub column_id: String,
    pub slug: String,
    pub title: String,
    pub description: Option<String>,
    pub position: f64,
    pub role_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl TaskRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            board_id: row.get("board_id")?,
            column_id: row.get("column_id")?,
            slug: row.get("slug")?,
            title: row.get("title")?,
            description: row.get("description")?,
            position: row.get("position")?,
            role_id: row.get("role_id")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new task.
#[derive(Debug, Clone)]
pub struct TaskDraft {
    pub board_id: String,
    pub column_id: String,
    pub title: String,
    pub description: Option<String>,
    pub position: f64,
    pub role_id: Option<String>,
}

/// Partial update payload.
#[derive(Debug, Clone, Default)]
pub struct TaskPatch {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub column_id: Option<String>,
    pub position: Option<f64>,
    pub role_id: Option<Option<String>>,
}

/// `SELECT … FROM tasks ORDER BY board_id, column_id, position ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<TaskRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, board_id, column_id, slug, title, description, position, role_id, created_at, updated_at \
         FROM tasks ORDER BY board_id, column_id, position ASC",
    )?;
    let rows = stmt.query_map([], TaskRow::from_row)?;
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
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<TaskRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, board_id, column_id, slug, title, description, position, role_id, created_at, updated_at \
         FROM tasks WHERE id = ?1",
    )?;
    Ok(stmt.query_row(params![id], TaskRow::from_row).optional()?)
}

/// Resolve the space prefix that a board belongs to. Used by `insert`
/// to derive a task slug. Returns `None` if the board doesn't exist or
/// its space row is somehow missing (FK violations would have rejected
/// that earlier; we still surface `None` defensively).
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn space_prefix_for_board(
    conn: &Connection,
    board_id: &str,
) -> Result<Option<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT s.prefix FROM boards b JOIN spaces s ON s.id = b.space_id \
         WHERE b.id = ?1",
    )?;
    Ok(stmt
        .query_row(params![board_id], |r| r.get::<_, String>(0))
        .optional()?)
}

/// Insert one task. Generates id, derives slug from the board's space
/// prefix (`<prefix>-<6-char-nanoid>` — see module docs), stamps
/// timestamps. The caller must supply a valid `column_id` that belongs
/// to `board_id`; cross-board column moves are detected as FK chain
/// failures, not by this layer.
///
/// # Errors
///
/// FK violations on board/column/role surface as
/// [`DbError::Sqlite`]; UNIQUE(slug) collisions are vanishingly
/// unlikely (6-char nanoid alphabet 64) but possible — the caller may
/// retry once.
pub fn insert(conn: &Connection, draft: &TaskDraft) -> Result<TaskRow, DbError> {
    let id = new_id();
    let now = now_millis();
    let prefix = space_prefix_for_board(conn, &draft.board_id)?.unwrap_or_else(|| "x".to_owned());
    let slug = format!("{prefix}-{}", short_id());

    conn.execute(
        "INSERT INTO tasks \
            (id, board_id, column_id, slug, title, description, position, role_id, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            draft.board_id,
            draft.column_id,
            slug,
            draft.title,
            draft.description,
            draft.position,
            draft.role_id,
            now,
        ],
    )?;
    Ok(TaskRow {
        id,
        board_id: draft.board_id.clone(),
        column_id: draft.column_id.clone(),
        slug,
        title: draft.title.clone(),
        description: draft.description.clone(),
        position: draft.position,
        role_id: draft.role_id.clone(),
        created_at: now,
        updated_at: now,
    })
}

/// Partial update via `COALESCE`. Bumps `updated_at`.
///
/// # Errors
///
/// FK violations on column / role surface as [`DbError::Sqlite`].
pub fn update(conn: &Connection, id: &str, patch: &TaskPatch) -> Result<Option<TaskRow>, DbError> {
    use std::fmt::Write as _;

    let now = now_millis();
    let mut sql = String::from(
        "UPDATE tasks SET title = COALESCE(?1, title), \
            position = COALESCE(?2, position), \
            column_id = COALESCE(?3, column_id)",
    );
    let mut params_vec: Vec<rusqlite::types::Value> = vec![
        patch.title.clone().into(),
        patch.position.into(),
        patch.column_id.clone().into(),
    ];
    let mut next = 4_usize;
    if let Some(d) = patch.description.as_ref() {
        let _ = write!(sql, ", description = ?{next}");
        params_vec.push(rusqlite::types::Value::from(d.clone()));
        next += 1;
    }
    if let Some(r) = patch.role_id.as_ref() {
        let _ = write!(sql, ", role_id = ?{next}");
        params_vec.push(rusqlite::types::Value::from(r.clone()));
        next += 1;
    }
    let _ = write!(sql, ", updated_at = ?{next} WHERE id = ?{}", next + 1);
    params_vec.push(now.into());
    params_vec.push(id.to_owned().into());

    let updated = conn.execute(&sql, rusqlite::params_from_iter(params_vec.iter()))?;
    if updated == 0 {
        return Ok(None);
    }
    get_by_id(conn, id)
}

/// Delete one task. Cascades to `task_prompts`, `task_skills`,
/// `task_mcp_tools`, `task_attachments`, `task_prompt_overrides`,
/// `agent_reports`, `task_events`, `tasks_fts` (via trigger).
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

// ---------------------------------------------------------------------
// Join-table helpers — task_prompts (direct attachment) +
// task_prompt_overrides (per-task suppress / force-enable).
// ---------------------------------------------------------------------

/// Attach a prompt directly to a task (origin = 'direct'). Idempotent.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn add_task_prompt(
    conn: &Connection,
    task_id: &str,
    prompt_id: &str,
    position: f64,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO task_prompts (task_id, prompt_id, origin, position) \
         VALUES (?1, ?2, 'direct', ?3) \
         ON CONFLICT(task_id, prompt_id) DO UPDATE SET position = excluded.position",
        params![task_id, prompt_id, position],
    )?;
    Ok(())
}

/// Detach a direct prompt from a task. Inherited rows (origin
/// `role:…`, `board:…`, `column:…`) are not touched — they're managed
/// by the resolver (E3).
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_task_prompt(
    conn: &Connection,
    task_id: &str,
    prompt_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM task_prompts WHERE task_id = ?1 AND prompt_id = ?2 AND origin = 'direct'",
        params![task_id, prompt_id],
    )?;
    Ok(n > 0)
}

/// Set or replace a per-task prompt override. `enabled = 0` suppresses
/// the prompt for this single task; `enabled = 1` is reserved for
/// future force-enable semantics (Promptery v0.4 line 222-223).
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn set_task_prompt_override(
    conn: &Connection,
    task_id: &str,
    prompt_id: &str,
    enabled: bool,
) -> Result<(), DbError> {
    let now = now_millis();
    conn.execute(
        "INSERT INTO task_prompt_overrides (task_id, prompt_id, enabled, created_at) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(task_id, prompt_id) DO UPDATE SET enabled = excluded.enabled",
        params![task_id, prompt_id, i64::from(enabled), now],
    )?;
    Ok(())
}

/// Clear a per-task prompt override.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn clear_task_prompt_override(
    conn: &Connection,
    task_id: &str,
    prompt_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM task_prompt_overrides WHERE task_id = ?1 AND prompt_id = ?2",
        params![task_id, prompt_id],
    )?;
    Ok(n > 0)
}

/// 6-character nanoid for slug suffixes. URL-safe alphabet, lowercase
/// letters + digits only (mirrors Promptery's slug-format expectations).
fn short_id() -> String {
    nanoid::nanoid!(6, &SLUG_ALPHABET)
}

/// `[a-z0-9]` — Promptery slugs only allow these in the suffix.
const SLUG_ALPHABET: [char; 36] = [
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's',
    't', 'u', 'v', 'w', 'x', 'y', 'z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    fn fresh_db_with_board() -> (Connection, String, String) {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd1','B','sp1',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c1','bd1','Todo',0,0);",
        )
        .unwrap();
        (conn, "bd1".into(), "c1".into())
    }

    fn draft(board: &str, col: &str) -> TaskDraft {
        TaskDraft {
            board_id: board.into(),
            column_id: col.into(),
            title: "T".into(),
            description: Some("desc".into()),
            position: 1.0,
            role_id: None,
        }
    }

    #[test]
    fn insert_then_get_with_slug() {
        let (conn, bd, col) = fresh_db_with_board();
        let row = insert(&conn, &draft(&bd, &col)).unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
        assert!(row.slug.starts_with("sp-"));
        assert_eq!(row.slug.len(), 3 + 6);
    }

    #[test]
    fn list_all_orders_by_board_column_position() {
        let (conn, bd, col) = fresh_db_with_board();
        insert(
            &conn,
            &TaskDraft {
                position: 2.0,
                ..draft(&bd, &col)
            },
        )
        .unwrap();
        insert(
            &conn,
            &TaskDraft {
                position: 1.0,
                ..draft(&bd, &col)
            },
        )
        .unwrap();
        let rows = list_all(&conn).unwrap();
        assert!(rows[0].position < rows[1].position);
    }

    #[test]
    fn update_changes_only_supplied_fields() {
        let (conn, bd, col) = fresh_db_with_board();
        let row = insert(&conn, &draft(&bd, &col)).unwrap();
        let updated = update(
            &conn,
            &row.id,
            &TaskPatch {
                title: Some("New".into()),
                ..TaskPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.title, "New");
        // f64 comparison: position is unchanged since no patch supplied
        // it; bit-exact equality is fine here.
        assert!((updated.position - 1.0).abs() < f64::EPSILON);
        assert_eq!(updated.column_id, "c1");
    }

    #[test]
    fn update_returns_none_for_missing_id() {
        let (conn, _, _) = fresh_db_with_board();
        assert!(update(&conn, "ghost", &TaskPatch::default())
            .unwrap()
            .is_none());
    }

    #[test]
    fn delete_returns_true_then_false() {
        let (conn, bd, col) = fresh_db_with_board();
        let row = insert(&conn, &draft(&bd, &col)).unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn fts_row_inserted_on_task_insert() {
        let (conn, bd, col) = fresh_db_with_board();
        let _row = insert(
            &conn,
            &TaskDraft {
                title: "Hello search".into(),
                description: Some("body text".into()),
                ..draft(&bd, &col)
            },
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "FTS trigger should populate sibling table");
    }

    #[test]
    fn task_prompt_override_round_trip() {
        let (conn, bd, col) = fresh_db_with_board();
        let task = insert(&conn, &draft(&bd, &col)).unwrap();
        conn.execute(
            "INSERT INTO prompts (id, name, content, created_at, updated_at) \
             VALUES ('p1','P','',0,0)",
            [],
        )
        .unwrap();
        set_task_prompt_override(&conn, &task.id, "p1", false).unwrap();
        let enabled: i64 = conn
            .query_row(
                "SELECT enabled FROM task_prompt_overrides WHERE task_id=?1 AND prompt_id=?2",
                params![task.id, "p1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(enabled, 0);
        assert!(clear_task_prompt_override(&conn, &task.id, "p1").unwrap());
        assert!(!clear_task_prompt_override(&conn, &task.id, "p1").unwrap());
    }
}
