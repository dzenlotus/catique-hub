//! `Board` — kanban board nested in a [`crate::Space`]. Mirrors `boards`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A kanban board. Belongs to a space; optionally bound to a default
/// [`crate::Role`] that propagates to columns/tasks via prompt
/// inheritance (see Promptery resolver).
///
/// `owner_role_id` (Cat-as-Agent Phase 1, ctq-73) is the **owning cat**
/// — non-nullable per ADR-0005 + memo Q1. Migration
/// `004_cat_as_agent_phase1.sql` auto-assigns the deterministic
/// `maintainer-system` row to every pre-existing board. New boards must
/// supply an owner explicitly.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: String,
    pub name: String,
    pub space_id: String,
    pub role_id: Option<String>,
    pub position: f64,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Owning cat (a row in `roles`). NOT NULL at the schema level.
    pub owner_role_id: String,
}
