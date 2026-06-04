-- 033_task_effective_counts.sql — refactor-v3 D-B.
--
-- Denormalised effective-context counters on `tasks`. The kanban board
-- renders an "N attached" indicator per card; computing it on read by
-- resolving every task's bundle would be `N × (5-table-join + override
-- post-pass)` on every board open. ADR-0006 already chose write-time
-- materialisation for the same reason — this migration extends the
-- principle to the cardinality summary.
--
-- Decision memo: `docs/refactor-v3/decisions/D-B-effective-counter-denormalization.md`.
--
-- Maintenance lives in the application layer: every use case that
-- mutates `task_prompts`, `task_skills`, `task_mcp_tools`, or any
-- `task_*_overrides_v2` row calls
-- `repositories::tasks::recompute_effective_counts(conn, task_id)` at
-- the end of its transaction. This migration handles the one-off
-- backfill for existing rows; subsequent mutations rely on the hooks.
--
-- Backfill semantics: `COUNT(*)` on each join table minus the count of
-- suppress-only overrides (replacement_*_id IS NULL) in the matching
-- `task_*_overrides_v2`. Replace-overrides preserve cardinality — one
-- row in, one row out — so they do not enter the formula.

ALTER TABLE tasks ADD COLUMN effective_prompt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN effective_skill_count  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN effective_tool_count   INTEGER NOT NULL DEFAULT 0;

-- One-off backfill. The subselect form (rather than UPDATE...FROM, which
-- SQLite did not support until 3.33) computes each counter from its
-- materialised join table and subtracts the suppress-only override
-- count. COALESCE guards against NULLs from the LEFT outer-shape
-- subselect when the join table is empty for that task.
UPDATE tasks SET
  effective_prompt_count = COALESCE(
    (SELECT COUNT(*) FROM task_prompts tp WHERE tp.task_id = tasks.id),
    0
  ) - COALESCE(
    (SELECT COUNT(*) FROM task_prompt_overrides_v2 o
      WHERE o.task_id = tasks.id AND o.replacement_prompt_id IS NULL),
    0
  ),
  effective_skill_count = COALESCE(
    (SELECT COUNT(*) FROM task_skills ts WHERE ts.task_id = tasks.id),
    0
  ) - COALESCE(
    (SELECT COUNT(*) FROM task_skill_overrides_v2 o
      WHERE o.task_id = tasks.id AND o.replacement_skill_id IS NULL),
    0
  ),
  effective_tool_count = COALESCE(
    (SELECT COUNT(*) FROM task_mcp_tools tm WHERE tm.task_id = tasks.id),
    0
  ) - COALESCE(
    (SELECT COUNT(*) FROM task_mcp_tool_overrides_v2 o
      WHERE o.task_id = tasks.id AND o.replacement_tool_id IS NULL),
    0
  );
