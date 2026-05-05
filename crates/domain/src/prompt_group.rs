//! `PromptGroup` — named collection of prompts. Mirrors `prompt_groups`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A named, coloured collection of prompts that can be attached as a unit.
///
/// Schema: `001_initial.sql` section 9 (Promptery v0.4 lines 200-219).
/// `position` is stored as `INTEGER` in SQLite, represented as `i64` here.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct PromptGroup {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    /// Optional pixel-icon identifier. The TS layer maps this string onto
    /// a React component from `src/shared/ui/Icon/`. `None` (and any
    /// identifier the frontend doesn't recognise) renders no icon.
    pub icon: Option<String>,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
}
