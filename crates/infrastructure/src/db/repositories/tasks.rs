//! Tasks repository — kanban cards.
//!
//! Schema: `001_initial.sql`, Promptery v0.4 lines 86-99 (table) plus
//! `task_prompts` / `task_attachments` / `task_prompt_overrides` (link
//! tables). Wave-E2.4 (Olga) ships the table CRUD plus `add_task_prompt`
//! / `remove_task_prompt` and `set_task_prompt_override` helpers.
//!
//! Slug semantics: `<space-prefix>-<sequential-int>`. The integer
//! counter is **per-space** (not per-board, not global) and is computed
//! as `MAX(numeric_part) + 1` over all existing tasks in that space, so
//! retired slugs are *not* reused (deleting `cot-2` leaves the next
//! insert at `cot-4` if `cot-3` already exists). Slug computation +
//! `INSERT INTO tasks` run inside one `IMMEDIATE` transaction so two
//! concurrent inserts into the same space cannot collide; the
//! `UNIQUE(slug)` index in `001_initial.sql:143` is a defensive
//! backstop, not the primary mechanism. The legacy
//! `space_counters` table stays in the schema for import-module
//! compatibility but is not driven from here.

use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};

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
    /// Append-only log of timestamped step summaries. Default `""`.
    /// See [`append_step_log`] for the line format.
    pub step_log: String,
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
            step_log: row.get("step_log")?,
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
        "SELECT id, board_id, column_id, slug, title, description, position, role_id, created_at, updated_at, step_log \
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
        "SELECT id, board_id, column_id, slug, title, description, position, role_id, created_at, updated_at, step_log \
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

/// Insert one task. Generates id, derives a sequential per-space slug
/// (`<prefix>-<n>` — see module docs), stamps timestamps. The caller
/// must supply a valid `column_id` that belongs to `board_id`;
/// cross-board column moves are detected as FK chain failures, not by
/// this layer.
///
/// Slug computation (`MAX(numeric_part) + 1` scoped to the space) runs
/// in the same `IMMEDIATE` transaction as the `INSERT`, so two
/// concurrent inserts into one space serialise on SQLite's writer lock
/// rather than racing into a duplicate slug.
///
/// # Errors
///
/// FK violations on board/column/role surface as [`DbError::Sqlite`].
/// `UNIQUE(slug)` collisions cannot happen under correct usage of this
/// function (the transaction makes `MAX+1` race-free); if one ever
/// surfaces it indicates schema/data corruption and is propagated as
/// [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &TaskDraft) -> Result<TaskRow, DbError> {
    let id = new_id();
    let now = now_millis();

    // Resolve prefix + space id outside the tx — read-only and the
    // resolver only inspects the boards/spaces tables which the
    // following IMMEDIATE tx will lock-upgrade as needed. We lowercase
    // defensively even though the domain constraint already restricts
    // prefixes to `[a-z0-9-]`.
    let (prefix, space_id) = match space_id_and_prefix_for_board(conn, &draft.board_id)? {
        Some((sid, pre)) => (pre.to_ascii_lowercase(), Some(sid)),
        None => ("x".to_owned(), None),
    };

    // IMMEDIATE upgrades to a RESERVED (write) lock at BEGIN, so a
    // concurrent writer waits here (busy_timeout) instead of racing
    // through the SELECT and colliding on UNIQUE(slug) at COMMIT.
    // `new_unchecked` lets us hold the standard `&Connection` signature
    // — DEFERRED would otherwise upgrade only on first write, leaving a
    // window where two threads both observe the same MAX before either
    // INSERT.
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;

    let next_seq: i64 = if let Some(ref sid) = space_id {
        tx.query_row(
            "SELECT COALESCE(MAX(CAST(substr(t.slug, length(?1) + 2) AS INTEGER)), 0) + 1 \
             FROM tasks t \
             JOIN boards b ON b.id = t.board_id \
             WHERE b.space_id = ?2 AND t.slug LIKE ?1 || '-%'",
            params![prefix, sid],
            |r| r.get(0),
        )?
    } else {
        // Fallback path when the board has no resolvable space (the
        // FK on tasks.board_id should make this unreachable, but we
        // keep parity with the previous "x" behaviour). Scope the
        // counter to all tasks whose slug starts with `x-`.
        tx.query_row(
            "SELECT COALESCE(MAX(CAST(substr(slug, length(?1) + 2) AS INTEGER)), 0) + 1 \
             FROM tasks WHERE slug LIKE ?1 || '-%'",
            params![prefix],
            |r| r.get(0),
        )?
    };

    let slug = format!("{prefix}-{next_seq}");

    tx.execute(
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

    tx.commit()?;

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
        // Newly inserted tasks have an empty log; appends happen via
        // `append_step_log` after creation.
        step_log: String::new(),
    })
}

/// Resolve `(space_id, prefix)` for the space that owns `board_id`.
/// Internal helper — `space_prefix_for_board` stays public for
/// backward compat. Returns `None` if the board / space pair is
/// missing (defensive — FK chain should already prevent this).
fn space_id_and_prefix_for_board(
    conn: &Connection,
    board_id: &str,
) -> Result<Option<(String, String)>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.prefix FROM boards b JOIN spaces s ON s.id = b.space_id \
         WHERE b.id = ?1",
    )?;
    Ok(stmt
        .query_row(params![board_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .optional()?)
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

/// Append one timestamped line to a task's `step_log`. Format:
/// `[YYYY-MM-DDTHH:MM:SSZ] {summary}\n` (RFC-3339 UTC, second
/// granularity). Always ends with a newline so consecutive appends do
/// not run together.
///
/// Idempotency is *not* enforced — the repository accepts duplicates.
/// `when_unix_ms` is the wall-clock time the caller wants stamped on
/// the line; the use-case layer passes `now_unix_ms()`.
///
/// # Errors
///
/// `DbError::Sqlite` if the row does not exist (UPDATE matches zero
/// rows, returned as `Sqlite` for symmetry with FK errors). Use cases
/// should pre-check `get_by_id` to surface a typed `NotFound`.
pub fn append_step_log(
    conn: &Connection,
    task_id: &str,
    summary: &str,
    when_unix_ms: i64,
) -> Result<(), DbError> {
    let line = format_step_log_line(summary, when_unix_ms);
    conn.execute(
        "UPDATE tasks SET step_log = step_log || ?1 WHERE id = ?2",
        params![line, task_id],
    )?;
    Ok(())
}

/// Read the raw `step_log` buffer for a task. Returns the empty string
/// for a freshly-inserted task or `None` if the task does not exist.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get_step_log(conn: &Connection, task_id: &str) -> Result<Option<String>, DbError> {
    let mut stmt = conn.prepare("SELECT step_log FROM tasks WHERE id = ?1")?;
    Ok(stmt
        .query_row(params![task_id], |r| r.get::<_, String>(0))
        .optional()?)
}

/// Format one step-log line as `[YYYY-MM-DDTHH:MM:SSZ] {summary}\n`.
///
/// We format manually rather than pulling in `chrono` / `time` to
/// honour the dependency-discipline brief — `step_log` is the only
/// caller of date formatting in the repository layer. Algorithm:
/// civil-from-days following Howard Hinnant's
/// [chrono date algorithms paper](https://howardhinnant.github.io/date_algorithms.html#civil_from_days),
/// which sidesteps leap-year edge cases without a dependency.
fn format_step_log_line(summary: &str, when_unix_ms: i64) -> String {
    let total_secs = when_unix_ms.div_euclid(1_000);
    let mut day = total_secs.div_euclid(86_400);
    let mut sod = total_secs.rem_euclid(86_400);
    let hour = sod / 3_600;
    sod %= 3_600;
    let minute = sod / 60;
    let second = sod % 60;

    // Hinnant: shift epoch from 1970-01-01 to 0000-03-01 (`+ 719468`),
    // compute the era, year-of-era, day-of-year, then unwind.
    day += 719_468;
    let era = day.div_euclid(146_097);
    let doe = day.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!("[{year:04}-{m:02}-{d:02}T{hour:02}:{minute:02}:{second:02}Z] {summary}\n")
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
//
// Inherited-prompt materialisation lives below (`cascade_*`) — see
// ADR-0006 for the write-time strategy.
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
    add_task_prompt_with_origin(conn, task_id, prompt_id, position, "direct")
}

/// Attach a prompt to a task with a specific `origin` tag. The
/// `origin` argument is the SQL-side string form (`"direct"`,
/// `"role:<id>"`, `"column:<id>"`, `"board:<id>"`, `"space:<id>"`) — see
/// `domain::OriginRef` for the typed mirror.
///
/// Idempotent on `(task_id, prompt_id)`: if a row already exists with
/// the **same** origin, only `position` is updated. If the existing row
/// has a *different* origin we leave it alone — the override rule
/// "direct beats inherited" is enforced at read time, and we never want
/// a cascade INSERT to clobber a direct attachment that the user
/// established explicitly.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn add_task_prompt_with_origin(
    conn: &Connection,
    task_id: &str,
    prompt_id: &str,
    position: f64,
    origin: &str,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO task_prompts (task_id, prompt_id, origin, position) \
         VALUES (?1, ?2, ?4, ?3) \
         ON CONFLICT(task_id, prompt_id) DO UPDATE SET \
            position = excluded.position \
         WHERE task_prompts.origin = excluded.origin",
        params![task_id, prompt_id, position, origin],
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

/// List all prompts attached to a task, joined from `prompts`, ordered by
/// the join-table `position` column (ascending). Returns the full `PromptRow`
/// shape so callers can display the prompt name and colour.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_task_prompts(
    conn: &Connection,
    task_id: &str,
) -> Result<Vec<super::prompts::PromptRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.content, p.color, p.short_description, p.icon, \
                p.examples_json, p.token_count, p.created_at, p.updated_at \
         FROM task_prompts tp \
         JOIN prompts p ON p.id = tp.prompt_id \
         WHERE tp.task_id = ?1 \
         ORDER BY tp.position ASC",
    )?;
    let rows = stmt.query_map(params![task_id], super::prompts::PromptRow::from_row_pub)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

// =====================================================================
// Inherited-prompt materialisation (ADR-0006 — write-time strategy).
//
// Whenever a prompt is attached at any scope above task-direct, the
// application layer calls one of the `cascade_prompt_attachment_*`
// helpers below to INSERT one row into `task_prompts` for every task
// that inherits the attachment. Detachment uses the symmetric
// `cascade_prompt_detachment_*` helpers. The existing role-delete
// trigger (`001_initial.sql:245-251`) already strips role-origin rows
// when the parent role is dropped; the helpers here cover the
// configuration-time mutations.
//
// The hot read path lives in [`resolve_task_bundle`] further down; it
// is a single index-scan over `task_prompts` joined to `prompts` plus a
// small Rust-side dedup (override rule "direct beats inherited"). See
// ADR-0006 §"Decision" for the latency-budget rationale (P99 < 50 ms).
// =====================================================================

/// Scope at which a prompt was attached, i.e. which join-table row the
/// caller just inserted. Mirrors the domain-side `OriginRef` minus the
/// `Direct` variant (direct attachments don't cascade).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachScope {
    /// Cascade onto every task with `task.role_id = role_id`.
    Role(String),
    /// Cascade onto every task whose column is `column_id`.
    Column(String),
    /// Cascade onto every task whose board is `board_id`.
    Board(String),
    /// Cascade onto every task whose board's space is `space_id`.
    Space(String),
}

impl AttachScope {
    /// SQL-side origin tag: `role:<id>` / `column:<id>` / `board:<id>` /
    /// `space:<id>`. The format matches the cleanup trigger at
    /// `001_initial.sql:245-251`.
    fn origin_tag(&self) -> String {
        match self {
            Self::Role(id) => format!("role:{id}"),
            Self::Column(id) => format!("column:{id}"),
            Self::Board(id) => format!("board:{id}"),
            Self::Space(id) => format!("space:{id}"),
        }
    }
}

/// Materialise one prompt onto every task in scope. Idempotent on
/// `(task_id, prompt_id)` — the `INSERT OR IGNORE` form is critical so
/// re-runs (and the backfill walker) don't bump positions on direct
/// rows that share the same `prompt_id`.
///
/// `position` is copied verbatim from the source join table's position
/// column — the resolver re-orders by precedence first, position
/// second, so the position only matters within a single origin bucket.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`]. The cascade SELECT is
/// FK-safe by construction (it only enumerates existing tasks).
pub fn cascade_prompt_attachment(
    conn: &Connection,
    scope: &AttachScope,
    prompt_id: &str,
    position: f64,
) -> Result<usize, DbError> {
    let origin = scope.origin_tag();
    let n = match scope {
        AttachScope::Role(id) => conn.execute(
            "INSERT INTO task_prompts (task_id, prompt_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 \
             FROM tasks t \
             WHERE t.role_id = ?1 \
             ON CONFLICT(task_id, prompt_id) DO NOTHING",
            params![id, prompt_id, origin, position],
        )?,
        AttachScope::Column(id) => conn.execute(
            "INSERT INTO task_prompts (task_id, prompt_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 \
             FROM tasks t \
             WHERE t.column_id = ?1 \
             ON CONFLICT(task_id, prompt_id) DO NOTHING",
            params![id, prompt_id, origin, position],
        )?,
        AttachScope::Board(id) => conn.execute(
            "INSERT INTO task_prompts (task_id, prompt_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 \
             FROM tasks t \
             WHERE t.board_id = ?1 \
             ON CONFLICT(task_id, prompt_id) DO NOTHING",
            params![id, prompt_id, origin, position],
        )?,
        AttachScope::Space(id) => conn.execute(
            "INSERT INTO task_prompts (task_id, prompt_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 \
             FROM tasks t \
             JOIN boards b ON b.id = t.board_id \
             WHERE b.space_id = ?1 \
             ON CONFLICT(task_id, prompt_id) DO NOTHING",
            params![id, prompt_id, origin, position],
        )?,
    };
    Ok(n)
}

/// Symmetric inverse of [`cascade_prompt_attachment`]: strip every
/// inherited row that originated from this scope+prompt pair. Direct
/// rows (`origin = 'direct'`) are explicitly preserved — the override
/// rule means a user's manual attachment must survive a board-level
/// detach of the same prompt.
///
/// Returns the number of rows deleted.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn cascade_prompt_detachment(
    conn: &Connection,
    scope: &AttachScope,
    prompt_id: &str,
) -> Result<usize, DbError> {
    let origin = scope.origin_tag();
    let n = conn.execute(
        "DELETE FROM task_prompts WHERE prompt_id = ?1 AND origin = ?2",
        params![prompt_id, origin],
    )?;
    Ok(n)
}

/// Strip every inherited row with the given scope-origin (regardless of
/// `prompt_id`). Used by `set_*_prompts` bulk setters that need to wipe
/// the scope's contribution before re-cascading the new ordered list.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn cascade_clear_scope(conn: &Connection, scope: &AttachScope) -> Result<usize, DbError> {
    let origin = scope.origin_tag();
    let n = conn.execute(
        "DELETE FROM task_prompts WHERE origin = ?1",
        params![origin],
    )?;
    Ok(n)
}

/// One row from the resolver's hot-path SELECT. Pure data — the use-case
/// layer turns this into a `domain::PromptWithOrigin`.
#[derive(Debug, Clone)]
pub struct ResolvedPromptRow {
    pub origin_raw: String,
    pub position: f64,
    pub prompt: super::prompts::PromptRow,
}

/// Resolve the full prompt set for one task — single index scan on
/// `task_prompts` joined to `prompts`. The override rule "direct beats
/// inherited" is applied in Rust after the fetch (ADR-0006 §AC-5):
/// if two rows share `prompt_id`, the higher-precedence origin wins.
///
/// Returns rows sorted by `position` ASC; the use-case layer handles
/// the precedence ordering (Direct > Role > Column > Board > Space)
/// and the override-rule de-duplication after the fetch.
///
/// # Errors
///
/// Surfaces rusqlite errors. Empty result for unknown `task_id` —
/// existence is the caller's concern.
pub fn resolve_task_prompts(
    conn: &Connection,
    task_id: &str,
) -> Result<Vec<ResolvedPromptRow>, DbError> {
    // AC-1: single-table read path. The `idx_task_prompts_task` index
    // (001_initial.sql:234) covers the WHERE; the JOIN on prompts is a
    // primary-key seek per row. EXPLAIN QUERY PLAN confirms no UNION.
    let mut stmt = conn.prepare(
        "SELECT tp.origin, tp.position, \
                p.id, p.name, p.content, p.color, p.short_description, p.icon, \
                p.examples_json, p.token_count, p.created_at, p.updated_at \
         FROM task_prompts tp \
         JOIN prompts p ON p.id = tp.prompt_id \
         WHERE tp.task_id = ?1 \
         ORDER BY tp.position ASC",
    )?;
    let rows = stmt.query_map(params![task_id], |row| {
        let origin: String = row.get("origin")?;
        let position: f64 = row.get("position")?;
        let prompt = super::prompts::PromptRow::from_row_pub(row)?;
        Ok(ResolvedPromptRow {
            origin_raw: origin,
            position,
            prompt,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Resolve the active role for a task: `task.role_id` if set, else
/// `column.role_id`, else `board.role_id`. Returns `None` when none of
/// the three carry a role assignment.
///
/// Two queries: one for the task's own role_id (which may dereference
/// to a row), and a fallback that walks up the column/board chain. The
/// fallback only runs when the direct lookup misses, so the hot path on
/// directly-assigned tasks is one row.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn resolve_active_role(
    conn: &Connection,
    task_id: &str,
) -> Result<Option<super::roles::RoleRow>, DbError> {
    // Single SELECT with a chained COALESCE; SQLite evaluates the
    // sub-selects lazily so columns/boards lookups only fire when the
    // higher-precedence column is NULL.
    let role_id: Option<String> = conn
        .query_row(
            "SELECT COALESCE( \
                t.role_id, \
                (SELECT c.role_id FROM columns c WHERE c.id = t.column_id), \
                (SELECT b.role_id FROM boards b WHERE b.id = t.board_id) \
             ) AS active_role_id \
             FROM tasks t WHERE t.id = ?1",
            params![task_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let Some(rid) = role_id else {
        return Ok(None);
    };
    super::roles::get_by_id(conn, &rid)
}

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
        assert_eq!(row.slug, "sp-1");
    }

    /// Helper: bootstrap a fresh in-memory DB with one space (`prefix
    /// = "cot"`) and one board. Returns `(conn, board_id, column_id)`.
    /// Mirrors `fresh_db_with_board` but with the user-facing prefix
    /// from the spec so test assertions read naturally.
    fn fresh_db_cot() -> (Connection, String, String) {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp-cot','Cotique','cot',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd-cot','B','sp-cot',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c-cot','bd-cot','Todo',0,0);",
        )
        .unwrap();
        (conn, "bd-cot".into(), "c-cot".into())
    }

    #[test]
    fn insert_first_task_yields_one() {
        let (conn, bd, col) = fresh_db_cot();
        let row = insert(&conn, &draft(&bd, &col)).unwrap();
        assert_eq!(row.slug, "cot-1");
    }

    #[test]
    fn insert_second_task_yields_two() {
        let (conn, bd, col) = fresh_db_cot();
        let first = insert(&conn, &draft(&bd, &col)).unwrap();
        let second = insert(&conn, &draft(&bd, &col)).unwrap();
        assert_eq!(first.slug, "cot-1");
        assert_eq!(second.slug, "cot-2");
    }

    #[test]
    fn counter_is_per_space_not_global() {
        let (conn, bd_cot, col_cot) = fresh_db_cot();
        // Add a second space (`per`) with its own board + column.
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp-per','Personal','per',0,1,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd-per','B','sp-per',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c-per','bd-per','Todo',0,0);",
        )
        .unwrap();

        let cot1 = insert(&conn, &draft(&bd_cot, &col_cot)).unwrap();
        let per1 = insert(&conn, &draft("bd-per", "c-per")).unwrap();

        assert_eq!(cot1.slug, "cot-1");
        assert_eq!(
            per1.slug, "per-1",
            "per-space counter must reset for a different space"
        );
    }

    #[test]
    fn deleted_slugs_are_not_reused() {
        let (conn, bd, col) = fresh_db_cot();
        let t1 = insert(&conn, &draft(&bd, &col)).unwrap();
        let t2 = insert(&conn, &draft(&bd, &col)).unwrap();
        let t3 = insert(&conn, &draft(&bd, &col)).unwrap();
        assert_eq!(t1.slug, "cot-1");
        assert_eq!(t2.slug, "cot-2");
        assert_eq!(t3.slug, "cot-3");

        // Drop the middle slug — `MAX + 1` must keep climbing.
        assert!(delete(&conn, &t2.id).unwrap());

        let t4 = insert(&conn, &draft(&bd, &col)).unwrap();
        assert_eq!(t4.slug, "cot-4");
    }

    /// Two writers race into the same space using a shared file-backed
    /// SQLite DB (cache=shared in-memory URIs require a wrapping
    /// connection; a tempfile is simpler and exercises the real WAL +
    /// busy_timeout path). Both must succeed and yield distinct,
    /// monotonically-numbered slugs covering `{cot-1, cot-2}`. This is
    /// the regression net for the IMMEDIATE-tx contract.
    #[test]
    fn concurrent_inserts_into_same_space_do_not_collide() {
        use std::sync::Arc;
        use std::sync::Barrier;
        use std::thread;
        use std::time::Duration;

        // Unique tempfile path per process invocation. Avoids pulling
        // `tempfile`; matches the pattern in `db::pool::tests`.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.subsec_nanos());
        let dir = std::env::temp_dir().join(format!("catique-tasks-conc-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("catique.db");

        // Bootstrap schema + seed via a one-shot connection.
        {
            let mut conn = Connection::open(&db_path).unwrap();
            conn.busy_timeout(Duration::from_secs(5)).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
                .unwrap();
            run_pending(&mut conn).expect("migrations");
            conn.execute_batch(
                "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                     VALUES ('sp-cot','Cotique','cot',0,0,0,0); \
                 INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                     VALUES ('bd-cot','B','sp-cot',0,0,0); \
                 INSERT INTO columns (id, board_id, name, position, created_at) \
                     VALUES ('c-cot','bd-cot','Todo',0,0);",
            )
            .unwrap();
        }

        let barrier = Arc::new(Barrier::new(2));
        let mut handles = Vec::new();
        for _ in 0..2 {
            let barrier = Arc::clone(&barrier);
            let path = db_path.clone();
            handles.push(thread::spawn(move || {
                let conn = Connection::open(&path).unwrap();
                conn.busy_timeout(Duration::from_secs(5)).unwrap();
                conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
                // Release both threads as close to simultaneously as
                // possible to maximise contention on the writer lock.
                barrier.wait();
                insert(&conn, &draft("bd-cot", "c-cot")).expect("insert under contention")
            }));
        }

        let mut slugs: Vec<String> = handles
            .into_iter()
            .map(|h| h.join().expect("thread panicked").slug)
            .collect();
        slugs.sort();
        assert_eq!(
            slugs,
            vec!["cot-1".to_owned(), "cot-2".to_owned()],
            "two concurrent inserts must produce {{cot-1, cot-2}} in some order"
        );

        // Best-effort cleanup; failure is non-fatal for the test.
        let _ = std::fs::remove_dir_all(&dir);
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
    fn insert_with_role_id_persists_it() {
        let (conn, bd, col) = fresh_db_with_board();
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES ('rl-x','Reviewer','',0,0)",
            [],
        )
        .unwrap();
        let row = insert(
            &conn,
            &TaskDraft {
                role_id: Some("rl-x".into()),
                ..draft(&bd, &col)
            },
        )
        .unwrap();
        assert_eq!(row.role_id.as_deref(), Some("rl-x"));
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(got.role_id.as_deref(), Some("rl-x"));
    }

    #[test]
    fn list_task_prompts_returns_in_position_order() {
        let (conn, bd, col) = fresh_db_with_board();
        let task = insert(&conn, &draft(&bd, &col)).unwrap();

        // Insert two prompts.
        conn.execute_batch(
            "INSERT INTO prompts (id, name, content, color, created_at, updated_at) \
                 VALUES ('p1','Alpha','',null,0,0), \
                        ('p2','Beta','','#ff0',0,0);",
        )
        .unwrap();

        // Attach in reverse position order (p2 at 0, p1 at 1) to verify
        // the ORDER BY tp.position clause.
        add_task_prompt(&conn, &task.id, "p2", 0.0).unwrap();
        add_task_prompt(&conn, &task.id, "p1", 1.0).unwrap();

        let prompts = list_task_prompts(&conn, &task.id).unwrap();
        assert_eq!(prompts.len(), 2);
        assert_eq!(prompts[0].id, "p2", "lower position should come first");
        assert_eq!(prompts[1].id, "p1");
        // Colour round-trips correctly.
        assert_eq!(prompts[1].color, None);
        assert_eq!(prompts[0].color, Some("#ff0".to_owned()));
    }

    #[test]
    fn step_log_default_is_empty_on_insert() {
        let (conn, bd, col) = fresh_db_with_board();
        let row = insert(&conn, &draft(&bd, &col)).unwrap();
        assert_eq!(row.step_log, "");
        let from_get = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(from_get.step_log, "");
    }

    #[test]
    fn append_step_log_formats_line_and_appends() {
        let (conn, bd, col) = fresh_db_with_board();
        let row = insert(&conn, &draft(&bd, &col)).unwrap();
        // Two known unix-ms timestamps so format is byte-deterministic.
        // 1714521600000 = 2024-05-01T00:00:00Z (chosen for its
        // human-readable round number); 1714521605000 is 5s later.
        append_step_log(&conn, &row.id, "first step", 1_714_521_600_000).unwrap();
        append_step_log(&conn, &row.id, "second step", 1_714_521_605_000).unwrap();

        let log = get_step_log(&conn, &row.id).unwrap().expect("row exists");
        assert_eq!(
            log,
            "[2024-05-01T00:00:00Z] first step\n[2024-05-01T00:00:05Z] second step\n"
        );
    }

    #[test]
    fn get_step_log_returns_none_for_missing_task() {
        let (conn, _, _) = fresh_db_with_board();
        assert!(get_step_log(&conn, "ghost").unwrap().is_none());
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

    // -----------------------------------------------------------------
    // ADR-0006 — write-time materialisation cascades. The unit tests
    // here cover the repository-level helpers; the use-case-side
    // wiring is tested in `application::tasks` against the IPC entry
    // points.
    // -----------------------------------------------------------------

    /// Helper: insert one prompt row directly (no use-case path).
    fn seed_prompt(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO prompts (id, name, content, created_at, updated_at) \
             VALUES (?1, ?1, '', 0, 0)",
            params![id],
        )
        .unwrap();
    }

    #[test]
    fn cascade_role_attachment_materialises_rows_for_tasks_on_role() {
        let (conn, bd, col) = fresh_db_with_board();
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES ('rl-x', 'X', '', 0, 0)",
            [],
        )
        .unwrap();
        seed_prompt(&conn, "p1");

        // Two tasks on the role, one task off it.
        let on_role_a = insert(
            &conn,
            &TaskDraft {
                role_id: Some("rl-x".into()),
                ..draft(&bd, &col)
            },
        )
        .unwrap();
        let on_role_b = insert(
            &conn,
            &TaskDraft {
                role_id: Some("rl-x".into()),
                ..draft(&bd, &col)
            },
        )
        .unwrap();
        let off_role = insert(&conn, &draft(&bd, &col)).unwrap();

        let n =
            cascade_prompt_attachment(&conn, &AttachScope::Role("rl-x".into()), "p1", 1.0).unwrap();
        assert_eq!(n, 2, "exactly the two role-bearing tasks materialise");

        // Origin tagged correctly on both, untouched on the third.
        let origin_a: String = conn
            .query_row(
                "SELECT origin FROM task_prompts WHERE task_id = ?1 AND prompt_id = 'p1'",
                params![on_role_a.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(origin_a, "role:rl-x");
        let origin_b: String = conn
            .query_row(
                "SELECT origin FROM task_prompts WHERE task_id = ?1 AND prompt_id = 'p1'",
                params![on_role_b.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(origin_b, "role:rl-x");
        let off: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_prompts WHERE task_id = ?1",
                params![off_role.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(off, 0);
    }

    #[test]
    fn cascade_detachment_strips_role_origin_only_preserves_direct() {
        let (conn, bd, col) = fresh_db_with_board();
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES ('rl-x', 'X', '', 0, 0)",
            [],
        )
        .unwrap();
        seed_prompt(&conn, "p1");
        let task = insert(
            &conn,
            &TaskDraft {
                role_id: Some("rl-x".into()),
                ..draft(&bd, &col)
            },
        )
        .unwrap();
        // Direct attachment first, then a role-cascade for the same prompt.
        add_task_prompt(&conn, &task.id, "p1", 0.5).unwrap();
        cascade_prompt_attachment(&conn, &AttachScope::Role("rl-x".into()), "p1", 1.0).unwrap();
        // Both rows? No — `INSERT OR IGNORE ON CONFLICT` keeps the direct
        // row in place. The cascade silently skips because direct has
        // higher precedence (and the override rule wins at read time).
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_prompts WHERE task_id = ?1 AND prompt_id = 'p1'",
                params![task.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let origin: String = conn
            .query_row(
                "SELECT origin FROM task_prompts WHERE task_id = ?1 AND prompt_id = 'p1'",
                params![task.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(origin, "direct", "direct attachment must survive cascade");

        // Detach the role-level attachment — direct row must remain.
        cascade_prompt_detachment(&conn, &AttachScope::Role("rl-x".into()), "p1").unwrap();
        let still_direct: String = conn
            .query_row(
                "SELECT origin FROM task_prompts WHERE task_id = ?1 AND prompt_id = 'p1'",
                params![task.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(still_direct, "direct");
    }

    #[test]
    fn cascade_board_attachment_hits_every_task_in_board() {
        let (conn, bd, col) = fresh_db_with_board();
        seed_prompt(&conn, "pp");
        for _ in 0..3 {
            insert(&conn, &draft(&bd, &col)).unwrap();
        }
        let n =
            cascade_prompt_attachment(&conn, &AttachScope::Board(bd.clone()), "pp", 0.0).unwrap();
        assert_eq!(n, 3);
        // All three rows tagged board:<id>.
        let rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_prompts WHERE prompt_id = 'pp' AND origin = ?1",
                params![format!("board:{bd}")],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rows, 3);
    }

    #[test]
    fn cascade_column_attachment_hits_only_column_tasks() {
        let (conn, bd, col) = fresh_db_with_board();
        // Add a second column with a task on it.
        conn.execute(
            "INSERT INTO columns (id, board_id, name, position, created_at) \
             VALUES ('c2', ?1, 'Done', 1, 0)",
            params![bd],
        )
        .unwrap();
        seed_prompt(&conn, "pc");
        insert(&conn, &draft(&bd, &col)).unwrap();
        insert(
            &conn,
            &TaskDraft {
                column_id: "c2".into(),
                ..draft(&bd, &col)
            },
        )
        .unwrap();
        let n =
            cascade_prompt_attachment(&conn, &AttachScope::Column(col.clone()), "pc", 0.0).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn cascade_space_attachment_walks_boards_in_space() {
        let (conn, bd, col) = fresh_db_with_board();
        seed_prompt(&conn, "ps");
        insert(&conn, &draft(&bd, &col)).unwrap();
        // The fixture uses space `sp1`. Cascade by space.
        let n =
            cascade_prompt_attachment(&conn, &AttachScope::Space("sp1".into()), "ps", 0.0).unwrap();
        assert_eq!(n, 1);
        let origin: String = conn
            .query_row(
                "SELECT origin FROM task_prompts WHERE prompt_id = 'ps'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(origin, "space:sp1");
    }

    #[test]
    fn resolve_task_prompts_returns_origin_tags() {
        let (conn, bd, col) = fresh_db_with_board();
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES ('rl', 'R', '', 0, 0)",
            [],
        )
        .unwrap();
        seed_prompt(&conn, "p1");
        seed_prompt(&conn, "p2");
        seed_prompt(&conn, "p3");
        let task = insert(
            &conn,
            &TaskDraft {
                role_id: Some("rl".into()),
                ..draft(&bd, &col)
            },
        )
        .unwrap();

        // Direct, role-cascade, board-cascade — three distinct prompts.
        add_task_prompt(&conn, &task.id, "p1", 1.0).unwrap();
        cascade_prompt_attachment(&conn, &AttachScope::Role("rl".into()), "p2", 2.0).unwrap();
        cascade_prompt_attachment(&conn, &AttachScope::Board(bd.clone()), "p3", 3.0).unwrap();

        let rows = resolve_task_prompts(&conn, &task.id).unwrap();
        let mut origins: Vec<String> = rows.iter().map(|r| r.origin_raw.clone()).collect();
        origins.sort();
        assert_eq!(
            origins,
            vec![
                format!("board:{bd}"),
                "direct".to_owned(),
                "role:rl".to_owned(),
            ]
        );
    }

    #[test]
    fn resolve_active_role_prefers_task_then_column_then_board() {
        let (conn, bd, col) = fresh_db_with_board();
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) VALUES \
                ('r-task','RT','',0,0), ('r-col','RC','',0,0), ('r-board','RB','',0,0)",
            [],
        )
        .unwrap();

        // Stamp the column and board with their own role, but no task role yet.
        conn.execute(
            "UPDATE columns SET role_id = 'r-col' WHERE id = ?1",
            params![col],
        )
        .unwrap();
        conn.execute(
            "UPDATE boards SET role_id = 'r-board' WHERE id = ?1",
            params![bd],
        )
        .unwrap();

        // Task without role → fallback to column's role.
        let task = insert(&conn, &draft(&bd, &col)).unwrap();
        let role = resolve_active_role(&conn, &task.id).unwrap().unwrap();
        assert_eq!(role.id, "r-col");

        // Stamp task with its own role → wins.
        conn.execute(
            "UPDATE tasks SET role_id = 'r-task' WHERE id = ?1",
            params![task.id],
        )
        .unwrap();
        let role = resolve_active_role(&conn, &task.id).unwrap().unwrap();
        assert_eq!(role.id, "r-task");

        // Clear column too → board fallback.
        conn.execute(
            "UPDATE columns SET role_id = NULL WHERE id = ?1",
            params![col],
        )
        .unwrap();
        conn.execute(
            "UPDATE tasks SET role_id = NULL WHERE id = ?1",
            params![task.id],
        )
        .unwrap();
        let role = resolve_active_role(&conn, &task.id).unwrap().unwrap();
        assert_eq!(role.id, "r-board");

        // Clear all → None.
        conn.execute(
            "UPDATE boards SET role_id = NULL WHERE id = ?1",
            params![bd],
        )
        .unwrap();
        assert!(resolve_active_role(&conn, &task.id).unwrap().is_none());
    }
}
