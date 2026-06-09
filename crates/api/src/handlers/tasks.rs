//! `tasks` domain handlers.
//!
//! Wave-E2.4 (Olga). Five-command CRUD per the per-entity contract.
//! Slug generation lives in the repository — see
//! `infrastructure::db::repositories::tasks` module docs for the
//! `<prefix>-<6char>` rationale.

use catique_application::{tasks::TasksUseCase, AppError};
use catique_domain::{Prompt, Task, TaskBundle, TaskRating};
use catique_infrastructure::paths::app_data_dir;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// E2 will populate per-domain initialisation here.
pub fn register() {}

/// IPC: signal that the user wants to run an agent on a task.
///
/// Stream J / v3 Wave 4. The actual agent-run executor does not ship
/// yet — this handler validates the task exists (so a stale UI
/// referencing a deleted id gets a typed `NotFound` instead of a
/// silent success), emits [`events::TASK_RUN_STARTED`] on the
/// realtime channel, and returns `Ok(())`. The frontend's
/// `EventsProvider` subscribes to the event and flips
/// `useTaskStatus(task_id)` from `"idle"` to `"running"`; the badge
/// + `RunningTaskIndicator` light up the moment the IPC returns.
///
/// A follow-up will wire the real run pipeline and emit
/// [`events::TASK_RUN_FINISHED`] / [`events::TASK_RUN_FAILED`] from
/// the executor when the agent terminates.
///
/// # Errors
///
/// `AppError::NotFound` when `task_id` does not exist; forwards every
/// other error from `TasksUseCase::get`.
#[tauri::command]
pub async fn run_task_agent(state: State<'_, AppState>, task_id: String) -> Result<(), AppError> {
    // Validate the task exists so a stale UI gets a typed NotFound
    // instead of a silent success that later confuses the run-history
    // panel. We deliberately do not lock any rows — the executor will
    // re-resolve the task bundle on its own when it lands.
    TasksUseCase::new(&state.pool).get(&task_id)?;
    events::emit_task_run_started(&state, &task_id);
    Ok(())
}

/// IPC: list every task.
///
/// # Errors
///
/// Forwards every error from `TasksUseCase::list`.
#[tauri::command]
pub async fn list_tasks(state: State<'_, AppState>) -> Result<Vec<Task>, AppError> {
    TasksUseCase::new(&state.pool).list()
}

/// IPC: look up a task by id.
///
/// # Errors
///
/// Forwards every error from `TasksUseCase::get`.
#[tauri::command]
pub async fn get_task(state: State<'_, AppState>, id: String) -> Result<Task, AppError> {
    TasksUseCase::new(&state.pool).get(&id)
}

/// IPC: create a task.
///
/// # Errors
///
/// Forwards every error from `TasksUseCase::create`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_task(
    state: State<'_, AppState>,
    board_id: String,
    column_id: String,
    title: String,
    description: Option<String>,
    kind: Option<String>,
    position: f64,
    role_id: Option<String>,
) -> Result<Task, AppError> {
    let task = TasksUseCase::new(&state.pool).create(
        board_id,
        column_id,
        title,
        description,
        kind,
        position,
        role_id,
    )?;
    events::emit(
        &state,
        events::TASK_CREATED,
        json!({
            "id": task.id,
            "column_id": task.column_id,
            "board_id": task.board_id,
        }),
    );
    Ok(task)
}

/// IPC: partial-update a task.
///
/// # Errors
///
/// Forwards every error from `TasksUseCase::update`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_task(
    state: State<'_, AppState>,
    id: String,
    title: Option<String>,
    description: Option<Option<String>>,
    kind: Option<String>,
    column_id: Option<String>,
    position: Option<f64>,
    role_id: Option<Option<String>>,
) -> Result<Task, AppError> {
    // Snapshot `column_id` before mutating so we can decide whether to
    // emit `task.moved` in addition to `task.updated`. We pick the
    // handler-side compare-and-emit strategy (option 1 of the
    // wave-brief) over threading `{ before, after }` through the use
    // case — the use case stays pure, and the extra GET is one
    // primary-key read.
    let uc = TasksUseCase::new(&state.pool);
    let before = uc.get(&id)?;
    let after = uc.update(id, title, description, kind, column_id, position, role_id)?;
    events::emit(
        &state,
        events::TASK_UPDATED,
        json!({
            "id": after.id,
            "column_id": after.column_id,
            "board_id": after.board_id,
        }),
    );
    if before.column_id != after.column_id {
        events::emit(
            &state,
            events::TASK_MOVED,
            json!({
                "id": after.id,
                "from_column_id": before.column_id,
                "to_column_id": after.column_id,
                "board_id": after.board_id,
            }),
        );
    }
    Ok(after)
}

/// IPC: move a task to a different column (and optionally reposition).
///
/// Promptery-compat shape (audit F-10 / ctq-107). Promptery's MCP tool
/// catalogue exposes `move_task(task_id, column_id, position?)` as a
/// first-class operation; agents written against that contract land
/// here without a wire-shape translation step. Catique HUB's own
/// `update_task` covers the same surface and stays available — both
/// names work.
///
/// **Cross-board moves:** when `column_id` belongs to a different
/// board than the task's current row, the use-case patches
/// `tasks.board_id` in the same connection so the row stays internally
/// consistent. The task's `role_id` and every direct `task_prompts`
/// row (`origin = 'direct'`) survive the move untouched.
///
/// Emits `task:updated` plus `task:moved` (when the column actually
/// changed) so the realtime frontend cache invalidates the same way it
/// does for `update_task`.
///
/// # Errors
///
/// * `AppError::NotFound` — `task_id` or `column_id` does not exist.
/// * Storage-layer errors as usual.
#[tauri::command]
pub async fn move_task(
    state: State<'_, AppState>,
    task_id: String,
    column_id: Option<String>,
    board_id: Option<String>,
    position: Option<f64>,
) -> Result<Task, AppError> {
    // Snapshot the pre-move task so the post-emit logic can decide
    // whether to also fire `task:moved` (column actually changed) —
    // mirrors `update_task`'s compare-and-emit shape.
    let uc = TasksUseCase::new(&state.pool);
    let before = uc.get(&task_id)?;
    // D-006: kanban drop-on-board-zone resolves to the board's
    // default column when `column_id` is omitted. Either argument
    // form is allowed; `column_id` wins when both are supplied so
    // explicit caller intent never gets silently overridden.
    let resolved_column = match (column_id, board_id) {
        (Some(c), _) => c,
        (None, Some(target_board)) => {
            // Defer to `route_task_to_board` so the default-column
            // resolution and `NotFound { entity: "default_column" }`
            // mapping stay one source of truth.
            let after = uc.route_task_to_board(task_id.clone(), target_board)?;
            events::emit(
                &state,
                events::TASK_UPDATED,
                json!({
                    "id": after.id,
                    "column_id": after.column_id,
                    "board_id": after.board_id,
                }),
            );
            if before.column_id != after.column_id {
                events::emit(
                    &state,
                    events::TASK_MOVED,
                    json!({
                        "id": after.id,
                        "from_column_id": before.column_id,
                        "to_column_id": after.column_id,
                        "board_id": after.board_id,
                    }),
                );
            }
            return Ok(after);
        }
        (None, None) => {
            return Err(AppError::Validation {
                field: "column_id".into(),
                reason: "either columnId or boardId must be supplied".into(),
            });
        }
    };
    let after = uc.move_task(task_id, resolved_column, position)?;
    events::emit(
        &state,
        events::TASK_UPDATED,
        json!({
            "id": after.id,
            "column_id": after.column_id,
            "board_id": after.board_id,
        }),
    );
    if before.column_id != after.column_id {
        events::emit(
            &state,
            events::TASK_MOVED,
            json!({
                "id": after.id,
                "from_column_id": before.column_id,
                "to_column_id": after.column_id,
                "board_id": after.board_id,
            }),
        );
    }
    Ok(after)
}

/// IPC: drop a task onto another board's default column.
///
/// D-006 (migration `016_default_board_naming_and_constraints.sql`):
/// every board owns exactly one `is_default = 1` column, so cross-board
/// kanban drag-drop can always land without the caller having to look
/// up the destination column id. This handler is a thin wrapper over
/// `TasksUseCase::route_task_to_board` — it resolves the default column
/// and forwards to `move_task` so the cross-board `board_id` patch and
/// the direct-prompt preservation contract stay in one path.
///
/// Emits `task:updated` plus `task:moved` (when the column actually
/// changed) — same shape as `move_task`.
///
/// # Errors
///
/// * `AppError::NotFound` — `task_id` or `target_board_id` is unknown,
///   or the target board has no default column (data-corruption signal).
#[tauri::command]
pub async fn route_task_to_board(
    state: State<'_, AppState>,
    task_id: String,
    target_board_id: String,
) -> Result<Task, AppError> {
    let uc = TasksUseCase::new(&state.pool);
    let before = uc.get(&task_id)?;
    let after = uc.route_task_to_board(task_id, target_board_id)?;
    events::emit(
        &state,
        events::TASK_UPDATED,
        json!({
            "id": after.id,
            "column_id": after.column_id,
            "board_id": after.board_id,
        }),
    );
    if before.column_id != after.column_id {
        events::emit(
            &state,
            events::TASK_MOVED,
            json!({
                "id": after.id,
                "from_column_id": before.column_id,
                "to_column_id": after.column_id,
                "board_id": after.board_id,
            }),
        );
    }
    Ok(after)
}

/// IPC: delete a task.
///
/// Performs the FK cascade on `task_attachments` rows AND removes the
/// per-task on-disk attachment directory under
/// `$APPLOCALDATA/catique/attachments/<task_id>/`. Both halves are
/// best-effort on the FS side: if the directory is missing or removal
/// fails, the IPC call still succeeds (warn-and-continue) — see
/// `TasksUseCase::delete_with_attachments` for the rationale.
///
/// # Errors
///
/// Forwards every error from `TasksUseCase::delete_with_attachments`.
/// `AppError::Validation` if the platform's app-data dir cannot be
/// resolved.
#[tauri::command]
pub async fn delete_task(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    // GET first to obtain `(column_id, board_id)` for the event
    // payload. Same trade-off as `delete_column`.
    let uc = TasksUseCase::new(&state.pool);
    let task = uc.get(&id)?;
    let data_root = app_data_dir().map_err(|reason| AppError::Validation {
        field: "target_data_dir".into(),
        reason: reason.to_owned(),
    })?;
    let attachments_root = data_root.join("attachments");
    uc.delete_with_attachments(&id, &attachments_root)?;
    events::emit(
        &state,
        events::TASK_DELETED,
        json!({
            "id": id,
            "column_id": task.column_id,
            "board_id": task.board_id,
        }),
    );
    Ok(())
}

// ---------------------------------------------------------------------
// Join-table helpers — task_prompts (direct attachment) +
// task_prompt_overrides (per-task suppress).
// ---------------------------------------------------------------------

/// IPC: list all prompts attached to a task, ordered by position.
///
/// # Errors
///
/// Forwards every error from `TasksUseCase::list_task_prompts`.
#[tauri::command]
pub async fn list_task_prompts(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Vec<Prompt>, AppError> {
    TasksUseCase::new(&state.pool).list_task_prompts(&task_id)
}

/// IPC: resolve the full agent bundle for one task.
///
/// Returns the task row, its active role (task > column > board
/// fallback), and the deduplicated, origin-tagged prompt list ready for
/// LLM assembly. ADR-0006 decision (D-004): the resolver reads from
/// `task_prompts` only — every materialised row is INSERTed at
/// configuration time so the hot path stays a single index seek.
///
/// # Errors
///
/// Forwards every error from `TasksUseCase::resolve_task_bundle`.
#[tauri::command]
pub async fn get_task_bundle(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<TaskBundle, AppError> {
    TasksUseCase::new(&state.pool).resolve_task_bundle(&task_id)
}

/// Attach a prompt directly to a task.
///
/// # Errors
///
/// `AppError::TransactionRolledBack` on FK violation.
#[tauri::command]
pub async fn add_task_prompt(
    state: State<'_, AppState>,
    task_id: String,
    prompt_id: String,
    position: f64,
) -> Result<(), AppError> {
    let conn = catique_infrastructure::db::pool::acquire(&state.pool).map_err(map_db)?;
    catique_infrastructure::db::repositories::tasks::add_task_prompt(
        &conn, &task_id, &prompt_id, position,
    )
    .map_err(map_db)?;
    // Refactor-v3 D-B: bump the denormalised counter so the kanban card
    // surface reflects the new attachment without re-resolving the bundle.
    catique_infrastructure::db::repositories::tasks::recompute_effective_counts(&conn, &task_id)
        .map_err(map_db)?;
    Ok(())
}

/// Detach a direct prompt from a task.
///
/// # Errors
///
/// `AppError::NotFound` if no row matched.
#[tauri::command]
pub async fn remove_task_prompt(
    state: State<'_, AppState>,
    task_id: String,
    prompt_id: String,
) -> Result<(), AppError> {
    let conn = catique_infrastructure::db::pool::acquire(&state.pool).map_err(map_db)?;
    let removed = catique_infrastructure::db::repositories::tasks::remove_task_prompt(
        &conn, &task_id, &prompt_id,
    )
    .map_err(map_db)?;
    if removed {
        // Refactor-v3 D-B counter sync.
        catique_infrastructure::db::repositories::tasks::recompute_effective_counts(
            &conn, &task_id,
        )
        .map_err(map_db)?;
        Ok(())
    } else {
        Err(AppError::NotFound {
            entity: "task_prompt".into(),
            id: format!("{task_id}|{prompt_id}"),
        })
    }
}

/// Set or replace a per-task prompt override.
///
/// # Errors
///
/// `AppError::TransactionRolledBack` on FK violation.
#[tauri::command]
pub async fn set_task_prompt_override(
    state: State<'_, AppState>,
    task_id: String,
    prompt_id: String,
    enabled: bool,
) -> Result<(), AppError> {
    let conn = catique_infrastructure::db::pool::acquire(&state.pool).map_err(map_db)?;
    catique_infrastructure::db::repositories::tasks::set_task_prompt_override(
        &conn, &task_id, &prompt_id, enabled,
    )
    .map_err(map_db)
}

/// Clear a per-task prompt override.
///
/// # Errors
///
/// `AppError::NotFound` if no override existed.
#[tauri::command]
pub async fn clear_task_prompt_override(
    state: State<'_, AppState>,
    task_id: String,
    prompt_id: String,
) -> Result<(), AppError> {
    let conn = catique_infrastructure::db::pool::acquire(&state.pool).map_err(map_db)?;
    let cleared = catique_infrastructure::db::repositories::tasks::clear_task_prompt_override(
        &conn, &task_id, &prompt_id,
    )
    .map_err(map_db)?;
    if cleared {
        Ok(())
    } else {
        Err(AppError::NotFound {
            entity: "task_prompt_override".into(),
            id: format!("{task_id}|{prompt_id}"),
        })
    }
}

// ---------------------------------------------------------------------
// Refactor-v3 D-A — replace-OR-suppress overrides (v2).
//
// Three pairs of IPCs (prompts / skills / mcp_tools), each:
//   * `set_task_<kind>_override_v2(task_id, source_id, replacement_id?)`
//     UPSERTs the override row. `replacement_id = None` suppresses the
//     inherited entity; `Some(id)` substitutes it with another entity
//     of the same kind.
//   * `clear_task_<kind>_override_v2(task_id, source_id)` removes the
//     override, restoring the inherited entry.
//
// The legacy `set_task_prompt_override(enabled: bool)` IPC stays for one
// release as a thin compat layer (decision memo §"New IPC"); migrating
// clients to the `_v2` surface is a frontend concern.
// ---------------------------------------------------------------------

/// Set a per-task prompt override (replace-OR-suppress).
///
/// # Errors
///
/// * `AppError::NotFound` — `task_id` does not exist.
/// * `AppError::TransactionRolledBack` — FK violation on source or
///   replacement prompt id.
#[tauri::command]
pub async fn set_task_prompt_override_v2(
    state: State<'_, AppState>,
    task_id: String,
    source_prompt_id: String,
    replacement_prompt_id: Option<String>,
) -> Result<(), AppError> {
    TasksUseCase::new(&state.pool).set_task_prompt_override_v2(
        &task_id,
        &source_prompt_id,
        replacement_prompt_id.as_deref(),
    )
}

/// Clear a per-task prompt override (refactor-v3 D-A).
///
/// # Errors
///
/// `AppError::NotFound` if no override existed for the
/// `(task_id, source_prompt_id)` pair.
#[tauri::command]
pub async fn clear_task_prompt_override_v2(
    state: State<'_, AppState>,
    task_id: String,
    source_prompt_id: String,
) -> Result<(), AppError> {
    TasksUseCase::new(&state.pool).clear_task_prompt_override_v2(&task_id, &source_prompt_id)
}

/// Set a per-task skill override (replace-OR-suppress).
///
/// # Errors
///
/// See [`set_task_prompt_override_v2`].
#[tauri::command]
pub async fn set_task_skill_override_v2(
    state: State<'_, AppState>,
    task_id: String,
    source_skill_id: String,
    replacement_skill_id: Option<String>,
) -> Result<(), AppError> {
    TasksUseCase::new(&state.pool).set_task_skill_override_v2(
        &task_id,
        &source_skill_id,
        replacement_skill_id.as_deref(),
    )
}

/// Clear a per-task skill override (refactor-v3 D-A).
///
/// # Errors
///
/// `AppError::NotFound` if no override existed.
#[tauri::command]
pub async fn clear_task_skill_override_v2(
    state: State<'_, AppState>,
    task_id: String,
    source_skill_id: String,
) -> Result<(), AppError> {
    TasksUseCase::new(&state.pool).clear_task_skill_override_v2(&task_id, &source_skill_id)
}

/// Set a per-task mcp-tool override (replace-OR-suppress).
///
/// # Errors
///
/// See [`set_task_prompt_override_v2`].
#[tauri::command]
pub async fn set_task_mcp_tool_override_v2(
    state: State<'_, AppState>,
    task_id: String,
    source_tool_id: String,
    replacement_tool_id: Option<String>,
) -> Result<(), AppError> {
    TasksUseCase::new(&state.pool).set_task_mcp_tool_override_v2(
        &task_id,
        &source_tool_id,
        replacement_tool_id.as_deref(),
    )
}

/// Clear a per-task mcp-tool override (refactor-v3 D-A).
///
/// # Errors
///
/// `AppError::NotFound` if no override existed.
#[tauri::command]
pub async fn clear_task_mcp_tool_override_v2(
    state: State<'_, AppState>,
    task_id: String,
    source_tool_id: String,
) -> Result<(), AppError> {
    TasksUseCase::new(&state.pool).clear_task_mcp_tool_override_v2(&task_id, &source_tool_id)
}

// ---------------------------------------------------------------------
// Cat-as-Agent Phase 1 — step log + rating IPC surface (ctq-85, ctq-86,
// ctq-95). Handlers mirror the use-case signatures one-for-one; no event
// emission yet — the audit (F-01/F-02) tracks `task:logged` /
// `task:rated` as a follow-up once the realtime taxonomy is widened.
// ---------------------------------------------------------------------

/// IPC: append one step-log line to a task. Format produced by the use
/// case is `[YYYY-MM-DDTHH:MM:SSZ] {summary}\n` — see
/// `TasksUseCase::log_step` for the full contract.
///
/// # Errors
///
/// Forwards every error from `TasksUseCase::log_step`.
#[tauri::command]
pub async fn log_step(
    state: State<'_, AppState>,
    task_id: String,
    summary: String,
) -> Result<(), AppError> {
    TasksUseCase::new(&state.pool).log_step(task_id, summary)
}

/// IPC: read the raw step-log buffer for a task. Companion to
/// `log_step`; cheaper than `get_task` when the caller only needs the
/// log text. Returns `""` for tasks that have never been logged-to;
/// `AppError::NotFound` if the task id is unknown.
///
/// # Errors
///
/// `AppError::NotFound` for missing tasks; storage-layer errors.
#[tauri::command]
pub async fn get_step_log(state: State<'_, AppState>, task_id: String) -> Result<String, AppError> {
    let conn = catique_infrastructure::db::pool::acquire(&state.pool).map_err(map_db)?;
    match catique_infrastructure::db::repositories::tasks::get_step_log(&conn, &task_id)
        .map_err(map_db)?
    {
        Some(text) => Ok(text),
        None => Err(AppError::NotFound {
            entity: "task".into(),
            id: task_id,
        }),
    }
}

/// IPC: set or clear the rating for a task. `rating = None` deletes the
/// rating value (the row stays so `rated_at` records the unrate moment);
/// `Some(-1 | 0 | 1)` upserts. Out-of-range integers and missing tasks
/// surface as typed `AppError`.
///
/// The IPC payload uses `i32` because `i8` is not a first-class JSON
/// number on the TS side; the use case re-narrows to `i8` after the
/// out-of-range guard.
///
/// # Errors
///
/// Forwards every error from `TasksUseCase::rate_task`.
#[tauri::command]
pub async fn rate_task(
    state: State<'_, AppState>,
    task_id: String,
    rating: Option<i32>,
) -> Result<(), AppError> {
    let narrowed = match rating {
        None => None,
        Some(v) => Some(i8::try_from(v).map_err(|_| AppError::Validation {
            field: "rating".into(),
            reason: "must be one of -1, 0, +1, or null".into(),
        })?),
    };
    TasksUseCase::new(&state.pool).rate_task(task_id, narrowed)
}

/// IPC: look up the rating row for a task. `Ok(None)` for tasks that
/// have never been rated; `Ok(Some(row))` with `row.rating = None` for
/// tasks that were rated and then explicitly un-rated (memo Q4 / AC-R2
/// distinction).
///
/// # Errors
///
/// Forwards every error from `TasksUseCase::get_task_rating`.
#[tauri::command]
pub async fn get_task_rating(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Option<TaskRating>, AppError> {
    TasksUseCase::new(&state.pool).get_task_rating(&task_id)
}

fn map_db(err: catique_infrastructure::db::pool::DbError) -> AppError {
    use catique_infrastructure::db::pool::DbError;
    match err {
        DbError::PoolTimeout(_) | DbError::Pool(_) => AppError::DbBusy,
        DbError::Sqlite(e) => AppError::TransactionRolledBack {
            reason: e.to_string(),
        },
        DbError::Io(e) => AppError::TransactionRolledBack {
            reason: e.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    //! Stream J / v3 Wave 4 — `run_task_agent` smoke checks.
    //!
    //! The `#[tauri::command]` attribute lowers the handler into a
    //! private wrapper so we can't call it directly from a unit test.
    //! Instead we exercise the exact two operations the handler
    //! performs: `TasksUseCase::get(id)` (the typed-NotFound gate) and
    //! `events::emit_task_run_started(&state, id)` (silent in test
    //! mode). Any future change that swaps the order or drops the
    //! validation needs to update this test, which is the contract we
    //! actually care about.
    use super::*;
    use crate::state::AppState;
    use catique_application::AppError;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_state_with_task() -> (AppState, String) {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().expect("acquire migration conn");
        run_pending(&mut conn).expect("run migrations");
        // Seed a minimal task hierarchy. The default-board invariant
        // (D-006) is enforced via the migration's INSERT triggers in
        // the real schema; here we drop straight to raw INSERTs for
        // the smallest reproducer.
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd','B','sp',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('co','bd','C',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t-real','bd','co','sp-1','Title',0,0,0);",
        )
        .expect("seed");
        drop(conn);
        let state = AppState::new(pool, std::path::PathBuf::new());
        (state, "t-real".to_owned())
    }

    /// Valid task id: the use-case `get` resolves, and the silent
    /// emit helper is a no-op in test mode — the handler-equivalent
    /// returns `Ok(())`.
    #[test]
    fn run_task_agent_path_succeeds_for_existing_task() {
        let (state, task_id) = fresh_state_with_task();
        // The handler reduces to these two operations; we exercise
        // them in the same order.
        let task = TasksUseCase::new(&state.pool)
            .get(&task_id)
            .expect("existing task resolves");
        assert_eq!(task.id, task_id);
        crate::events::emit_task_run_started(&state, &task_id);
        // No app handle attached → silent no-op contract holds.
        assert!(state.app_handle.get().is_none());
    }

    /// Missing task id: the `get` gate surfaces a typed `NotFound` and
    /// the emit step is never reached.
    #[test]
    fn run_task_agent_path_returns_not_found_for_ghost_task() {
        let (state, _) = fresh_state_with_task();
        let err = TasksUseCase::new(&state.pool)
            .get("ghost")
            .expect_err("missing task id surfaces NotFound");
        match err {
            AppError::NotFound { entity, id } => {
                assert_eq!(entity, "task");
                assert_eq!(id, "ghost");
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }
}
