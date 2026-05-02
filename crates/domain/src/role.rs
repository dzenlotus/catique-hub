//! `Role` — agent role. Mirrors `roles`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// An agent role (e.g. "rust-backend-engineer"). Acts as a default
/// prompt-set carrier: bound to boards/columns/tasks, contributes
/// inherited prompts via `role_prompts` link-table.
///
/// `is_system = true` marks rows that the application owns and the user
/// must not edit or delete — currently the `Maintainer` and `Dirizher`
/// rows seeded by migration `004_cat_as_agent_phase1.sql` (Cat-as-Agent
/// Phase 1, ctq-73). The use-case layer enforces immutability against
/// this flag; the schema does not.
///
/// `display_name` is intentionally **not** a separate column — the
/// existing `name` field already serves the role-display semantic, and
/// adding a parallel column would create a sync surface with no
/// consumer in Phase 1. ADR-0005 + memo Q2 require only a stable id
/// for filename derivation; rename safety is on the id, not the name.
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
    /// `true` for application-owned rows (Maintainer, Dirizher). UI
    /// hides edit / delete affordances; use-case layer rejects mutation.
    #[serde(default)]
    pub is_system: bool,
}
