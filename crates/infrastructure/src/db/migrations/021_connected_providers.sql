-- 021_connected_providers.sql — round-21 Connected Providers refactor.
--
-- 1. Lands the `connected_clients` table that backs the new
--    `add_provider` / `remove_provider` IPC pair. A row exists ⇔ the
--    user has explicitly added that provider to Catique HUB. Removal
--    deletes the row (after `provider.remove()` succeeds).
--
-- 2. Adds the `connected_providers_first_launch_done` settings KV
--    slot (consumed by the first-launch zero-state bootstrap).
--
-- The previous "registry-on-disk JSON" path
-- (`~/.catique-hub/connected-clients.json`) is replaced. The
-- application layer stops reading the old file going forward; we do
-- not migrate from it because the round-21 model is "first launch
-- detects, then user manages" — nothing on disk would survive the
-- semantic shift even if we tried.
--
-- `client_instructions` was a planned domain concept that never
-- materialised as a SQL table (the app only ever read/wrote the
-- on-disk file `~/.<client>/CLAUDE.md`). Round-21 drops the feature
-- end-to-end, so there is nothing to ALTER away here.
CREATE TABLE IF NOT EXISTS connected_clients (
    -- Provider id (kebab-case, e.g. `claude-code`). Also the PK so
    -- adding the same provider twice is a UNIQUE-violation noop.
    id                  TEXT PRIMARY KEY,
    -- Cached human-readable display name at the time of `add_provider`.
    -- Refreshed by the application layer when the provider id is
    -- re-detected; we do not foreign-key onto a separate `providers`
    -- table because `id` is the source of truth.
    display_name        TEXT NOT NULL,
    -- Last reported sync state for THIS provider —
    -- `'connected' | 'syncing' | 'error'`. Defaults to `'connected'`
    -- because a row only exists once the user explicitly added the
    -- provider AND the initial sync succeeded.
    connection_status   TEXT NOT NULL DEFAULT 'connected',
    -- Wall-clock millis of the most recent successful sync. `0` when
    -- no sync has run yet.
    last_synced_at      INTEGER NOT NULL DEFAULT 0,
    -- When the row was first inserted. Wall-clock millis.
    created_at          INTEGER NOT NULL,
    -- When the row was last updated. Wall-clock millis.
    updated_at          INTEGER NOT NULL,
    -- Last error message captured during sync; `NULL` when status is
    -- `'connected'`. Surfaced to the UI as a lightweight banner; the
    -- repository layer truncates oversized payloads to 1 KB to keep
    -- the column bounded.
    last_error          TEXT NULL
);

INSERT OR IGNORE INTO settings (key, value, updated_at)
    VALUES ('connected_providers_first_launch_done', 'false', 0);
