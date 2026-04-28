//! `boards` domain handlers.
//!
//! Wave-E2.1 shipped `list` / `get` / `create`; Wave-E2.4 (Olga) adds
//! `update` and `delete` to round out the five-command contract that
//! every entity now follows.

use catique_application::{boards::BoardsUseCase, AppError};
use catique_domain::Board;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// E2 will populate per-domain initialisation here.
pub fn register() {}

/// IPC: list every board, ordered by `(position, name)`.
///
/// # Errors
///
/// Forwards every error from `BoardsUseCase::list`.
#[tauri::command]
pub async fn list_boards(state: State<'_, AppState>) -> Result<Vec<Board>, AppError> {
    BoardsUseCase::new(&state.pool).list()
}

/// IPC: look up a board by id.
///
/// # Errors
///
/// Forwards every error from `BoardsUseCase::get`.
#[tauri::command]
pub async fn get_board(state: State<'_, AppState>, id: String) -> Result<Board, AppError> {
    BoardsUseCase::new(&state.pool).get(&id)
}

/// IPC: insert a new board into `space_id`.
///
/// # Errors
///
/// Forwards every error from `BoardsUseCase::create`.
#[tauri::command]
pub async fn create_board(
    state: State<'_, AppState>,
    name: String,
    space_id: String,
) -> Result<Board, AppError> {
    let board = BoardsUseCase::new(&state.pool).create(name, space_id)?;
    events::emit(&state, events::BOARD_CREATED, json!({ "id": board.id }));
    Ok(board)
}

/// IPC: partial-update a board.
///
/// # Errors
///
/// Forwards every error from `BoardsUseCase::update`.
#[tauri::command]
pub async fn update_board(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    position: Option<f64>,
    role_id: Option<Option<String>>,
) -> Result<Board, AppError> {
    let board = BoardsUseCase::new(&state.pool).update(id, name, position, role_id)?;
    events::emit(&state, events::BOARD_UPDATED, json!({ "id": board.id }));
    Ok(board)
}

/// IPC: delete a board.
///
/// # Errors
///
/// Forwards every error from `BoardsUseCase::delete`.
#[tauri::command]
pub async fn delete_board(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    BoardsUseCase::new(&state.pool).delete(&id)?;
    events::emit(&state, events::BOARD_DELETED, json!({ "id": id }));
    Ok(())
}
