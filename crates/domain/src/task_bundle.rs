//! `TaskBundle` — the resolved per-task prompt set ready for the LLM.
//!
//! ADR-0006 (write-time materialisation) chose `task_prompts` as the
//! single read source for `get_task_bundle`. The bundle joins that flat
//! row set against `prompts` and tags every entry with the *origin*
//! (which scope contributed it) so the UI can render an inheritance
//! breadcrumb without a second query. The override rule "direct beats
//! inherited" is applied in Rust after the fetch — see
//! `infrastructure::db::repositories::tasks::resolve_task_bundle`.
//!
//! ## Origin precedence
//!
//! When the same `prompt_id` appears under multiple origins (e.g. a
//! prompt is attached both directly to a task AND inherited from the
//! task's role), the highest-precedence origin wins. From most-specific
//! to least:
//!
//! ```text
//! Direct  >  Role(_)  >  Column(_)  >  Board(_)  >  Space(_)
//! ```
//!
//! The "active role" (`task.role_id` ?? `column.role_id` ?? `board.role_id`)
//! is exposed via [`TaskBundle::role`] for display purposes; the role's
//! prompts are *not* re-materialised through the column/board fallback —
//! only the role explicitly attached to the task contributes prompt rows
//! tagged `origin = 'role:<id>'`. This matches the existing trigger
//! `cleanup_role_origin_on_role_delete` (`001_initial.sql:245-251`) which
//! sweeps rows by that exact origin pattern.
//!
//! ## TS export
//!
//! `TaskBundle`, `PromptWithOrigin`, `OriginRef` derive `ts_rs::TS` and
//! land under `bindings/` so the frontend gets the typed shape directly.
//! `OriginRef` is a tagged enum (`{ kind: "role", id: "..." }` etc.) —
//! the SQL-side string form (`"role:abc"`) is an infrastructure detail
//! the resolver translates on the boundary.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{Prompt, Role, Task};

/// Origin of one [`PromptWithOrigin`] inside a [`TaskBundle`]. The
/// resolver tags every materialised row by which scope contributed it;
/// the variants mirror the four levels of the inheritance chain plus
/// `Direct` for prompts attached straight to the task.
///
/// Wire format (`#[serde(tag = "kind", content = "id")]`):
/// `{ "kind": "direct" }`, `{ "kind": "role", "id": "<role-id>" }`, …
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(tag = "kind", content = "id", rename_all = "camelCase")]
pub enum OriginRef {
    /// Prompt was attached directly to the task (`task_prompts.origin = 'direct'`).
    Direct,
    /// Prompt was inherited from the task's role (`origin = 'role:<id>'`).
    Role(String),
    /// Prompt was inherited from the task's column (`origin = 'column:<id>'`).
    Column(String),
    /// Prompt was inherited from the task's board (`origin = 'board:<id>'`).
    Board(String),
    /// Prompt was inherited from the task's space (`origin = 'space:<id>'`).
    /// Stays a stub variant if migration `011_space_prompts.sql` has not
    /// yet shipped on this DB; the resolver returns no `Space` rows in
    /// that case.
    Space(String),
}

impl OriginRef {
    /// Precedence rank — higher wins under the override rule. Used by
    /// the resolver's de-duplication step when the same `prompt_id`
    /// appears under multiple origins.
    #[must_use]
    pub fn precedence(&self) -> u8 {
        match self {
            Self::Direct => 5,
            Self::Role(_) => 4,
            Self::Column(_) => 3,
            Self::Board(_) => 2,
            Self::Space(_) => 1,
        }
    }

    /// Parse the SQL-side origin string (`"direct"`, `"role:abc"`, …).
    /// Returns `None` for malformed strings; the resolver treats those
    /// rows as if they were `Direct` rather than crashing.
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        if raw == "direct" {
            return Some(Self::Direct);
        }
        let (scope, id) = raw.split_once(':')?;
        let id = id.to_owned();
        match scope {
            "role" => Some(Self::Role(id)),
            "column" => Some(Self::Column(id)),
            "board" => Some(Self::Board(id)),
            "space" => Some(Self::Space(id)),
            _ => None,
        }
    }
}

/// One prompt entry inside a [`TaskBundle`], paired with its origin.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct PromptWithOrigin {
    pub prompt: Prompt,
    pub origin: OriginRef,
}

/// Fully-resolved view of one task: its row, its active role (if any),
/// and the deduplicated, origin-tagged prompt set ready for assembly
/// into the LLM payload.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct TaskBundle {
    pub task: Task,
    /// Active role for this task: `task.role_id` if set, else
    /// `column.role_id`, else `board.role_id`. Resolved at read time so
    /// the consumer never has to walk the chain itself.
    pub role: Option<Role>,
    /// Prompts ordered by precedence-then-position. Direct rows lead;
    /// inherited rows follow in `Role > Column > Board > Space` order.
    pub prompts: Vec<PromptWithOrigin>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_known_origins_round_trip() {
        assert_eq!(OriginRef::parse("direct"), Some(OriginRef::Direct));
        assert_eq!(
            OriginRef::parse("role:abc"),
            Some(OriginRef::Role("abc".into()))
        );
        assert_eq!(
            OriginRef::parse("column:c1"),
            Some(OriginRef::Column("c1".into()))
        );
        assert_eq!(
            OriginRef::parse("board:b1"),
            Some(OriginRef::Board("b1".into()))
        );
        assert_eq!(
            OriginRef::parse("space:s1"),
            Some(OriginRef::Space("s1".into()))
        );
    }

    #[test]
    fn parse_unknown_returns_none() {
        assert_eq!(OriginRef::parse("nonsense"), None);
        assert_eq!(OriginRef::parse("foo:bar"), None);
    }

    #[test]
    fn precedence_orders_direct_above_inherited() {
        assert!(OriginRef::Direct.precedence() > OriginRef::Role("a".into()).precedence());
        assert!(
            OriginRef::Role("a".into()).precedence() > OriginRef::Column("c".into()).precedence()
        );
        assert!(
            OriginRef::Column("c".into()).precedence() > OriginRef::Board("b".into()).precedence()
        );
        assert!(
            OriginRef::Board("b".into()).precedence() > OriginRef::Space("s".into()).precedence()
        );
    }
}
