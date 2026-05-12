-- 024_mcp_call_log.sql — observability for proxied tool calls
-- (ADR-0008 / ctq-128 / PROXY-S1).
--
-- One row per `proxy_tool_call` invocation. Backs the green/red status
-- dot in the MCP server group view (the most recent row tells the UI
-- whether the upstream is healthy), the per-server failure counter that
-- decides when to flip a server's status to "Degraded", and any future
-- cost / quota dashboard (explicitly out-of-scope this round per
-- ADR-0008 §"Out of scope").
--
-- Retention
-- =========
-- Seven-day rolling window. A SQLite trigger after every insert prunes
-- rows older than 7 days from `started_at`. The trigger pays for itself
-- vs a scheduled VACUUM-aware sweep because the volume is bounded
-- (an interactive desktop user issues O(10²) calls/day, not O(10⁶)),
-- and the alternative (background task) adds lifecycle surface that
-- this round does not need. If volume ever exceeds the trigger's
-- amortised cost, swap in a scheduled sweep without changing the rest
-- of the schema.
--
-- Field semantics
-- ===============
-- * `success` — `1` for a clean upstream reply, `0` for any error
--   path (transport failure, upstream `isError: true`, keychain
--   resolve failure, …). `NULL` for an in-flight row (set before the
--   call returns; updated to 0 or 1 on completion).
-- * `error` — when `success = 0`, a short structured message
--   (`"upstream_timeout"`, `"keychain_missing"`, `"isError"`). Avoid
--   user-supplied content here so a flaky upstream cannot stuff this
--   column with arbitrary text. Must never contain a resolved secret.
-- * `bytes_in` / `bytes_out` — serialized JSON byte counts (rough
--   cost proxy). `NULL` if the relay failed before measuring.

CREATE TABLE IF NOT EXISTS mcp_call_log (
  id           TEXT PRIMARY KEY,
  server_id    TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  tool_name    TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER,
  success      INTEGER,
  error        TEXT,
  bytes_in     INTEGER,
  bytes_out    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mcp_call_log_started
  ON mcp_call_log(started_at);

CREATE INDEX IF NOT EXISTS idx_mcp_call_log_server_started
  ON mcp_call_log(server_id, started_at DESC);

-- Seven-day rolling window. Cleanup runs on every insert; cost is one
-- index seek + a bounded delete. The bound matters: AFTER triggers run
-- inside the same statement's implicit transaction, so a runaway
-- delete would block the insert. Limiting to the 7-day prefix bounds
-- the work; older rows would have been cleaned on previous inserts.
CREATE TRIGGER IF NOT EXISTS trg_mcp_call_log_prune
  AFTER INSERT ON mcp_call_log
BEGIN
  DELETE FROM mcp_call_log
   WHERE started_at < (NEW.started_at - 7 * 24 * 60 * 60 * 1000);
END;
