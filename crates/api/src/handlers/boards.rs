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
/// `is_default` is exposed for symmetry with the IPC contract but the
/// only legitimate caller that flips it is `create_space`, which runs
/// in-process. Auto-defaults to `false` so a frontend that omits the
/// argument never accidentally minted an undeletable board.
///
/// # Errors
///
/// Forwards every error from `BoardsUseCase::create`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_board(
    state: State<'_, AppState>,
    name: String,
    space_id: String,
    description: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    is_default: Option<bool>,
) -> Result<Board, AppError> {
    let board = BoardsUseCase::new(&state.pool).create(CreateBoardArgs {
        name,
        space_id,
        description,
        color,
        icon,
        is_default: is_default.unwrap_or(false),
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

/// IPC: atomically replace the full ordered prompt list for a board.
/// ctq-108 / audit F-08 — bulk setter for MCP agents that prefer to
/// publish the desired-state list rather than diffing add/remove
/// pairs. Mirrors `set_space_prompts` (ctq-99).
///
/// MCP description: "Replace every prompt currently attached to
/// `board_id` with `prompt_ids` (in order). Pass an empty list to
/// clear the attachment set. Atomic — partial failures roll back."
///
/// # Errors
///
/// Forwards every error from `BoardsUseCase::set_board_prompts`.
#[tauri::command]
pub async fn set_board_prompts(
    state: State<'_, AppState>,
    board_id: String,
    prompt_ids: Vec<String>,
) -> Result<(), AppError> {
    BoardsUseCase::new(&state.pool).set_board_prompts(board_id.clone(), prompt_ids)?;
    events::emit(&state, events::BOARD_UPDATED, json!({ "id": board_id }));
    Ok(())
}

/// IPC: reassign a board's owning cat (Maintainer-style role).
///
/// Cat-as-Agent Phase 1 (ctq-88 / ctq-101, audit F-07): the underlying
/// `BoardsUseCase::set_board_owner` rejects `dirizher-system` up-front
/// (Dirizher coordinates Cats; it never owns work). The handler is a
/// thin wrapper that forwards typed errors and emits `board:updated`
/// on success so listeners refetch without an extra round-trip.
///
/// # Errors
///
/// Forwards every error from `BoardsUseCase::set_board_owner`:
///
/// * `AppError::BadRequest` — `role_id == "dirizher-system"`.
/// * `AppError::NotFound` — board id unknown.
/// * `AppError::TransactionRolledBack` — role id does not exist (FK
///   violation surfaces from the repository).
#[tauri::command]
pub async fn set_board_owner(
    state: State<'_, AppState>,
    board_id: String,
    role_id: String,
) -> Result<Board, AppError> {
    let board = BoardsUseCase::new(&state.pool).set_board_owner(&board_id, &role_id)?;
    events::emit(&state, events::BOARD_UPDATED, json!({ "id": board.id }));
    Ok(board)
}

/// IPC: replace the full skill list for a board (ctq-120).
///
/// Atomic: pass the desired final list, the use case clears + reinserts
/// inside one transaction. Empty `skill_ids` clears the attachment set.
/// Emits `board:updated` so listeners refetch the affected card.
///
/// # Errors
///
/// Forwards every error from `BoardsUseCase::set_skills`. FK violations
/// on a missing skill id surface as `AppError::TransactionRolledBack`
/// after the rollback.
#[tauri::command]
pub async fn set_board_skills(
    state: State<'_, AppState>,
    board_id: String,
    skill_ids: Vec<String>,
) -> Result<(), AppError> {
    BoardsUseCase::new(&state.pool).set_skills(&board_id, &skill_ids)?;
    events::emit(&state, events::BOARD_UPDATED, json!({ "id": board_id }));
    Ok(())
}

/// IPC: replace the full MCP-tool list for a board (ctq-120).
///
/// # Errors
///
/// Forwards every error from `BoardsUseCase::set_mcp_tools`.
#[tauri::command]
pub async fn set_board_mcp_tools(
    state: State<'_, AppState>,
    board_id: String,
    mcp_tool_ids: Vec<String>,
) -> Result<(), AppError> {
    BoardsUseCase::new(&state.pool).set_mcp_tools(&board_id, &mcp_tool_ids)?;
    events::emit(&state, events::BOARD_UPDATED, json!({ "id": board_id }));
    Ok(())
}
