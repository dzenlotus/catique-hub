//! Round-21 Connected Providers refactor.
//!
//! `SupportedProvider` is what `list_supported_providers()` returns:
//! one row per provider in `catique_clients::all_providers()`,
//! capturing the static metadata the "Add provider" modal needs to
//! render its picker.
//!
//! `SyncStatus` is the fan-out state across every connected provider —
//! the value the `get_sync_status()` IPC reports + the `sync:status_changed`
//! event payload carries. Per-provider state lives on
//! `ConnectedClient.connection_status`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Static metadata describing one provider the app can connect to.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SupportedProvider {
    /// Stable kebab-case id (e.g. `claude-code`).
    pub id: String,
    /// Human-readable display name.
    pub display_name: String,
    /// `true` when the provider supports managed agent files.
    pub supports_agent_files: bool,
    /// `true` when the provider supports a managed MCP server entry.
    pub supports_mcp: bool,
    /// Filenames (relative to a project's root folder) this provider
    /// reads as agent instruction files (e.g. `["CLAUDE.md"]`). Drives
    /// the project-settings "Global files" auto-list (catique-2). Empty
    /// when the provider has no project-root agent-file convention.
    pub project_agent_files: Vec<String>,
}

/// Fan-out sync state across every connected provider.
///
/// The orchestrator flips this to `Syncing` at the start of a sync
/// round and back to either `Idle` (everyone succeeded) or `Error`
/// (at least one provider failed) at the end. The frontend listens
/// for `sync:status_changed` and renders a global indicator from
/// this value.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[ts(export, export_to = "../../../bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub state: SyncState,
    /// Provider ids whose most recent sync failed. Empty when
    /// `state != Error`.
    pub failing_providers: Vec<String>,
}

#[derive(TS, Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[ts(export, export_to = "../../../bindings/")]
#[serde(rename_all = "lowercase")]
pub enum SyncState {
    #[default]
    Idle,
    Syncing,
    Error,
}
