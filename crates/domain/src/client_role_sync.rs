//! Domain types for role-file sync from Catique Hub to client agents (ctq-69).
//!
//! Sync is **one-way**: Catique Hub → client agent files.
//! Existing user-authored agent files are never touched — only files marked
//! with `managed-by: catique-hub` frontmatter and the `catique-` filename
//! prefix are considered managed.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Describes one managed agent-definition file on disk after a sync.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SyncedRoleFile {
    /// Id of the connected client (e.g. `"claude-code"`, `"cursor"`).
    pub client_id: String,
    /// The Catique Hub role id this file was generated from.
    pub role_id: String,
    /// Absolute path of the written agent-definition file.
    pub file_path: String,
    /// Unix-millisecond timestamp recorded in the file's frontmatter and
    /// returned here for display purposes.
    pub synced_at: i64,
}

/// Summary of one sync run for a single connected client.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/")]
#[serde(rename_all = "camelCase")]
pub struct RoleSyncReport {
    /// Id of the connected client that was synced.
    pub client_id: String,
    /// Role ids whose files were newly created (did not exist before sync).
    pub created: Vec<String>,
    /// Role ids whose files were overwritten (existed with managed marker).
    pub updated: Vec<String>,
    /// Role ids whose files were removed (role deleted from Catique Hub).
    pub deleted: Vec<String>,
    /// Filenames of user-authored files that were deliberately left
    /// untouched (no `catique-` prefix or no managed frontmatter).
    pub skipped: Vec<String>,
}
