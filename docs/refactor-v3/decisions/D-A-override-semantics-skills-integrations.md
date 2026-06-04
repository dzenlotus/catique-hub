# D-A — Override semantics for skills and integrations

**Status:** Proposed (draft — awaiting product sign-off)
**Phase:** 0 (unblocks Phase 3)
**Surface:** `crates/infrastructure/src/db/migrations/032_task_skill_integration_overrides.sql`, `crates/application/src/tasks.rs`, `crates/api/src/handlers/tasks.rs`, ts-rs bindings

---

## Context

Today only `task_prompt_overrides(task_id, prompt_id, enabled INTEGER)` exists (`001_initial.sql:280-286`) — a per-task suppress toggle. There is no override surface for skills or integrations, and even the prompt override is **suppress-only**, not replace.

Project Map v3 task-detail surface needs override = "replace inherited X with Y" for prompts, skills, and integrations alike (changelog §"Task detail" — "Override = replace, not only suppress + add").

## Options

| # | Approach | Pros | Cons |
|---|---|---|---|
| 1 | Keep suppress-only; reach replace via `[suppress inherited] + [add direct]` two-step | No schema change | Two clicks for one mental action; no atomic guarantee; UI must paper over the split |
| 2 | Extend each override row with `replacement_id NULL` (suppress = `replacement_id IS NULL`, replace = points at replacement entity) | One table per entity (3 tables); atomic; fits resolver's existing single-source-of-truth pattern | Mild schema duplication across three tables |
| 3 | One polymorphic `task_overrides(task_id, kind, source_id, replacement_id NULL)` | Compact | Polymorphism in SQLite is unidiomatic; loses FK enforcement on `source_id`/`replacement_id` |

## Decision

**Option 2.** Three parallel tables — one per attached-entity kind — each with the same shape:

```sql
CREATE TABLE task_prompt_overrides_v2 (
  task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  replacement_prompt_id TEXT REFERENCES prompts(id) ON DELETE CASCADE,  -- NULL = suppress
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (task_id, source_prompt_id)
);
-- analogous: task_skill_overrides, task_integration_overrides (mcp_tools)
```

The existing `task_prompt_overrides` schema is preserved as legacy storage during migration. New writes go to `_v2`. Resolver reads from `_v2` and falls back to legacy for unmigrated rows; a backfill walker copies legacy rows into `_v2` with `replacement_prompt_id = NULL` and drops the old table once verified.

### Resolver behaviour

`get_task_bundle` runs after materialisation (D-004 / ADR-0006) and applies overrides as a post-pass:

1. Read inherited + direct rows from `task_prompts` / `task_skills` / `task_mcp_tools`.
2. For each entity kind, apply the override rows:
   - `replacement_id IS NULL` → drop the inherited row (mark `suppressed`).
   - `replacement_id IS NOT NULL` → substitute the inherited row with the replacement, retaining the `origin` tag of the original but appending `★ override`.

### New IPC

- `set_task_skill_override(task_id, source_skill_id, replacement_skill_id?)`
- `set_task_integration_override(task_id, source_tool_id, replacement_tool_id?)`
- `clear_task_*_override(task_id, source_id)` — for each kind.

Prompt override gets a parallel `set_task_prompt_override_v2(task_id, source_prompt_id, replacement_prompt_id?)` — the original `set_task_prompt_override(enabled: bool)` remains callable for one release as a thin wrapper that writes to the `_v2` table with `replacement_id = NULL`.

## Acceptance criteria

- Migration `032_*.sql` creates three `_v2` tables; bench shows resolver still under 50 ms P99 on 10k tasks with 5 overrides per task.
- Backfill walker is idempotent — running it twice on the same DB is a no-op.
- A task with `prompt A inherited from board` and `replacement_prompt_id = B` returns prompt B with `origin: "board ★ override"` from `get_task_bundle`.
- Suppressed inherited items appear in `bundle.suppressed_prompts` (new field) so the UI can render strikethrough + restore.
- ts-rs bindings regenerated and committed.

## Open questions

- Do replacements respect the **position** of the original, or do they sort to the end? Recommendation: respect original position to keep the assembled prompt order stable.
- Cycle detection — can `replacement_id` point at another prompt that's itself overridden elsewhere? Recommendation: no transitive overrides; replacements are evaluated as leaves.

## Out of scope

- Override for direct attachments (no source to replace). Direct rows are deleted, not overridden.
- Multi-entity overrides (e.g., replace one prompt with two). v3 keeps it 1:1.
