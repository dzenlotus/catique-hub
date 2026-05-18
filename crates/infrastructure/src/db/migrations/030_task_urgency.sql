-- 030_task_urgency.sql — per-task urgency level (catique-8).
--
-- Four levels in priority order:
--   * `none`   — default; card renders without colour accent
--   * `low`    — green badge / accent
--   * `medium` — yellow badge / accent
--   * `high`   — red badge / accent
--
-- Stored as TEXT with a CHECK constraint rather than as an enum table
-- so we keep the cost of a join out of the task-list hot path; the
-- vocabulary is tiny and stable. Extending it is a one-line CHECK
-- change in a future migration.
--
-- This migration is intentionally additive — existing rows backfill to
-- `'none'` via the DEFAULT so no row needs touching. Repository SELECT
-- updates land in the same wave; until then the column lives as an
-- inert column read by dedicated `get_urgency` / `set_urgency` helpers.

ALTER TABLE tasks
  ADD COLUMN urgency TEXT NOT NULL DEFAULT 'none'
    CHECK (urgency IN ('none','low','medium','high'));

CREATE INDEX IF NOT EXISTS idx_tasks_urgency
  ON tasks(urgency)
  WHERE urgency <> 'none';
