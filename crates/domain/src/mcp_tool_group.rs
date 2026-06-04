//! `McpToolGroup` — named collection of MCP tools. Mirrors `mcp_tool_groups`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A named, coloured collection of MCP tools that can be attached as a
/// unit (the MCP mirror of [`crate::PromptGroup`]). Members are arbitrary
/// `mcp_tools` ids — a group may span several MCP servers.
///
/// Schema: `038_mcp_tool_groups.sql`. `position` is stored as `INTEGER`
/// in SQLite, represented as `i64` here.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct McpToolGroup {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    /// Optional pixel-icon identifier; the TS layer maps it onto a React
    /// component from `src/shared/ui/Icon/`. `None` renders no icon.
    pub icon: Option<String>,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
}
