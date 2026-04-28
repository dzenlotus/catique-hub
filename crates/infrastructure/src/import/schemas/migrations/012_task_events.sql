-- 009_task_events
-- Activity log: every task mutation appends a row to task_events. Pure
-- append-only; the task_id FK with ON DELETE CASCADE drops history along
-- with the task itself. `details_json` is a free-form blob with shape
-- specific to `type` (e.g. {old_column_id, new_column_id} for moves).
--
-- The composite index on (task_id, created_at DESC) backs the dialog
-- timeline query — newest-first listing for one task is the only access
-- pattern today.

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor TEXT,
  details_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_created
  ON task_events(task_id, created_at DESC);
