//! `Skill` — reusable skill/capability tag. Mirrors `skills` table.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A skill that can be attached to roles and tasks.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub position: f64,
    pub created_at: i64,
    pub updated_at: i64,
}
