# D-B — Denormalized effective-context counter on tasks

**Status:** Proposed (draft — awaiting product sign-off)
**Phase:** 0 (unblocks Phase 3 kanban indicators)
**Surface:** `crates/infrastructure/src/db/migrations/033_task_effective_counts.sql`, resolver hooks in `crates/application/src/tasks.rs`

---

## Context

Project Map open issue #3: a kanban board with 50+ tasks renders an effective-context count per card. Calling `get_task_bundle` for each card on every render = `N × (5-table-join + override post-pass)`. Even at the existing P99 of ~31 ms per task, 50 tasks = 1.5 s of synchronous DB time per board view — a non-starter.

ADR-0006 already chose write-time materialisation for the same reason (read-path performance). This decision extends the same principle to the cardinality summary.

## Options

| # | Approach | Pros | Cons |
|---|---|---|---|
| 1 | Compute counts in batch via `SELECT task_id, COUNT(*) FROM task_prompts WHERE task_id IN (?,?,...)` per board open | No schema | Still N queries on board open for skills + integrations; doesn't capture override post-pass effects |
| 2 | Denormalize `effective_prompt_count / effective_skill_count / effective_tool_count` columns on `tasks` row; maintain via application-layer hooks at every mutation | Single-row read; aligns with ADR-0006 materialisation philosophy | New invariant to maintain; bugs leak as "wrong count on card" |
| 3 | SQLite triggers that maintain the counts | No application-layer responsibility | Triggers can't easily compute the override post-pass; rule split between SQL and Rust is painful to debug |

## Decision

**Option 2.** Add three integer columns to `tasks`:

```sql
ALTER TABLE tasks ADD COLUMN effective_prompt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN effective_skill_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN effective_tool_count INTEGER NOT NULL DEFAULT 0;
```

Maintenance: every use case that mutates `task_prompts`, `task_skills`, `task_mcp_tools`, or any `task_*_overrides_v2` row recomputes the affected task's counter at the end of its transaction. The recompute is the same single-table COUNT(*) but happens **at write time**, not at every board render.

A `tools/admin/recompute_effective_counts.rs` one-off binary backfills the columns on first migration; it's also wired to `pnpm tauri:dev` startup behind a `dev-resync` feature flag so developers regenerating their DB don't need to remember.

## Acceptance criteria

- Kanban board load: 1 query reads all task rows; effective counts come for free in the row.
- Bench: 200-task board renders in under 100 ms total DB time (down from ~6 s under naïve per-row resolver calls).
- Test: adding a prompt at the board scope updates the counter on every task whose `role_id` belongs to that board, observable via `get_task` immediately.
- Test: setting an override that suppresses a prompt **decrements** the counter on that task.

## Open questions

- Should the counter live on `task_row` or in a sibling `task_effective_counts` table? Recommendation: on `task_row` — joins are free since the kanban already reads `tasks`, and the storage cost is 24 bytes per task.
- Suppress vs replace: a replacement override leaves the count unchanged; suppress decrements. Verify this matches what the kanban UI should display ("how many things the agent will see").

## Out of scope

- Counters for attachments, reports, files — these aren't part of the "effective context" surface.
- Per-entity-kind breakdown (prompts vs skills vs tools) — the kanban card shows a single combined number; the breakdown lives in the task detail panel.
