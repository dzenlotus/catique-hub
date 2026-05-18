-- 028_change_events.sql — cross-process event bus.
--
-- Durable, append-only event log that lets the Tauri shell tail
-- mutations originated by ANY process touching the SQLite file
-- (notably the standalone `catique-hub-mcp` binary spawned by
-- external MCP clients) and fan them out to the UI as Tauri events
-- without any global cache invalidation.
--
-- Semantics:
--   * `seq`  — monotonic per-DB sequence (AUTOINCREMENT). Tail
--              readers track their last-seen seq and SELECT WHERE
--              seq > last; this gives exactly-once delivery to a
--              given reader independent of how many writers commit.
--   * `name` — event name in the existing `<domain>:<verb>` form
--              (`task:created`, `role:updated`, ...). Mirrors the
--              constants in `catique_api::events`.
--   * `payload` — JSON object, same shape the IPC handlers pass to
--              `events::emit`. Stored as TEXT (not JSON column) so
--              the runner stays cross-version.
--   * `ts`   — unix-millis at insert. Used only by the purge task
--              to GC rows older than 60 s.

CREATE TABLE IF NOT EXISTS change_events (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  payload  TEXT NOT NULL DEFAULT '{}',
  ts       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_change_events_ts ON change_events(ts);
