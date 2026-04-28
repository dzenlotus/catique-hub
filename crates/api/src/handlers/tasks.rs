//! `tasks` domain handlers.
//!
//! Wave-E2.4 (Olga). Five-command CRUD per the per-entity contract.
//! Slug generation lives in the repository — see
//! `infrastructure::db::repositories::tasks` module docs for the
//! `<prefix>-<6char>` rationale.

use catique_application::{tasks::TasksUseCase, AppError};
use catique_domain::Task;
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
) -> Result<Task, AppError> {
    let task =
        TasksUseCase::new(&state.pool).create(board_id, column_id, title, description, position)?;
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
/// # Errors
///
/// Forwards every error from `TasksUseCase::delete`.
#[tauri::command]
pub async fn delete_task(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    // GET first to obtain `(column_id, board_id)` for the event
    // payload. Same trade-off as `delete_column`.
    let uc = TasksUseCase::new(&state.pool);
    let task = uc.get(&id)?;
    uc.delete(&id)?;
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
    catique_infrastructure::db::repositories::tasks::add_task_prompt(&conn, &task_id, &prompt_id, position)
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
