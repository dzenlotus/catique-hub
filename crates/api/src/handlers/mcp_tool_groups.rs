//! `mcp_tool_groups` domain handlers — the MCP mirror of
//! `handlers::prompt_groups`. CRUD + member management + group-as-live-unit
//! attachment at role / board / task scope.

use catique_application::{mcp_tool_groups::McpToolGroupsUseCase, AppError};
use catique_domain::McpToolGroup;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// IPC: list every MCP tool group.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::list`.
#[tauri::command]
pub async fn list_mcp_tool_groups(
    state: State<'_, AppState>,
) -> Result<Vec<McpToolGroup>, AppError> {
    McpToolGroupsUseCase::new(&state.pool).list()
}

/// IPC: look up an MCP tool group by id.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::get`.
#[tauri::command]
pub async fn get_mcp_tool_group(
    state: State<'_, AppState>,
    id: String,
) -> Result<McpToolGroup, AppError> {
    McpToolGroupsUseCase::new(&state.pool).get(&id)
}

/// IPC: create an MCP tool group.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::create`.
#[tauri::command]
pub async fn create_mcp_tool_group(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
    icon: Option<String>,
    position: Option<i64>,
) -> Result<McpToolGroup, AppError> {
    let group = McpToolGroupsUseCase::new(&state.pool).create(name, color, icon, position)?;
    events::emit(
        &state,
        events::MCP_TOOL_GROUP_CREATED,
        json!({ "id": group.id }),
    );
    Ok(group)
}

/// IPC: partial-update an MCP tool group.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::update`.
#[tauri::command]
pub async fn update_mcp_tool_group(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    color: Option<Option<String>>,
    icon: Option<Option<String>>,
    position: Option<i64>,
) -> Result<McpToolGroup, AppError> {
    let group = McpToolGroupsUseCase::new(&state.pool).update(id, name, color, icon, position)?;
    events::emit(
        &state,
        events::MCP_TOOL_GROUP_UPDATED,
        json!({ "id": group.id }),
    );
    Ok(group)
}

/// IPC: delete an MCP tool group.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::delete`.
#[tauri::command]
pub async fn delete_mcp_tool_group(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    McpToolGroupsUseCase::new(&state.pool).delete(&id)?;
    events::emit(&state, events::MCP_TOOL_GROUP_DELETED, json!({ "id": id }));
    Ok(())
}

// -------------------------------------------------------------------------
// Member management
// -------------------------------------------------------------------------

/// IPC: list ordered MCP-tool ids for a group.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::list_members`.
#[tauri::command]
pub async fn list_mcp_tool_group_members(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<Vec<String>, AppError> {
    McpToolGroupsUseCase::new(&state.pool).list_members(&group_id)
}

/// IPC: add an MCP tool to a group.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::add_member`.
#[tauri::command]
pub async fn add_mcp_tool_group_member(
    state: State<'_, AppState>,
    group_id: String,
    mcp_tool_id: String,
    position: i64,
) -> Result<(), AppError> {
    McpToolGroupsUseCase::new(&state.pool).add_member(group_id.clone(), mcp_tool_id, position)?;
    events::emit(
        &state,
        events::MCP_TOOL_GROUP_MEMBERS_CHANGED,
        json!({ "group_id": group_id }),
    );
    Ok(())
}

/// IPC: remove an MCP tool from a group.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::remove_member`.
#[tauri::command]
pub async fn remove_mcp_tool_group_member(
    state: State<'_, AppState>,
    group_id: String,
    mcp_tool_id: String,
) -> Result<(), AppError> {
    McpToolGroupsUseCase::new(&state.pool).remove_member(group_id.clone(), mcp_tool_id)?;
    events::emit(
        &state,
        events::MCP_TOOL_GROUP_MEMBERS_CHANGED,
        json!({ "group_id": group_id }),
    );
    Ok(())
}

/// IPC: atomically replace the full ordered member list for a group.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::set_members`.
#[tauri::command]
pub async fn set_mcp_tool_group_members(
    state: State<'_, AppState>,
    group_id: String,
    ordered_tool_ids: Vec<String>,
) -> Result<(), AppError> {
    McpToolGroupsUseCase::new(&state.pool).set_members(group_id.clone(), ordered_tool_ids)?;
    events::emit(
        &state,
        events::MCP_TOOL_GROUP_MEMBERS_CHANGED,
        json!({ "group_id": group_id }),
    );
    Ok(())
}

// -------------------------------------------------------------------------
// Group attachment
// -------------------------------------------------------------------------

/// IPC: set the MCP-tool groups attached to a role.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::set_role_groups`.
#[tauri::command]
pub async fn set_role_mcp_tool_groups(
    state: State<'_, AppState>,
    role_id: String,
    group_ids: Vec<String>,
) -> Result<(), AppError> {
    McpToolGroupsUseCase::new(&state.pool).set_role_groups(role_id.clone(), group_ids)?;
    events::emit(&state, events::ROLE_UPDATED, json!({ "id": role_id }));
    Ok(())
}

/// IPC: list the MCP-tool groups attached to a role.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::list_role_groups`.
#[tauri::command]
pub async fn list_role_mcp_tool_groups(
    state: State<'_, AppState>,
    role_id: String,
) -> Result<Vec<String>, AppError> {
    McpToolGroupsUseCase::new(&state.pool).list_role_groups(&role_id)
}

/// IPC: set the MCP-tool groups attached to a board.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::set_board_groups`.
#[tauri::command]
pub async fn set_board_mcp_tool_groups(
    state: State<'_, AppState>,
    board_id: String,
    group_ids: Vec<String>,
) -> Result<(), AppError> {
    McpToolGroupsUseCase::new(&state.pool).set_board_groups(board_id.clone(), group_ids)?;
    events::emit(&state, events::BOARD_UPDATED, json!({ "id": board_id }));
    Ok(())
}

/// IPC: list the MCP-tool groups attached to a board.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::list_board_groups`.
#[tauri::command]
pub async fn list_board_mcp_tool_groups(
    state: State<'_, AppState>,
    board_id: String,
) -> Result<Vec<String>, AppError> {
    McpToolGroupsUseCase::new(&state.pool).list_board_groups(&board_id)
}

/// IPC: set the MCP-tool groups attached directly to a task.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::set_task_groups`.
#[tauri::command]
pub async fn set_task_mcp_tool_groups(
    state: State<'_, AppState>,
    task_id: String,
    group_ids: Vec<String>,
) -> Result<(), AppError> {
    McpToolGroupsUseCase::new(&state.pool).set_task_groups(task_id.clone(), group_ids)?;
    events::emit(&state, events::TASK_UPDATED, json!({ "id": task_id }));
    Ok(())
}

/// IPC: list the MCP-tool groups attached directly to a task.
///
/// # Errors
///
/// Forwards every error from `McpToolGroupsUseCase::list_task_groups`.
#[tauri::command]
pub async fn list_task_mcp_tool_groups(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Vec<String>, AppError> {
    McpToolGroupsUseCase::new(&state.pool).list_task_groups(&task_id)
}
