//! `columns` domain handlers.
//!
//! Wave-E2.4 (Olga). Five-command CRUD per the per-entity contract.

use catique_application::{columns::ColumnsUseCase, AppError};
use catique_domain::Column;
use tauri::State;

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
    ColumnsUseCase::new(&state.pool).create(board_id, name, position)
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
    ColumnsUseCase::new(&state.pool).update(id, name, position, role_id)
}

/// IPC: delete a column.
///
/// # Errors
///
/// Forwards every error from `ColumnsUseCase::delete`.
#[tauri::command]
pub async fn delete_column(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    ColumnsUseCase::new(&state.pool).delete(&id)
}
