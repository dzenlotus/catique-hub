//! `Tag` — flat label on a [`crate::Prompt`]. Mirrors `tags`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A globally-unique label. Many-to-many with prompts only (no
/// inheritance, no other entities) — keeps the resolver simple.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
