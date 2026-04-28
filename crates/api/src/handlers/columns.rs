//! `columns` domain handlers.
//!
//! Wave-E2.4 (Olga). Five-command CRUD per the per-entity contract.

use catique_application::{columns::ColumnsUseCase, AppError};
use catique_domain::Column;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// E2 will populate per-domain initialisation here.
pub fn register() {}

/// IPC: list every column.
///
/// # Errors
///
/// Forwards every error from `ColumnsUseCase::list`.
#[tauri::command]
pub async fn list_columns(state: State<'_, AppState>) -> Result<Vec<Column>, AppError> {
    ColumnsUseCase::new(&state.pool).list()
}

/// IPC: look up a column by id.
///
/// # Errors
///
/// Forwards every error from `ColumnsUseCase::get`.
#[tauri::command]
pub async fn get_column(state: State<'_, AppState>, id: String) -> Result<Column, AppError> {
    ColumnsUseCase::new(&state.pool).get(&id)
}

/// IPC: create a column on `board_id`.
///
/// # Errors
///
/// Forwards every error from `ColumnsUseCase::create`.
#[tauri::command]
pub async fn create_column(
    state: State<'_, AppState>,
    board_id: String,
    name: String,
    position: i64,
) -> Result<Column, AppError> {
    let column = ColumnsUseCase::new(&state.pool).create(board_id, name, position)?;
    events::emit(
        &state,
        events::COLUMN_CREATED,
        json!({ "id": column.id, "board_id": column.board_id }),
    );
    Ok(column)
}

/// IPC: partial-update a column.
///
/// # Errors
///
/// Forwards every error from `ColumnsUseCase::update`.
#[tauri::command]
pub async fn update_column(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    position: Option<i64>,
    role_id: Option<Option<String>>,
) -> Result<Column, AppError> {
    let column = ColumnsUseCase::new(&state.pool).update(id, name, position, role_id)?;
    events::emit(
        &state,
        events::COLUMN_UPDATED,
        json!({ "id": column.id, "board_id": column.board_id }),
    );
    Ok(column)
}

/// IPC: delete a column.
///
/// # Errors
///
/// Forwards every error from `ColumnsUseCase::delete`.
#[tauri::command]
pub async fn delete_column(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    // Fetch first so we can include `board_id` in the event payload —
    // the frontend needs it to invalidate the right
    // `columns.list(boardId)` cache key. If the get succeeds and the
    // delete then fails we leak a SELECT but no state mutation, which
    // is acceptable.
    let uc = ColumnsUseCase::new(&state.pool);
    let column = uc.get(&id)?;
    uc.delete(&id)?;
    events::emit(
        &state,
        events::COLUMN_DELETED,
        json!({ "id": id, "board_id": column.board_id }),
    );
    Ok(())
}
