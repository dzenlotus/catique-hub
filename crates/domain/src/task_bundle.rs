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

use crate::{McpTool, Prompt, Role, Skill, Task};

/// Origin of one [`PromptWithOrigin`] inside a [`TaskBundle`]. The
/// resolver tags every materialised row by which scope contributed it;
/// the variants mirror the four levels of the inheritance chain plus
/// `Direct` for prompts attached straight to the task.
///
/// Wire format (`#[serde(tag = "kind", content = "id")]`):
/// `{ "kind": "direct" }`, `{ "kind": "role", "id": "<role-id>" }`, …
///
/// `Group` is a UI-only variant — the inheritance resolver in
/// `resolve_task_bundle` never produces it. The frontend uses it for
/// prompt-group membership badges (`InlineGroupView` renders "via
/// group" next to each member prompt). The variant is exported through
/// `ts-rs` so `OriginBadge` stays type-safe end-to-end without a
/// frontend-local widening of the union.
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
    /// UI-only: prompt is shown via prompt-group membership. The
    /// inheritance resolver never emits this; frontend constructs it
    /// directly in `InlineGroupView` to render a "via group" badge on
    /// every member row.
    Group(String),
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
            // `Group` is a UI-only origin (frontend uses it for
            // prompt-group membership badges in `InlineGroupView`); the
            // inheritance resolver never produces it, so its precedence
            // is never compared against the inheritance variants.
            Self::Group(_) => 0,
        }
    }

    /// Parse the SQL-side origin string (`"direct"`, `"role:abc"`, …).
    /// Returns `None` for malformed strings; the resolver treats those
    /// rows as if they were `Direct` rather than crashing.
    ///
    /// Composite group/server-sourced rows use an origin
    /// `"<scope>:<id>#group:<gid>"` or `"<scope>:<id>#server:<sid>"` (and
    /// the `"direct#…"` task forms). `parse` strips everything from the
    /// first `#` and returns the **base scope** so precedence/breadcrumb
    /// logic keeps working unchanged; callers that need the source group
    /// use [`OriginRef::parse_with_group`].
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        let base = raw.split_once('#').map_or(raw, |(b, _)| b);
        if base == "direct" {
            return Some(Self::Direct);
        }
        let (scope, id) = base.split_once(':')?;
        let id = id.to_owned();
        match scope {
            "role" => Some(Self::Role(id)),
            "column" => Some(Self::Column(id)),
            "board" => Some(Self::Board(id)),
            "space" => Some(Self::Space(id)),
            _ => None,
        }
    }

    /// Parse a (possibly composite) origin into its base scope plus the
    /// optional source-group id. Group-sourced materialised rows carry a
    /// `"#group:<gid>"` suffix; this splits it off so the resolver can
    /// tag [`PromptWithOrigin::via_group`] while keeping the base scope's
    /// precedence intact. Returns `None` only when the base scope is
    /// malformed (same contract as [`OriginRef::parse`]).
    #[must_use]
    pub fn parse_with_group(raw: &str) -> Option<(Self, Option<String>)> {
        let (base, group) = match raw.split_once("#group:") {
            Some((b, g)) => (b, Some(g.to_owned())),
            None => (raw, None),
        };
        Some((Self::parse(base)?, group))
    }
}

/// One prompt entry inside a [`TaskBundle`], paired with its origin.
///
/// `overridden` (refactor-v3 D-A) is `true` when the row is a
/// replacement substituted in by `task_prompt_overrides_v2`. The
/// `origin` field stays the **original** inherited origin so the UI can
/// render the breadcrumb (board / column / role / space) the user is
/// actually overriding; rendering the "★ override" badge is a frontend
/// concern. `serde(default)` keeps deserialisation of stored payloads
/// forward-compatible with pre-D-A callers.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct PromptWithOrigin {
    pub prompt: Prompt,
    pub origin: OriginRef,
    #[serde(default)]
    pub overridden: bool,
    /// Set when this row was materialised from an attached prompt group.
    /// Carries the source group's id so the UI can render a "via group"
    /// badge and hide the member from the picker's option list. `None`
    /// for individually-attached rows. `origin` still reflects the
    /// *scope* the group was attached at (its base, group suffix stripped).
    #[serde(default)]
    #[ts(optional)]
    pub via_group: Option<String>,
}

/// One skill entry inside a [`TaskBundle`], paired with its origin.
/// ctq-119 — mirrors [`PromptWithOrigin`] over `task_skills` rows.
/// `overridden` carries the same refactor-v3 D-A semantics.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct SkillWithOrigin {
    pub skill: Skill,
    pub origin: OriginRef,
    #[serde(default)]
    pub overridden: bool,
    /// Source prompt/skill group when materialised via a group attachment;
    /// see [`PromptWithOrigin::via_group`].
    #[serde(default)]
    #[ts(optional)]
    pub via_group: Option<String>,
}

/// One MCP-tool entry inside a [`TaskBundle`], paired with its origin.
/// ctq-119 — mirrors [`PromptWithOrigin`] over `task_mcp_tools` rows.
/// `overridden` carries the same refactor-v3 D-A semantics.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct McpToolWithOrigin {
    pub mcp_tool: McpTool,
    pub origin: OriginRef,
    #[serde(default)]
    pub overridden: bool,
    /// Source MCP-tool group when materialised via a group attachment;
    /// see [`PromptWithOrigin::via_group`].
    #[serde(default)]
    #[ts(optional)]
    pub via_group: Option<String>,
}

/// Fully-resolved view of one task: its row, its active role (if any),
/// and the deduplicated, origin-tagged prompt set ready for assembly
/// into the LLM payload.
///
/// ctq-119 extends the bundle with `skills` + `mcp_tools` so a single
/// `get_task_bundle` call returns everything the agent needs. Each
/// collection follows the same precedence rule as `prompts`:
/// `Direct > Role > Column > Board > Space`, with one entry per leaf
/// id (highest-precedence origin wins on a tie).
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
    /// Skills ordered by the same precedence rule as `prompts`.
    /// Defaults to an empty vec for backward compatibility with
    /// pre-ctq-119 callers (the `serde(default)` keeps deserialisation
    /// of stored payloads forward-compatible).
    #[serde(default)]
    pub skills: Vec<SkillWithOrigin>,
    /// MCP tools ordered by the same precedence rule.
    #[serde(default)]
    pub mcp_tools: Vec<McpToolWithOrigin>,
    /// Inherited prompts the user explicitly suppressed via
    /// `task_prompt_overrides_v2` (refactor-v3 D-A). The UI renders
    /// these struck-through with a "restore" affordance. Empty on
    /// pre-D-A tasks. `serde(default)` keeps backward compatibility.
    #[serde(default)]
    pub suppressed_prompts: Vec<Prompt>,
    /// Inherited skills the user explicitly suppressed.
    #[serde(default)]
    pub suppressed_skills: Vec<Skill>,
    /// Inherited mcp_tools the user explicitly suppressed.
    #[serde(default)]
    pub suppressed_mcp_tools: Vec<McpTool>,
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
    fn parse_strips_group_suffix_to_base_scope() {
        // Composite group-sourced origins resolve to their base scope.
        assert_eq!(
            OriginRef::parse("role:abc#group:g1"),
            Some(OriginRef::Role("abc".into()))
        );
        assert_eq!(OriginRef::parse("direct#group:g1"), Some(OriginRef::Direct));
    }

    #[test]
    fn parse_with_group_extracts_source_group() {
        assert_eq!(
            OriginRef::parse_with_group("board:b1"),
            Some((OriginRef::Board("b1".into()), None))
        );
        assert_eq!(
            OriginRef::parse_with_group("board:b1#group:g9"),
            Some((OriginRef::Board("b1".into()), Some("g9".into())))
        );
        assert_eq!(
            OriginRef::parse_with_group("direct#group:g9"),
            Some((OriginRef::Direct, Some("g9".into())))
        );
        // Malformed base scope still yields None.
        assert_eq!(OriginRef::parse_with_group("foo:bar#group:g9"), None);
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
