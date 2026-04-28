//! `mcp_tools` domain handlers.
//!
//! Wave-E2.x (Round 6 back-fill). Five-command CRUD.

use catique_application::{mcp_tools::McpToolsUseCase, AppError};
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
