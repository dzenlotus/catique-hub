//! `Space` — top-level container of boards. Mirrors `spaces` table.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A workspace partition. Holds a fleet of boards under a short prefix
/// (`prefix` — `[a-z0-9-]{1,10}`) used for slug generation
/// (`<prefix>-NN`). Exactly one space is marked `is_default`.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub id: String,
    pub name: String,
    pub prefix: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub position: f64,
    pub created_at: i64,
    pub updated_at: i64,
}
