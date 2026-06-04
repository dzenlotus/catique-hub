-- 035_activity_log_scope.sql — refactor-v3 D-D.
--
-- Extends the transient `change_events` table introduced in 028 with
-- the columns needed to make it a durable per-scope activity log:
--
--   * `scope_kind` — `"global" | "space" | "board" | "column" | "task"
--                   | "role" | "prompt" | "skill" | "mcp_server"`.
--                   Defaulted to `'global'` so existing rows (none in
--                   practice — the bus is purged minute-by-minute) are
--                   surfaceable via the global query.
--   * `scope_id`   — entity id matching the kind. NULL for global.
--   * `count`      — Tier-3 compaction counter (D-D §Compaction).
--                   1 by default; bumped in-place when an edit event
--                   for the same `(scope_kind, scope_id, name)` lands
--                   within the 5-minute debounce window.
--
-- The covering index supports the canonical per-scope read pattern:
--
--   SELECT … FROM change_events
--   WHERE scope_kind = ?1 AND scope_id [IS|=] ?2
--   ORDER BY ts DESC LIMIT ?3
--
-- which `event_log::recent_events_by_scope` issues. SQLite stores
-- DESCENDING index entries to make the ORDER BY ts DESC a no-sort scan.

ALTER TABLE change_events ADD COLUMN scope_kind TEXT NOT NULL DEFAULT 'global';
ALTER TABLE change_events ADD COLUMN scope_id   TEXT;
ALTER TABLE change_events ADD COLUMN count      INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_change_events_scope_created
  ON change_events(scope_kind, scope_id, ts DESC);
