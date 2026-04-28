//! Connected-clients IPC handlers (ctq-67).
//!
//! Three commands:
//! - `discover_clients`       — rescan + persist + emit `client:discovered`.
//! - `list_connected_clients` — read persisted list (no scan).
//! - `set_client_enabled`     — toggle per-client flag + emit `client:updated`.
//!
//! Startup behaviour: discovery is **NOT** triggered at app startup. The
//! user must click "Просканировать" in Settings → Connected agents, or the
//! first-launch flow may call `discover_clients` after import completes.
//! This keeps cold-start time unaffected (ADR-0003 §startup-budget).

use catique_application::{clients::ClientsUseCase, AppError};
use catique_domain::ConnectedClient;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// IPC: scan for installed agentic clients and return the updated list.
///
/// Emits `client:discovered` with `{ clients }` on success.
///
/// # Errors
///
/// Forwards registry I/O errors as `AppError::TransactionRolledBack`.
#[tauri::command]
pub async fn discover_clients(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectedClient>, AppError> {
    let clients = ClientsUseCase::new().discover()?;
    events::emit(&state, events::CLIENT_DISCOVERED, json!({ "clients": clients }));
    Ok(clients)
}

/// IPC: return the persisted client list without rescanning.
///
/// Returns an empty array on first run.
///
/// # Errors
///
/// Forwards registry I/O errors as `AppError::TransactionRolledBack`.
#[tauri::command]
pub async fn list_connected_clients(
    _state: State<'_, AppState>,
) -> Result<Vec<ConnectedClient>, AppError> {
    ClientsUseCase::new().list()
}

/// IPC: toggle the `enabled` flag for a single client.
///
/// Emits `client:updated` with `{ id }` on success.
///
/// # Errors
///
/// - `AppError::NotFound` when `id` is not in the registry.
/// - Registry I/O errors as `AppError::TransactionRolledBack`.
#[tauri::command]
pub async fn set_client_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<ConnectedClient, AppError> {
    let client = ClientsUseCase::new().set_enabled(&id, enabled)?;
    events::emit(&state, events::CLIENT_UPDATED, json!({ "id": id }));
    Ok(client)
}
