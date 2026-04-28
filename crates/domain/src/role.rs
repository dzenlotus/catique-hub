//! `Role` — agent role. Mirrors `roles`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// An agent role (e.g. "rust-backend-engineer"). Acts as a default
/// prompt-set carrier: bound to boards/columns/tasks, contributes
/// inherited prompts via `role_prompts` link-table.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct Role {
    pub id: String,
    pub name: String,
    pub content: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
