//! `spaces` domain handlers.
//!
//! Wave-E2.4 (Olga). Five-command CRUD per the per-entity contract.
//! Every handler is `async` because Tauri requires it; the underlying
//! use case is synchronous (the pool acquire timeout is the relevant
//! deadline — see `boards.rs`). Migration
//! `008_space_board_icons_colors.sql` adds optional `color` + `icon`
//! presentation hints; both fields use the `Option<Option<String>>`
//! Tauri serde pattern on `update_*` so the frontend can clear them
//! back to NULL.

use catique_application::{
    spaces::{CreateSpaceArgs, SpacesUseCase, UpdateSpaceArgs},
    AppError,
};
use catique_domain::{Prompt, Space};
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
#[allow(clippy::too_many_arguments)]
pub async fn create_space(
    state: State<'_, AppState>,
    name: String,
    prefix: String,
    description: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    is_default: bool,
) -> Result<Space, AppError> {
    let space = SpacesUseCase::new(&state.pool).create(CreateSpaceArgs {
        name,
        prefix,
        description,
        color,
        icon,
        is_default,
    })?;
    events::emit(&state, events::SPACE_CREATED, json!({ "id": space.id }));
    Ok(space)
}

/// IPC: partial-update a space.
///
/// `description`, `color`, and `icon` are `Option<Option<String>>` —
/// `None` means "skip" (keep the stored value); `Some(None)` means
/// "clear to NULL"; `Some(Some(s))` means "set to `s`".
///
/// # Errors
///
/// Forwards every error from `SpacesUseCase::update`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_space(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    color: Option<Option<String>>,
    icon: Option<Option<String>>,
    is_default: Option<bool>,
    position: Option<f64>,
) -> Result<Space, AppError> {
    let space = SpacesUseCase::new(&state.pool).update(UpdateSpaceArgs {
        id,
        name,
        description,
        color,
        icon,
        is_default,
        position,
    })?;
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

// -------------------------------------------------------------------------
// space_prompts join (ctq-99 / migration 011_space_prompts.sql).
//
// Fourth-level prompt-inheritance join. Mirrors the
// `add_*_prompt` / `remove_*_prompt` pair on `prompts` plus the bulk
// `set_*` setter from `prompt_groups::set_prompt_group_members`. The
// resolver itself (ctq-100) is downstream and consumes the read path
// directly. Each mutation emits `space:updated` so existing listeners
// invalidate their queries without a new event constant — keeping the
// surface small for ctq-99 and letting the resolver task add a
// dedicated `space_prompts:changed` event later if the frontend needs
// finer granularity.
// -------------------------------------------------------------------------

/// IPC: list every prompt attached to a space, ordered by
/// `space_prompts.position` ascending.
///
/// # Errors
///
/// Forwards every error from `SpacesUseCase::list_space_prompts`.
#[tauri::command]
pub async fn list_space_prompts(
    state: State<'_, AppState>,
    space_id: String,
) -> Result<Vec<Prompt>, AppError> {
    SpacesUseCase::new(&state.pool).list_space_prompts(&space_id)
}

/// IPC: attach a prompt to a space. Idempotent — calling twice with a
/// different `position` updates the position rather than failing.
///
/// # Errors
///
/// Forwards every error from `SpacesUseCase::add_space_prompt`.
#[tauri::command]
pub async fn add_space_prompt(
    state: State<'_, AppState>,
    space_id: String,
    prompt_id: String,
    position: Option<f64>,
) -> Result<(), AppError> {
    SpacesUseCase::new(&state.pool).add_space_prompt(&space_id, &prompt_id, position)?;
    events::emit(
        &state,
        events::SPACE_UPDATED,
        json!({ "id": space_id, "prompt_id": prompt_id }),
    );
    Ok(())
}

/// IPC: detach a prompt from a space.
///
/// # Errors
///
/// `AppError::NotFound { entity: "space_prompt", … }` when no row matched.
#[tauri::command]
pub async fn remove_space_prompt(
    state: State<'_, AppState>,
    space_id: String,
    prompt_id: String,
) -> Result<(), AppError> {
    SpacesUseCase::new(&state.pool).remove_space_prompt(&space_id, &prompt_id)?;
    events::emit(
        &state,
        events::SPACE_UPDATED,
        json!({ "id": space_id, "prompt_id": prompt_id }),
    );
    Ok(())
}

/// IPC: atomically replace the full ordered prompt list for a space.
///
/// # Errors
///
/// Forwards every error from `SpacesUseCase::set_space_prompts`.
#[tauri::command]
pub async fn set_space_prompts(
    state: State<'_, AppState>,
    space_id: String,
    prompt_ids: Vec<String>,
) -> Result<(), AppError> {
    SpacesUseCase::new(&state.pool).set_space_prompts(space_id.clone(), prompt_ids)?;
    events::emit(&state, events::SPACE_UPDATED, json!({ "id": space_id }));
    Ok(())
}

/// IPC: replace the full skill list for a space (ctq-120).
///
/// # Errors
///
/// Forwards every error from `SpacesUseCase::set_skills`.
#[tauri::command]
pub async fn set_space_skills(
    state: State<'_, AppState>,
    space_id: String,
    skill_ids: Vec<String>,
) -> Result<(), AppError> {
    SpacesUseCase::new(&state.pool).set_skills(&space_id, &skill_ids)?;
    events::emit(&state, events::SPACE_UPDATED, json!({ "id": space_id }));
    Ok(())
}

/// IPC: replace the full MCP-tool list for a space (ctq-120).
///
/// # Errors
///
/// Forwards every error from `SpacesUseCase::set_mcp_tools`.
#[tauri::command]
pub async fn set_space_mcp_tools(
    state: State<'_, AppState>,
    space_id: String,
    mcp_tool_ids: Vec<String>,
) -> Result<(), AppError> {
    SpacesUseCase::new(&state.pool).set_mcp_tools(&space_id, &mcp_tool_ids)?;
    events::emit(&state, events::SPACE_UPDATED, json!({ "id": space_id }));
    Ok(())
}
