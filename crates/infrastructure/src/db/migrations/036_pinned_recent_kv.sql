-- 036_pinned_recent_kv.sql — refactor-v3 D-F.
--
-- Dedicated tables for the Project-Map sidebar's "Pinned" and "Recent"
-- sections, plus a note about the existing `settings` kv bucket. The
-- decision memo (docs/refactor-v3/decisions/D-F-pinned-recent-persistence.md)
-- picks Option 3 (dedicated tables) for entity-linked state because we
-- need ON DELETE CASCADE against `boards.id` — a generic kv row could
-- not enforce that without application-layer fixups on every board
-- delete.
--
-- Singletons (`last_active_space_id`, `sidebar_collapsed`, theme, …)
-- continue to live in the existing `settings(key, value, updated_at)`
-- table from `001_initial.sql`. This migration deliberately does NOT
-- recreate `settings` (or alias it as `kv_settings`): the existing
-- repository / IPC surface (`get_setting` / `set_setting`) is the
-- single source of truth and the schemas match the D-F spec already.
--
-- Schema:
--
--   pinned_boards.position is REAL so drag-to-reorder can use the
--   fractional-midpoint trick (matches `boards.position`). New pins
--   get max(position) + 1 — assigned by the application layer.
--
--   recent_boards has no cap column; eviction-to-five is enforced in
--   the `track_visit` write path via a follow-up DELETE statement (see
--   `repositories/pinned_recent.rs`).

CREATE TABLE IF NOT EXISTS pinned_boards (
  board_id   TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  position   REAL NOT NULL,
  pinned_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pinned_boards_position
  ON pinned_boards(position);

CREATE TABLE IF NOT EXISTS recent_boards (
  board_id   TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  visited_at INTEGER NOT NULL
);

-- The covering index supports the canonical read pattern:
--   SELECT board_id FROM recent_boards ORDER BY visited_at DESC LIMIT 5
CREATE INDEX IF NOT EXISTS idx_recent_boards_visited
  ON recent_boards(visited_at DESC);
