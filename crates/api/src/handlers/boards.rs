//! `boards` domain handlers.
//!
//! Wave-E2.1 shipped `list` / `get` / `create`; Wave-E2.4 (Olga) adds
//! `update` and `delete` to round out the five-command contract that
//! every entity now follows. Migration
//! `008_space_board_icons_colors.sql` extends the contract with
//! optional `color` + `icon` presentation hints; both fields use the
//! `Option<Option<String>>` Tauri serde pattern on `update_board` so
//! the frontend can clear them back to NULL.

use catique_application::{
    boards::{BoardsUseCase, CreateBoardArgs, UpdateBoardArgs},
    AppError,
};
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
    description: Option<String>,
    color: Option<String>,
    icon: Option<String>,
) -> Result<Board, AppError> {
    let board = BoardsUseCase::new(&state.pool).create(CreateBoardArgs {
        name,
        space_id,
        description,
        color,
        icon,
    })?;
    events::emit(&state, events::BOARD_CREATED, json!({ "id": board.id }));
    Ok(board)
}

/// IPC: partial-update a board.
///
/// `description`, `role_id`, `color`, and `icon` are
/// `Option<Option<String>>` — `None` means "skip" (keep stored
/// value); `Some(None)` means "clear to NULL"; `Some(Some(s))` means
/// "set to `s`".
///
/// # Errors
///
/// Forwards every error from `BoardsUseCase::update`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_board(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    position: Option<f64>,
    role_id: Option<Option<String>>,
    description: Option<Option<String>>,
    color: Option<Option<String>>,
    icon: Option<Option<String>>,
) -> Result<Board, AppError> {
    let board = BoardsUseCase::new(&state.pool).update(UpdateBoardArgs {
        id,
        name,
        position,
        role_id,
        description,
        color,
        icon,
    })?;
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
