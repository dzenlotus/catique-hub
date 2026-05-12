//! Round-21 Connected Providers IPC handlers.
//!
//! New surface (frontend already adopting these names):
//!
//! - `list_supported_providers()` — static metadata for every provider
//!   in `catique_clients::all_providers()`.
//! - `list_connected_providers()` — every row in `connected_clients`.
//! - `add_provider(id)` — instantiate the provider, write a row, run
//!   the initial sync. Errors as `AppError::NotFound` if id is unknown.
//! - `remove_provider(id)` — call `provider.remove()`, delete the row.
//!   Idempotent.
//! - `get_sync_status()` — fan-out sync state across every connected
//!   provider.
//!
//! Retired (round-21 brief): `discover_clients`, `set_client_enabled`,
//! `read_client_instructions`, `write_client_instructions`,
//! `sync_roles_to_client`, `list_synced_client_roles`. The
//! `client_instructions` feature is gone end-to-end (no DB column ever
//! existed; the on-disk file write path is gone too).

use catique_application::{
    clients::ConnectedProvidersUseCase,
    connected_providers::{OrchestratorHandle, SyncTrigger},
    AppError,
};
use catique_domain::{ConnectedClient, SupportedProvider, SyncStatus};
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// IPC: static metadata for every provider Catique HUB can connect to.
///
/// # Errors
///
/// Infallible on the backend; the `Result` shape mirrors every other
/// IPC for symmetry.
#[tauri::command]
pub async fn list_supported_providers(
    state: State<'_, AppState>,
) -> Result<Vec<SupportedProvider>, AppError> {
    Ok(ConnectedProvidersUseCase::new(&state.pool).list_supported())
}

/// IPC: list every connected provider row.
///
/// # Errors
///
/// Forwards storage-layer errors.
#[tauri::command]
pub async fn list_connected_providers(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectedClient>, AppError> {
    ConnectedProvidersUseCase::new(&state.pool).list_providers()
}

/// IPC: add a provider by id. Inserts a row + runs the initial sync.
///
/// # Errors
///
/// - `AppError::NotFound` — `id` is not in `all_providers()`.
/// - `AppError::Conflict` — provider was already added.
/// - `AppError::TransactionRolledBack` — initial sync failed.
#[tauri::command]
pub async fn add_provider(
    state: State<'_, AppState>,
    id: String,
) -> Result<ConnectedClient, AppError> {
    let bundle = catique_application::connected_providers::build_bundle_for_test(&state.pool)?;
    let row = ConnectedProvidersUseCase::new(&state.pool)
        .add_provider(&id, &bundle)
        .await?;
    if let Some(orch) = state.orchestrator.get() {
        orch.trigger(SyncTrigger::ProviderAdded);
    }
    events::emit(
        &state,
        events::CONNECTED_PROVIDER_ADDED,
        json!({ "id": id }),
    );
    Ok(row)
}

/// IPC: remove a provider by id. Deletes catique-managed files +
/// strips the catique MCP slot, then drops the DB row. Idempotent.
///
/// # Errors
///
/// - `AppError::NotFound` — `id` is not in `all_providers()`.
/// - `AppError::TransactionRolledBack` — provider remove failed.
#[tauri::command]
pub async fn remove_provider(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    ConnectedProvidersUseCase::new(&state.pool)
        .remove_provider(&id)
        .await?;
    events::emit(
        &state,
        events::CONNECTED_PROVIDER_REMOVED,
        json!({ "id": id }),
    );
    Ok(())
}

/// IPC: fan-out sync state across every connected provider.
///
/// # Errors
///
/// Infallible — the orchestrator's `watch` channel always carries a
/// snapshot. Returns `Idle` before the orchestrator has spawned.
#[tauri::command]
pub async fn get_sync_status(state: State<'_, AppState>) -> Result<SyncStatus, AppError> {
    Ok(state
        .orchestrator
        .get()
        .map(OrchestratorHandle::snapshot_status)
        .unwrap_or_default())
}
