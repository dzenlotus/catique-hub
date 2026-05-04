//! `Prompt` — reusable text fragment. Mirrors `prompts`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A named prompt fragment, attached to roles/boards/columns/tasks via
/// link-tables (see Promptery resolver). `token_count` is a cached
/// `cl100k_base` count for `content`, recomputed on every write.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    pub id: String,
    pub name: String,
    pub content: String,
    pub color: Option<String>,
    pub short_description: Option<String>,
    /// Optional pixel-icon identifier. The TS layer maps this string onto
    /// a React component from `src/shared/ui/Icon/`. `None` (and any
    /// identifier the frontend doesn't recognise) renders no icon.
    pub icon: Option<String>,
    pub token_count: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}
