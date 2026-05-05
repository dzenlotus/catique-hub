//! `mcp_servers` domain handlers (ctq-115).
//!
//! ADR-0007 registry-only mode. Six commands: list/get/create/update/
//! delete + `get_mcp_server_connection_hint`. The hint command is the
//! IPC twin of the future MCP surface tool by the same name (ctq-126);
//! it returns the metadata the calling agent needs to establish its
//! own session, including the auth-reference JSON — never a resolved
//! secret value.

use catique_application::{
    mcp_servers::{ConnectionHint, McpServersUseCase},
    AppError,
};
use catique_domain::{McpServer, Transport};
use serde::Serialize;
use serde_json::json;
use tauri::State;
use ts_rs::TS;

use crate::state::AppState;

/// IPC payload returned by `get_mcp_server_connection_hint`.
///
/// Distinct from [`McpServer`] because the hint hides bookkeeping
/// fields (`enabled`, timestamps) and renames `auth_json` to
/// `authRefJson` to make it obvious to frontend and downstream agents
/// that the value is a *reference*, not a resolved secret.
#[derive(TS, Serialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct McpServerConnectionHint {
    pub id: String,
    pub name: String,
    pub transport: Transport,
    pub url: Option<String>,
    pub command: Option<String>,
    pub auth_ref_json: Option<String>,
}

impl From<ConnectionHint> for McpServerConnectionHint {
    fn from(h: ConnectionHint) -> Self {
        Self {
            id: h.id,
            name: h.name,
            transport: h.transport,
            url: h.url,
            command: h.command,
            auth_ref_json: h.auth_ref_json,
        }
    }
}

/// IPC: list every registered MCP server.
///
/// # Errors
///
/// Forwards every error from `McpServersUseCase::list`.
#[tauri::command]
pub async fn list_mcp_servers(state: State<'_, AppState>) -> Result<Vec<McpServer>, AppError> {
    McpServersUseCase::new(&state.pool).list()
}

/// IPC: look up an MCP server by id.
///
/// # Errors
///
/// Forwards every error from `McpServersUseCase::get`.
#[tauri::command]
pub async fn get_mcp_server(
    state: State<'_, AppState>,
    id: String,
) -> Result<McpServer, AppError> {
    McpServersUseCase::new(&state.pool).get(&id)
}

/// IPC: create an MCP server. ADR-0007 invariants are validated in the
/// use-case layer (transport/url/command split, auth-reference shape).
///
/// # Errors
///
/// Forwards every error from `McpServersUseCase::create`.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_mcp_server(
    state: State<'_, AppState>,
    name: String,
    transport: Transport,
    url: Option<String>,
    command: Option<String>,
    auth_json: Option<String>,
    enabled: bool,
) -> Result<McpServer, AppError> {
    let server = McpServersUseCase::new(&state.pool).create(
        name, transport, url, command, auth_json, enabled,
    )?;
    crate::events::emit(
        &state,
        MCP_SERVER_CREATED,
        json!({ "id": server.id }),
    );
    Ok(server)
}

/// IPC: partial-update an MCP server.
///
/// # Errors
///
/// Forwards every error from `McpServersUseCase::update`.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn update_mcp_server(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    transport: Option<Transport>,
    url: Option<Option<String>>,
    command: Option<Option<String>>,
    auth_json: Option<Option<String>>,
    enabled: Option<bool>,
) -> Result<McpServer, AppError> {
    let server = McpServersUseCase::new(&state.pool).update(
        id, name, transport, url, command, auth_json, enabled,
    )?;
    crate::events::emit(
        &state,
        MCP_SERVER_UPDATED,
        json!({ "id": server.id }),
    );
    Ok(server)
}

/// IPC: delete an MCP server. Cascades through `mcp_server_tools`.
///
/// # Errors
///
/// Forwards every error from `McpServersUseCase::delete`.
#[tauri::command]
pub async fn delete_mcp_server(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    McpServersUseCase::new(&state.pool).delete(&id)?;
    crate::events::emit(&state, MCP_SERVER_DELETED, json!({ "id": id }));
    Ok(())
}

/// IPC: build a connection hint for a server. The MCP surface tool
/// `get_mcp_server_connection_hint` (ctq-126) wraps this directly.
///
/// The returned `auth_ref_json` is the *reference* JSON stored at write
/// time — keychain entry name or env-var name — never a resolved
/// secret value.
///
/// # Errors
///
/// `AppError::NotFound` if the id is unknown.
#[tauri::command]
pub async fn get_mcp_server_connection_hint(
    state: State<'_, AppState>,
    id: String,
) -> Result<McpServerConnectionHint, AppError> {
    let hint = McpServersUseCase::new(&state.pool).get_connection_hint(&id)?;
    Ok(hint.into())
}

// ---------------------------------------------------------------------
// Event-name constants. Local to this handler module — the existing
// `crate::events` module does not yet export `mcp_server:*` constants
// because the registry was not part of the original taxonomy.
// ---------------------------------------------------------------------

/// `mcp_server:created` — payload `{ id }`.
pub const MCP_SERVER_CREATED: &str = "mcp_server:created";
/// `mcp_server:updated` — payload `{ id }`.
pub const MCP_SERVER_UPDATED: &str = "mcp_server:updated";
/// `mcp_server:deleted` — payload `{ id }`.
pub const MCP_SERVER_DELETED: &str = "mcp_server:deleted";
