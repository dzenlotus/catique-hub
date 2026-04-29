//! `PromptTagMapEntry` — one element of the bulk prompt-tag mapping
//! returned by the `list_prompt_tags_map` IPC command.
//!
//! Each entry holds one `prompt_id` and the list of all `tag_id`s
//! currently attached to it. The FE uses this to filter the prompts
//! list by selected tag without N+1 IPC calls.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One entry in the prompt → tag mapping bulk response.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct PromptTagMapEntry {
    /// The prompt id.
    pub prompt_id: String,
    /// All tag ids currently attached to this prompt.
    pub tag_ids: Vec<String>,
}
