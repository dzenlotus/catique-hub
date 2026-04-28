//! `SearchResult` — discriminated union for global FTS5 search results.
//!
//! The `snippet` field is populated by SQLite's built-in
//! `snippet(table, col_idx, prefix, suffix, ellipsis, max_tokens)` function
//! and contains a small text fragment highlighting the matched terms.
//!
//! **No FTS for prompts**: `prompts` lacks an FTS5 virtual table in the
//! current schema. Adding one requires a new migration — track as follow-up
//! E4.x "add prompts_fts + expose via search_all".

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A single result returned by the global search.
///
/// The discriminant field is `"type"` (not `"kind"`) to avoid a name
/// collision with the `kind` payload field on `AgentReport`. Values are
/// camelCase: `"task"` or `"agentReport"`.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/")]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SearchResult {
    /// A matching kanban task.
    Task {
        id: String,
        #[serde(rename = "boardId")]
        #[ts(rename = "boardId")]
        board_id: String,
        #[serde(rename = "columnId")]
        #[ts(rename = "columnId")]
        column_id: String,
        title: String,
        snippet: String,
    },
    /// A matching agent report.
    AgentReport {
        id: String,
        #[serde(rename = "taskId")]
        #[ts(rename = "taskId")]
        task_id: String,
        title: String,
        kind: String,
        snippet: String,
    },
}
