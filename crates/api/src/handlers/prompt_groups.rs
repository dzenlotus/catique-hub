//! `prompt_groups` domain handlers.
//!
//! Nine IPC commands: five-command CRUD on `prompt_groups` plus four
//! member-management commands (`list_members`, `add_member`,
//! `remove_member`, `set_members`).

use catique_application::{prompt_groups::PromptGroupsUseCase, AppError};
use catique_domain::PromptGroup;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// IPC: list every prompt group.
///
/// # Errors
///
/// Forwards every error from `PromptGroupsUseCase::list`.
#[tauri::command]
pub async fn list_prompt_groups(state: State<'_, AppState>) -> Result<Vec<PromptGroup>, AppError> {
    PromptGroupsUseCase::new(&state.pool).list()
}

/// IPC: look up a prompt group by id.
///
/// # Errors
///
/// Forwards every error from `PromptGroupsUseCase::get`.
#[tauri::command]
pub async fn get_prompt_group(
    state: State<'_, AppState>,
    id: String,
) -> Result<PromptGroup, AppError> {
    PromptGroupsUseCase::new(&state.pool).get(&id)
}

/// IPC: create a prompt group.
///
/// # Errors
///
/// Forwards every error from `PromptGroupsUseCase::create`.
#[tauri::command]
pub async fn create_prompt_group(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
    icon: Option<String>,
    position: Option<i64>,
) -> Result<PromptGroup, AppError> {
    let group = PromptGroupsUseCase::new(&state.pool).create(name, color, icon, position)?;
    events::emit(
        &state,
        events::PROMPT_GROUP_CREATED,
        json!({ "id": group.id }),
    );
    Ok(group)
}

/// IPC: partial-update a prompt group.
///
/// # Errors
///
/// Forwards every error from `PromptGroupsUseCase::update`.
#[tauri::command]
pub async fn update_prompt_group(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    color: Option<Option<String>>,
    icon: Option<Option<String>>,
    position: Option<i64>,
) -> Result<PromptGroup, AppError> {
    let group =
        PromptGroupsUseCase::new(&state.pool).update(id, name, color, icon, position)?;
    events::emit(
        &state,
        events::PROMPT_GROUP_UPDATED,
        json!({ "id": group.id }),
    );
    Ok(group)
}

/// IPC: delete a prompt group.
///
/// # Errors
///
/// Forwards every error from `PromptGroupsUseCase::delete`.
#[tauri::command]
pub async fn delete_prompt_group(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    PromptGroupsUseCase::new(&state.pool).delete(&id)?;
    events::emit(&state, events::PROMPT_GROUP_DELETED, json!({ "id": id }));
    Ok(())
}

// -------------------------------------------------------------------------
// Member management
// -------------------------------------------------------------------------

/// IPC: list ordered prompt ids for a group.
///
/// # Errors
///
/// Forwards every error from `PromptGroupsUseCase::list_members`.
#[tauri::command]
pub async fn list_prompt_group_members(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<Vec<String>, AppError> {
    PromptGroupsUseCase::new(&state.pool).list_members(&group_id)
}

/// IPC: add a prompt to a group.
///
/// # Errors
///
/// Forwards every error from `PromptGroupsUseCase::add_member`.
#[tauri::command]
pub async fn add_prompt_group_member(
    state: State<'_, AppState>,
    group_id: String,
    prompt_id: String,
    position: i64,
) -> Result<(), AppError> {
    PromptGroupsUseCase::new(&state.pool).add_member(group_id.clone(), prompt_id, position)?;
    events::emit(
        &state,
        events::PROMPT_GROUP_MEMBERS_CHANGED,
        json!({ "group_id": group_id }),
    );
    Ok(())
}

/// IPC: remove a prompt from a group.
///
/// # Errors
///
/// Forwards every error from `PromptGroupsUseCase::remove_member`.
#[tauri::command]
pub async fn remove_prompt_group_member(
    state: State<'_, AppState>,
    group_id: String,
    prompt_id: String,
) -> Result<(), AppError> {
    PromptGroupsUseCase::new(&state.pool).remove_member(group_id.clone(), prompt_id)?;
    events::emit(
        &state,
        events::PROMPT_GROUP_MEMBERS_CHANGED,
        json!({ "group_id": group_id }),
    );
    Ok(())
}

/// IPC: atomically replace the full ordered member list for a group.
///
/// # Errors
///
/// Forwards every error from `PromptGroupsUseCase::set_members`.
#[tauri::command]
pub async fn set_prompt_group_members(
    state: State<'_, AppState>,
    group_id: String,
    ordered_prompt_ids: Vec<String>,
) -> Result<(), AppError> {
    PromptGroupsUseCase::new(&state.pool).set_members(group_id.clone(), ordered_prompt_ids)?;
    events::emit(
        &state,
        events::PROMPT_GROUP_MEMBERS_CHANGED,
        json!({ "group_id": group_id }),
    );
    Ok(())
}
