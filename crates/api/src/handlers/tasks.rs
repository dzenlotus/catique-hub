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
pub async fn create_task(
    state: State<'_, AppState>,
    board_id: String,
    column_id: String,
    title: String,
    description: Option<String>,
    position: f64,
    role_id: Option<String>,
) -> Result<Task, AppError> {
    let task = TasksUseCase::new(&state.pool).create(
        board_id,
        column_id,
        title,
        description,
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
pub async fn update_task(
    state: State<'_, AppState>,
    id: String,
    title: Option<String>,
    description: Option<Option<String>>,
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
    let after = uc.update(id, title, description, column_id, position, role_id)?;
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
    .map_err(map_db)
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
