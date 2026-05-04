//! `prompts` domain handlers.
//!
//! Wave-E2.4 (Olga). Five-command CRUD plus join-table helpers
//! (`add_board_prompt` / `remove_board_prompt`,
//! `add_column_prompt` / `remove_column_prompt`). The 6-source
//! resolver itself is deferred to E3.

use catique_application::{prompts::PromptsUseCase, AppError};
use catique_domain::Prompt;
use catique_infrastructure::db::{pool::acquire, repositories::prompts as repo};
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// E2 will populate per-domain initialisation here.
pub fn register() {}

/// IPC: list every prompt.
///
/// # Errors
///
/// Forwards every error from `PromptsUseCase::list`.
#[tauri::command]
pub async fn list_prompts(state: State<'_, AppState>) -> Result<Vec<Prompt>, AppError> {
    PromptsUseCase::new(&state.pool).list()
}

/// IPC: look up a prompt by id.
///
/// # Errors
///
/// Forwards every error from `PromptsUseCase::get`.
#[tauri::command]
pub async fn get_prompt(state: State<'_, AppState>, id: String) -> Result<Prompt, AppError> {
    PromptsUseCase::new(&state.pool).get(&id)
}

/// IPC: create a prompt.
///
/// # Errors
///
/// Forwards every error from `PromptsUseCase::create`.
#[tauri::command]
pub async fn create_prompt(
    state: State<'_, AppState>,
    name: String,
    content: String,
    color: Option<String>,
    short_description: Option<String>,
    icon: Option<String>,
) -> Result<Prompt, AppError> {
    let prompt =
        PromptsUseCase::new(&state.pool).create(name, content, color, short_description, icon)?;
    events::emit(&state, events::PROMPT_CREATED, json!({ "id": prompt.id }));
    Ok(prompt)
}

/// IPC: partial-update a prompt.
///
/// # Errors
///
/// Forwards every error from `PromptsUseCase::update`.
#[tauri::command]
pub async fn update_prompt(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    content: Option<String>,
    color: Option<Option<String>>,
    short_description: Option<Option<String>>,
    icon: Option<Option<String>>,
) -> Result<Prompt, AppError> {
    let prompt = PromptsUseCase::new(&state.pool).update(
        id,
        name,
        content,
        color,
        short_description,
        icon,
    )?;
    events::emit(&state, events::PROMPT_UPDATED, json!({ "id": prompt.id }));
    Ok(prompt)
}

/// IPC: delete a prompt.
///
/// # Errors
///
/// Forwards every error from `PromptsUseCase::delete`.
#[tauri::command]
pub async fn delete_prompt(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    PromptsUseCase::new(&state.pool).delete(&id)?;
    events::emit(&state, events::PROMPT_DELETED, json!({ "id": id }));
    Ok(())
}

/// IPC: recompute the token count for a prompt using the coarse
/// `(chars + 3) / 4` heuristic, persist the result, and return the
/// updated `Prompt`.
///
/// Emits `prompt.updated` on success so every listener invalidates its
/// cache without a manual refetch.
///
/// # Errors
///
/// `AppError::NotFound` if `id` is unknown; forwards any storage error.
#[tauri::command]
pub async fn recompute_prompt_token_count(
    state: State<'_, AppState>,
    id: String,
) -> Result<Prompt, AppError> {
    let prompt = PromptsUseCase::new(&state.pool).recompute_token_count(id)?;
    events::emit(&state, events::PROMPT_UPDATED, json!({ "id": prompt.id }));
    Ok(prompt)
}

// ---------------------------------------------------------------------
// Join-table helpers (board_prompts, column_prompts) — minimal
// add/remove pair per the wave-brief. No full CRUD.
// ---------------------------------------------------------------------

/// Attach a prompt to a board.
///
/// # Errors
///
/// `AppError::TransactionRolledBack` on FK violation.
#[tauri::command]
pub async fn add_board_prompt(
    state: State<'_, AppState>,
    board_id: String,
    prompt_id: String,
    position: i64,
) -> Result<(), AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    repo::add_board_prompt(&conn, &board_id, &prompt_id, position).map_err(map_db)
}

/// Detach a prompt from a board.
///
/// # Errors
///
/// `AppError::NotFound { entity: "board_prompt", … }` if no row matched.
#[tauri::command]
pub async fn remove_board_prompt(
    state: State<'_, AppState>,
    board_id: String,
    prompt_id: String,
) -> Result<(), AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    let removed = repo::remove_board_prompt(&conn, &board_id, &prompt_id).map_err(map_db)?;
    if removed {
        Ok(())
    } else {
        Err(AppError::NotFound {
            entity: "board_prompt".into(),
            id: format!("{board_id}|{prompt_id}"),
        })
    }
}

/// Attach a prompt to a column.
///
/// # Errors
///
/// `AppError::TransactionRolledBack` on FK violation.
#[tauri::command]
pub async fn add_column_prompt(
    state: State<'_, AppState>,
    column_id: String,
    prompt_id: String,
    position: i64,
) -> Result<(), AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    repo::add_column_prompt(&conn, &column_id, &prompt_id, position).map_err(map_db)
}

/// Detach a prompt from a column.
///
/// # Errors
///
/// `AppError::NotFound { entity: "column_prompt", … }` if no row matched.
#[tauri::command]
pub async fn remove_column_prompt(
    state: State<'_, AppState>,
    column_id: String,
    prompt_id: String,
) -> Result<(), AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    let removed = repo::remove_column_prompt(&conn, &column_id, &prompt_id).map_err(map_db)?;
    if removed {
        Ok(())
    } else {
        Err(AppError::NotFound {
            entity: "column_prompt".into(),
            id: format!("{column_id}|{prompt_id}"),
        })
    }
}

/// Local DbError → AppError shim. The application layer's `error_map`
/// is private; for these one-liner join-table commands we duplicate the
/// minimal mapping rather than expose it. NotFound is a non-issue here
/// because the helpers are upserts.
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
