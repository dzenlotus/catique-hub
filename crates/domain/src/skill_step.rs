//! `SkillStep` — one ordered step inside a [`crate::Skill`].
//!
//! SKILL-V2-A. Skills graduate from a flat markdown body to a pair of
//! shapes:
//!
//!   * `Skill.description` — high-level overview / TL;DR (what the
//!     skill is FOR; the agent uses this to decide whether the skill
//!     is relevant to the task at hand).
//!   * `SkillStep[]` (this struct) — ordered execution sequence the
//!     agent walks once it has decided to apply the skill. Each step
//!     is a structured `{title, body, expected_outcome?}` triplet.
//!
//! `position` is REAL so an insert-between is one INSERT (mirrors the
//! columns/tasks contract); collisions are resolved by the use-case
//! resequencer. `expected_outcome` is `Option<String>` because many
//! actions have an obvious "did it work" signal — forcing a body on
//! every step would be noise.
//!
//! Mirrors the `skill_steps` table introduced in migration
//! `027_skill_steps.sql`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One ordered step inside a [`crate::Skill`].
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct SkillStep {
    pub id: String,
    pub skill_id: String,
    pub position: f64,
    pub title: String,
    pub body: String,
    pub expected_outcome: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
