//! `spaces` domain handlers.
//!
//! Wave-E2.4 (Olga). Five-command CRUD per the per-entity contract.
//! Every handler is `async` because Tauri requires it; the underlying
//! use case is synchronous (the pool acquire timeout is the relevant
//! deadline — see `boards.rs`).

use catique_application::{spaces::SpacesUseCase, AppError};
use catique_domain::Space;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// E2 will populate per-domain initialisation here.
pub fn register() {}

/// IPC: list every space, ordered by `(position, name)`.
///
/// # Errors
///
/// Forwards every error from `SpacesUseCase::list`.
#[tauri::command]
pub async fn list_spaces(state: State<'_, AppState>) -> Result<Vec<Space>, AppError> {
    SpacesUseCase::new(&state.pool).list()
}

/// IPC: look up a space by id.
///
/// # Errors
///
/// Forwards every error from `SpacesUseCase::get`.
#[tauri::command]
pub async fn get_space(state: State<'_, AppState>, id: String) -> Result<Space, AppError> {
    SpacesUseCase::new(&state.pool).get(&id)
}

/// IPC: create a space.
///
/// # Errors
///
/// Forwards every error from `SpacesUseCase::create`.
#[tauri::command]
pub async fn create_space(
    state: State<'_, AppState>,
    name: String,
    prefix: String,
    description: Option<String>,
    is_default: bool,
) -> Result<Space, AppError> {
    let space = SpacesUseCase::new(&state.pool).create(name, prefix, description, is_default)?;
    events::emit(&state, events::SPACE_CREATED, json!({ "id": space.id }));
    Ok(space)
}

/// IPC: partial-update a space.
///
/// `description` is `Option<Option<String>>` — `None` means "skip"
/// (keep stored value); `Some(None)` means "clear to NULL".
///
/// # Errors
///
/// Forwards every error from `SpacesUseCase::update`.
#[tauri::command]
pub async fn update_space(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    is_default: Option<bool>,
    position: Option<f64>,
) -> Result<Space, AppError> {
    let space =
        SpacesUseCase::new(&state.pool).update(id, name, description, is_default, position)?;
    events::emit(&state, events::SPACE_UPDATED, json!({ "id": space.id }));
    Ok(space)
}

/// IPC: delete a space.
///
/// # Errors
///
/// Forwards every error from `SpacesUseCase::delete`.
#[tauri::command]
pub async fn delete_space(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    SpacesUseCase::new(&state.pool).delete(&id)?;
    events::emit(&state, events::SPACE_DELETED, json!({ "id": id }));
    Ok(())
}
