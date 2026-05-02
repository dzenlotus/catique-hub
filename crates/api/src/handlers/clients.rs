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
use catique_domain::{ClientInstructions, ConnectedClient, RoleSyncReport, SyncedRoleFile};
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
    events::emit(
        &state,
        events::CLIENT_DISCOVERED,
        json!({ "clients": clients }),
    );
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

/// IPC: read the global instructions file for a client.
///
/// Returns empty content with `exists = false` when the file does not
/// exist on disk — absence is not an error.
///
/// # Errors
///
/// - `AppError::NotFound` when `client_id` is not a known adapter.
/// - `AppError::TransactionRolledBack` for I/O failures.
#[tauri::command]
pub async fn read_client_instructions(
    _state: State<'_, AppState>,
    client_id: String,
) -> Result<ClientInstructions, AppError> {
    ClientsUseCase::new().read_instructions(&client_id)
}

/// IPC: write (overwrite) the global instructions file for a client.
///
/// Uses an atomic `.tmp`-then-rename strategy. Creates missing parent
/// directories. Emits `client:instructions_changed` with `{ client_id }`
/// on success.
///
/// Returns the fresh `ClientInstructions` snapshot.
///
/// # Errors
///
/// - `AppError::NotFound` when `client_id` is not a known adapter.
/// - `AppError::TransactionRolledBack` for I/O failures.
#[tauri::command]
pub async fn write_client_instructions(
    state: State<'_, AppState>,
    client_id: String,
    content: String,
) -> Result<ClientInstructions, AppError> {
    let instructions = ClientsUseCase::new().write_instructions(&client_id, &content)?;
    events::emit(
        &state,
        events::CLIENT_INSTRUCTIONS_CHANGED,
        json!({ "clientId": client_id }),
    );
    Ok(instructions)
}

/// IPC: list synced role files for a client (ctq-69).
///
/// Returns every file in the client's `agents_dir` that is marked as
/// Catique-managed (`catique-` prefix + `managed-by: catique-hub`
/// frontmatter). Returns an empty array when the directory doesn't exist
/// yet or the client doesn't support sync.
///
/// # Errors
///
/// - `AppError::NotFound` when `client_id` is not a known adapter.
/// - `AppError::Validation` when the client doesn't support role sync.
/// - `AppError::TransactionRolledBack` for I/O failures.
#[tauri::command]
pub async fn list_synced_client_roles(
    _state: State<'_, AppState>,
    client_id: String,
) -> Result<Vec<SyncedRoleFile>, AppError> {
    ClientsUseCase::new().list_synced_roles(&client_id)
}

/// IPC: one-way sync of all Catique Hub roles to a client's agent
/// directory (ctq-69).
///
/// Creates, updates, and deletes managed role files. Leaves
/// user-authored files untouched. Emits `client:roles_synced` with the
/// full `RoleSyncReport` on success.
///
/// # Errors
///
/// - `AppError::NotFound` — unknown `client_id`.
/// - `AppError::Validation` — client doesn't support role sync.
/// - `AppError::TransactionRolledBack` — I/O or DB failures.
#[tauri::command]
pub async fn sync_roles_to_client(
    state: State<'_, AppState>,
    client_id: String,
) -> Result<RoleSyncReport, AppError> {
    let report = ClientsUseCase::new()
        .with_pool(state.pool.clone())
        .sync_roles_to_client(client_id)?;
    events::emit(&state, events::CLIENT_ROLES_SYNCED, json!(report));
    Ok(report)
}
