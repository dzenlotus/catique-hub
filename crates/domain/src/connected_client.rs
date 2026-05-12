//! `ConnectedClient` — a connected provider the user has explicitly added.
//!
//! Round-21 (Connected Providers refactor) shifted the semantics:
//!
//! - **Before**: every adapter that ever scanned `true` ended up in the
//!   registry, and the user toggled an `enabled` boolean per row.
//! - **After**: a row exists ⇔ the user has explicitly added that
//!   provider via the new "Add provider" modal. Removing the provider
//!   deletes the row (after `provider.remove()` succeeds on disk).
//!
//! The shape is therefore narrower than the pre-round-21 type: the
//! filesystem snapshot fields (`config_dir`, `signature_file`,
//! `installed`, `last_seen_at`, `enabled`, `supports_role_sync`) are
//! gone. The trait + provider modal own all of those today; only the
//! IPC-visible fields below survive.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One connected-provider row. Source of truth lives in the
/// `connected_clients` SQL table (migration 021).
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ConnectedClient {
    /// Stable provider id (kebab-case, e.g. `claude-code`).
    pub id: String,
    /// Cached human-readable display name at the time of add.
    pub display_name: String,
    /// Latest sync state for THIS provider. The fan-out
    /// `SyncStatus` over every connected provider is reported by the
    /// `get_sync_status` IPC; this per-row field lets the UI show a
    /// red dot on a single provider chip without re-querying.
    pub connection_status: ConnectionStatus,
    /// Unix-millisecond timestamp of the most recent successful sync.
    /// `0` when no sync has run yet.
    pub last_synced_at: i64,
    /// Last error message captured during sync, when
    /// `connection_status == Error`. `None` otherwise.
    pub last_error: Option<String>,
    /// Wall-clock millis when the row was inserted.
    pub created_at: i64,
    /// Wall-clock millis when the row was last updated.
    pub updated_at: i64,
}

/// Per-provider sync state. Mirrors the wire format of
/// `connected_clients.connection_status`.
#[derive(TS, Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/")]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    /// Last sync succeeded (or no sync has run yet).
    Connected,
    /// A sync is currently in flight.
    Syncing,
    /// The most recent sync failed; `last_error` carries the message.
    Error,
}

impl ConnectionStatus {
    /// Wire-format string used by the SQL column.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Connected => "connected",
            Self::Syncing => "syncing",
            Self::Error => "error",
        }
    }

    /// Parse the wire-format string. Unknown values fall back to
    /// `Connected` so a stale row doesn't crash the read path.
    #[must_use]
    pub fn parse(raw: &str) -> Self {
        match raw {
            "syncing" => Self::Syncing,
            "error" => Self::Error,
            _ => Self::Connected,
        }
    }
}
