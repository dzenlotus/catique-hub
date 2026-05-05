//! `mcp_tools` domain handlers.
//!
//! Wave-E2.x (Round 6 back-fill). Five-command CRUD plus, since
//! ctq-117 / ctq-127, four join-table helpers for the role and task
//! scopes.

use catique_application::{mcp_tools::McpToolsUseCase, tasks::TasksUseCase, AppError};
use catique_domain::McpTool;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// IPC: list every MCP tool.
///
/// # Errors
///
/// Forwards every error from `McpToolsUseCase::list`.
#[tauri::command]
pub async fn list_mcp_tools(state: State<'_, AppState>) -> Result<Vec<McpTool>, AppError> {
    McpToolsUseCase::new(&state.pool).list()
}

/// IPC: look up an MCP tool by id.
///
/// # Errors
///
/// Forwards every error from `McpToolsUseCase::get`.
#[tauri::command]
pub async fn get_mcp_tool(state: State<'_, AppState>, id: String) -> Result<McpTool, AppError> {
    McpToolsUseCase::new(&state.pool).get(&id)
}

/// IPC: create an MCP tool.
///
/// # Errors
///
/// Forwards every error from `McpToolsUseCase::create`.
#[tauri::command]
pub async fn create_mcp_tool(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
    schema_json: String,
    color: Option<String>,
    position: f64,
) -> Result<McpTool, AppError> {
    let tool = McpToolsUseCase::new(&state.pool).create(
        name,
        description,
        schema_json,
        color,
        position,
    )?;
    events::emit(&state, events::MCP_TOOL_CREATED, json!({ "id": tool.id }));
    Ok(tool)
}

/// IPC: partial-update an MCP tool.
///
/// # Errors
///
/// Forwards every error from `McpToolsUseCase::update`.
#[tauri::command]
pub async fn update_mcp_tool(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    schema_json: Option<String>,
    color: Option<Option<String>>,
    position: Option<f64>,
) -> Result<McpTool, AppError> {
    let tool = McpToolsUseCase::new(&state.pool).update(
        id,
        name,
        description,
        schema_json,
        color,
        position,
    )?;
    events::emit(&state, events::MCP_TOOL_UPDATED, json!({ "id": tool.id }));
    Ok(tool)
}

/// IPC: delete an MCP tool.
///
/// # Errors
///
/// Forwards every error from `McpToolsUseCase::delete`.
#[tauri::command]
pub async fn delete_mcp_tool(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    McpToolsUseCase::new(&state.pool).delete(&id)?;
    events::emit(&state, events::MCP_TOOL_DELETED, json!({ "id": id }));
    Ok(())
}

/// IPC: list every MCP tool attached to a role (cat). ctq-117.
///
/// # Errors
///
/// Forwards every error from `McpToolsUseCase::list_for_role`.
#[tauri::command]
pub async fn list_role_mcp_tools(
    state: State<'_, AppState>,
    role_id: String,
) -> Result<Vec<McpTool>, AppError> {
    McpToolsUseCase::new(&state.pool).list_for_role(&role_id)
}

/// IPC: list every MCP tool attached to a task. ctq-117.
///
/// # Errors
///
/// Forwards every error from `McpToolsUseCase::list_for_task`.
#[tauri::command]
pub async fn list_task_mcp_tools(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Vec<McpTool>, AppError> {
    McpToolsUseCase::new(&state.pool).list_for_task(&task_id)
}

/// IPC: attach an MCP tool to a task. Idempotent. Emits `task:updated`.
///
/// ctq-127.
///
/// # Errors
///
/// Forwards every error from `McpToolsUseCase::add_to_task`.
#[tauri::command]
pub async fn add_task_mcp_tool(
    state: State<'_, AppState>,
    task_id: String,
    mcp_tool_id: String,
    position: f64,
) -> Result<(), AppError> {
    McpToolsUseCase::new(&state.pool).add_to_task(&task_id, &mcp_tool_id, position)?;
    emit_task_updated(&state, &task_id);
    Ok(())
}

/// IPC: detach an MCP tool from a task. Idempotent.
///
/// ctq-127.
///
/// # Errors
///
/// Forwards every error from `McpToolsUseCase::remove_from_task`.
#[tauri::command]
pub async fn remove_task_mcp_tool(
    state: State<'_, AppState>,
    task_id: String,
    mcp_tool_id: String,
) -> Result<(), AppError> {
    McpToolsUseCase::new(&state.pool).remove_from_task(&task_id, &mcp_tool_id)?;
    emit_task_updated(&state, &task_id);
    Ok(())
}

/// Emit `task:updated` for `task_id` after a join-table mutation.
/// Best-effort — see [`crate::handlers::skills::add_task_skill`] for
/// the rationale.
fn emit_task_updated(state: &AppState, task_id: &str) {
    if let Ok(task) = TasksUseCase::new(&state.pool).get(task_id) {
        events::emit(
            state,
            events::TASK_UPDATED,
            json!({
                "id": task.id,
                "column_id": task.column_id,
                "board_id": task.board_id,
            }),
        );
    }
}
