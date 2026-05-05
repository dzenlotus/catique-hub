-- 013_mcp_servers.sql — registry of external MCP servers (ctq-115).
--
-- Spec: ADR-0007 (Accepted 2026-05-05). Catique HUB does NOT proxy MCP
-- traffic; it stores connection metadata only and exposes it to calling
-- agents via IPC + the sidecar's MCP surface (ctq-126). Auth secrets
-- never enter this table — only references to where the secret lives
-- (OS keychain entry name, or environment-variable name).
--
-- Schema notes
-- ============
--   * `transport` is enumerated by CHECK to `('stdio','http','sse')`.
--     The set matches the MCP transports an upstream agent can speak;
--     adding a new transport requires a schema migration on purpose,
--     so we don't accidentally let an unsupported value reach the
--     calling agent.
--   * `url` and `command` are mutually exclusive and both nullable in
--     the column definitions. The CHECK at the bottom of the table
--     enforces the OQ-3 invariant from ADR-0007: stdio uses `command`
--     (binary path + args, no URL meaning), while http/sse use `url`.
--     Exactly one is set per row; the other must be NULL.
--   * `auth_json`, when non-NULL, MUST be the JSON encoding of one of
--     `{"type":"keychain","key":"..."}` or `{"type":"env","key":"..."}`.
--     The shape constraint is enforced at the application layer
--     (matches the existing `mcp_tools.schema_json` validation pattern
--     at `crates/application/src/mcp_tools.rs:154`); SQLite has no JSON
--     schema CHECK that would catch a `{"raw_token":"..."}` payload, so
--     the write-time guard in the use-case is the single source of truth.
--   * `enabled` is an integer boolean (SQLite has no native bool); rows
--     with `enabled = 0` are still returned by `list_*` so the UI can
--     render a disabled badge. The MCP surface (ctq-126) filters them
--     out before exposing to the calling agent.
--   * `mcp_server_tools` is a join table to the existing `mcp_tools`
--     registry — it lets a server advertise which tool definitions it
--     intends to host. Cascade on both sides keeps the join clean when
--     either side is deleted.
--
-- Idempotency
-- ===========
--   `IF NOT EXISTS` everywhere keeps re-runs safe on developer
--   workstations even if the runner's `_migrations` ledger gets
--   hand-edited during tests.

CREATE TABLE IF NOT EXISTS mcp_servers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  transport   TEXT NOT NULL CHECK(transport IN ('stdio','http','sse')),
  url         TEXT,
  command     TEXT,
  auth_json   TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK (
    (transport = 'stdio' AND command IS NOT NULL AND url IS NULL)
    OR
    (transport IN ('http','sse') AND url IS NOT NULL AND command IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled
  ON mcp_servers(enabled);

CREATE TABLE IF NOT EXISTS mcp_server_tools (
  server_id   TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  mcp_tool_id TEXT NOT NULL REFERENCES mcp_tools(id) ON DELETE CASCADE,
  PRIMARY KEY (server_id, mcp_tool_id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_server_tools_tool
  ON mcp_server_tools(mcp_tool_id);
