-- 023_mcp_tools_link.sql — link mcp_tools rows to their upstream server
-- (ADR-0008 / ctq-128 / PROXY-S1).
--
-- Background
-- ==========
-- Pre-ADR-0008 `mcp_tools` was a flat registry of hand-authored tool
-- definitions: the user typed a name, description, schema_json. Under
-- ADR-0008 the proxy model introspects each registered MCP server's
-- `tools/list` at create-time and persists one row per upstream tool.
-- We keep the legacy "manual" path for backward compat (the existing
-- `McpToolCreateDialog` still mints those rows) and tag each row with
-- a `source` discriminator.
--
-- New columns
-- ===========
-- * `server_id` — FK to `mcp_servers(id)`. NULL for `source = 'manual'`
--   rows. ON DELETE CASCADE so deleting a server clears its
--   introspected tools.
-- * `upstream_name` — the unqualified tool name as the upstream MCP
--   server sees it (e.g. `create_issue`). May differ from local
--   `name` (which is what the UI displays — for upstream rows we
--   default to the qualified `{server_name}.{tool_name}`).
-- * `source` — `'upstream'` for tools introspected from an MCP server,
--   `'manual'` for tools the user typed in by hand. Default `'manual'`
--   keeps every pre-existing row valid.
-- * `last_synced_at` — Unix-ms timestamp of the most recent successful
--   introspection that touched this row. NULL means "soft-deleted from
--   upstream" (the row stays for audit, but the refresh step set it
--   NULL to indicate the upstream no longer advertises this tool).
--   The UI strikes through soft-deleted rows; new role attachments
--   filter them out.
--
-- Idempotency
-- ===========
-- SQLite's `ALTER TABLE ADD COLUMN` is idempotent only via the
-- `_migrations` ledger; running this file twice would error. The
-- runner's SHA gate prevents that. No `IF NOT EXISTS` clause is
-- supported on column additions, so the standard pattern is "trust
-- the ledger".

ALTER TABLE mcp_tools
  ADD COLUMN server_id TEXT
    REFERENCES mcp_servers(id) ON DELETE CASCADE;

ALTER TABLE mcp_tools
  ADD COLUMN upstream_name TEXT;

ALTER TABLE mcp_tools
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
    CHECK(source IN ('upstream','manual'));

ALTER TABLE mcp_tools
  ADD COLUMN last_synced_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_mcp_tools_server_id
  ON mcp_tools(server_id);

-- Partial index for the refresh-reconciliation hot path: scanning all
-- live upstream rows for a server when comparing against a fresh
-- `tools/list` reply.
CREATE INDEX IF NOT EXISTS idx_mcp_tools_upstream_live
  ON mcp_tools(server_id, upstream_name)
  WHERE source = 'upstream' AND last_synced_at IS NOT NULL;
