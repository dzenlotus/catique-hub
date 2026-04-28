//! `ClientInstructions` — the global instructions file for a connected
//! agentic client (ctq-68).
//!
//! Carries the full file content plus metadata so the UI can display
//! staleness info and handle "changed externally" warnings on save.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Content and metadata for a client's global instructions file.
///
/// Read via `read_client_instructions`; written via
/// `write_client_instructions`. Both commands return the fresh snapshot
/// so the frontend can update its cache without an additional round-trip.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ClientInstructions {
    /// Kebab-case client id (e.g. `claude-code`).
    pub client_id: String,
    /// Absolute path to the instructions file (may not exist on disk).
    pub file_path: String,
    /// Full text content of the file. Empty string when the file is absent.
    pub content: String,
    /// Unix-millisecond last-modified time. `0` when the file is absent.
    pub modified_at: i64,
    /// `true` when the file existed on disk at read time.
    pub exists: bool,
}
