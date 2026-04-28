-- 015_task_prompt_overrides
-- Per-task switches that suppress (or, reserved for future, force-enable)
-- individual prompts on top of the inheritance resolver's union. Lets a task
-- exclude a single inherited prompt without removing it from the role / board /
-- column it came from.
--
-- enabled = 0 → resolver drops the prompt from this task's effective context.
-- enabled = 1 → reserved; today the resolver treats absence-of-row as default.
--
-- Stale-override rule: if the prompt is no longer reachable through any
-- inheritance source the row simply has no effect — we deliberately don't
-- auto-clean it up to avoid races between bulk role edits and per-task
-- toggling. Harmless rows cost almost nothing.

CREATE TABLE IF NOT EXISTS task_prompt_overrides (
  task_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, prompt_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_prompt_overrides_task ON task_prompt_overrides(task_id);
