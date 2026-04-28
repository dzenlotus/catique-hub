//! `McpTool` — registered MCP tool definition. Mirrors `mcp_tools` table.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A Model-Context-Protocol tool definition that can be attached to
/// roles and tasks. `schema_json` holds the JSON-encoded input schema
/// (validated as valid JSON at the application layer on create).
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
    pub created_at: i64,
    pub updated_at: i64,
}
