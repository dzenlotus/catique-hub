//! `boards` domain handlers.
//!
//! Wave-E2 (Olga). The IPC contract (shared with Anna's UI work):
//!
//! ```ignore
//! list_boards()                 -> Result<Vec<Board>, AppError>
//! create_board(name, space_id)  -> Result<Board, AppError>
//! get_board(id)                 -> Result<Board, AppError>
//! ```
//!
//! Each command is `async` — Tauri requires it — even though the
//! underlying use case is synchronous. We do **not** spawn the work on
//! a blocking pool yet; the desktop workload is small enough that the
//! pool-acquire timeout (500 ms) is the relevant deadline. E3 will
//! revisit if traces show the runtime stalling.

use catique_application::{boards::BoardsUseCase, AppError};
use catique_domain::Board;
use tauri::State;

use crate::state::AppState;

/// E2 will populate per-domain initialisation here.
pub fn register() {}

/// IPC: list every board, ordered by `(position, name)`.
///
/// # Errors
///
/// Forwards every error from
/// [`catique_application::boards::BoardsUseCase::list`].
#[tauri::command]
pub async fn list_boards(state: State<'_, AppState>) -> Result<Vec<Board>, AppError> {
    BoardsUseCase::new(&state.pool).list()
}

/// IPC: insert a new board into `space_id`.
///
/// # Errors
///
/// Forwards every error from
/// [`catique_application::boards::BoardsUseCase::create`] —
/// `AppError::Validation` for an empty `name`,
/// `AppError::NotFound { entity: "space", .. }` for an unknown
/// `space_id`, plus the storage-layer mapping table.
#[tauri::command]
pub async fn create_board(
    state: State<'_, AppState>,
    name: String,
    space_id: String,
) -> Result<Board, AppError> {
    BoardsUseCase::new(&state.pool).create(name, space_id)
}

/// IPC: look up a board by id.
///
/// # Errors
///
/// Forwards every error from
/// [`catique_application::boards::BoardsUseCase::get`] —
/// `AppError::NotFound { entity: "board", .. }` is the typed case,
/// plus the storage-layer mapping table.
#[tauri::command]
pub async fn get_board(state: State<'_, AppState>, id: String) -> Result<Board, AppError> {
    BoardsUseCase::new(&state.pool).get(&id)
}
