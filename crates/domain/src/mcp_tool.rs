//! `McpTool` — registered MCP tool definition. Mirrors `mcp_tools` table.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Origin of an `McpTool` row.
///
/// Under ADR-0008 every tool row belongs to one of two paths:
///
/// * `Upstream` — the row was materialised from an upstream MCP server's
///   `tools/list` reply during introspection (PROXY-S4). `server_id` is
///   the FK back to that server; `upstream_name` is the unqualified
///   tool name the upstream sees; `last_synced_at` is the most recent
///   successful introspection touch.
/// * `Manual` — the row was created by hand via `McpToolCreateDialog`
///   (the pre-ADR-0008 path). `server_id` is `None`; `upstream_name`
///   is `None`; `last_synced_at` is `None`.
#[derive(TS, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum McpToolSource {
    Upstream,
    Manual,
}

/// A Model-Context-Protocol tool definition that can be attached to
/// roles and tasks. `schema_json` holds the JSON-encoded input schema
/// (validated as valid JSON at the application layer on create).
///
/// Upstream-sourced rows whose `last_synced_at` is `None` are
/// "soft-deleted": the most recent refresh found that the upstream
/// server no longer advertises the tool. The row stays for audit
/// (existing role attachments keep working) but the UI strikes it
/// through and new attachments filter it out.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub schema_json: String,
    pub color: Option<String>,
    pub position: f64,
    /// FK to `mcp_servers(id)`. `None` for `source = Manual` rows.
    pub server_id: Option<String>,
    /// Unqualified upstream tool name. `None` for `source = Manual`.
    pub upstream_name: Option<String>,
    pub source: McpToolSource,
    pub last_synced_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}
