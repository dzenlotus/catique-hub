-- 032_task_overrides_v2.sql — refactor-v3 D-A.
--
-- Replace-OR-suppress override surface for prompts, skills and mcp_tools
-- attached to a single task. Three parallel tables (one per attached
-- entity kind) keep FK enforcement on `source_*_id` / `replacement_*_id`
-- and avoid the polymorphic-row pattern that SQLite doesn't model
-- cleanly. See `docs/refactor-v3/decisions/D-A-override-semantics-skills-integrations.md`.
--
-- Semantics:
--   * `replacement_*_id IS NULL`        → suppress the inherited row.
--   * `replacement_*_id IS NOT NULL`    → substitute the inherited row
--                                          with the replacement entity,
--                                          preserving the original origin
--                                          tag (UI appends "★ override").
--
-- The legacy `task_prompt_overrides` table (suppress-only, `enabled INTEGER`)
-- from `001_initial.sql` is preserved untouched during the migration window;
-- the resolver post-pass reads exclusively from the new `_v2` tables. A
-- subsequent migration (post-Phase-0) will backfill + drop the legacy
-- shape once all clients are on the `_v2` IPC surface.

CREATE TABLE IF NOT EXISTS task_prompt_overrides_v2 (
  task_id               TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_prompt_id      TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  replacement_prompt_id TEXT REFERENCES prompts(id) ON DELETE CASCADE,
  created_at            INTEGER NOT NULL,
  PRIMARY KEY (task_id, source_prompt_id)
);
CREATE INDEX IF NOT EXISTS idx_task_prompt_overrides_v2_task
  ON task_prompt_overrides_v2(task_id);

CREATE TABLE IF NOT EXISTS task_skill_overrides_v2 (
  task_id              TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_skill_id      TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  replacement_skill_id TEXT REFERENCES skills(id) ON DELETE CASCADE,
  created_at           INTEGER NOT NULL,
  PRIMARY KEY (task_id, source_skill_id)
);
CREATE INDEX IF NOT EXISTS idx_task_skill_overrides_v2_task
  ON task_skill_overrides_v2(task_id);

CREATE TABLE IF NOT EXISTS task_mcp_tool_overrides_v2 (
  task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_tool_id      TEXT NOT NULL REFERENCES mcp_tools(id) ON DELETE CASCADE,
  replacement_tool_id TEXT REFERENCES mcp_tools(id) ON DELETE CASCADE,
  created_at          INTEGER NOT NULL,
  PRIMARY KEY (task_id, source_tool_id)
);
CREATE INDEX IF NOT EXISTS idx_task_mcp_tool_overrides_v2_task
  ON task_mcp_tool_overrides_v2(task_id);
