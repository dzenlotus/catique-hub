//! `ConnectedClient` — an agentic client detected on-disk (ctq-67).
//!
//! Each client is identified by a stable kebab-case `id` (e.g.
//! `claude-code`, `cursor`). The adapter crate probes for the
//! `signature_file` at scan time and sets `installed`; the user can
//! then toggle `enabled` independently via the Settings UI.
//!
//! `last_seen_at` is Unix-millisecond wall time recorded each time the
//! registry is rescanned; it lets the UI show staleness info in later
//! iterations.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A discovered (or previously-discovered) agentic client on this
/// machine.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ConnectedClient {
    /// Stable id — kebab-case, e.g. `claude-code`, `cursor`.
    pub id: String,
    /// Human display name shown in the Settings UI.
    pub display_name: String,
    /// Absolute config directory resolved by the adapter (e.g.
    /// `~/.claude` expanded to `/Users/alice/.claude`).
    pub config_dir: String,
    /// Signature file the adapter probes to decide `installed`.
    pub signature_file: String,
    /// `true` when the signature file existed at the last scan.
    pub installed: bool,
    /// Per-client user toggle. Defaults to `installed` on first scan;
    /// survives subsequent rescans (merge logic in
    /// `infrastructure::clients::registry`).
    pub enabled: bool,
    /// Unix-millisecond timestamp of the last registry rescan.
    pub last_seen_at: i64,
    /// `true` when this client supports one-way role-file sync from
    /// Catique Hub (ctq-69). Populated from
    /// `ClientAdapter::supports_role_sync()` at scan time.
    ///
    /// Clients where this is `false` (Claude Desktop, Qwen CLI v1) show
    /// a "не поддерживается" hint in the Settings UI.
    pub supports_role_sync: bool,
}
