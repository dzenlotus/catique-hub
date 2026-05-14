-- 022_mcp_keychain_namespace.sql — flip auth_json keychain key into HUB
-- namespace (ADR-0008 / ctq-128 / PROXY-S1).
--
-- Background
-- ==========
-- Under ADR-0007 (registry-only) the `mcp_servers.auth_json` keychain
-- reference could point at any keychain entry the user chose:
--
--   {"type":"keychain","key":"catique.mcp.github_token"}
--   {"type":"keychain","key":"my-personal-vault.atlassian"}
--
-- The agent that resolved the secret was external (Claude Code etc.)
-- and looked it up in the caller's own keychain.
--
-- Under ADR-0008 (pass-through proxy) Catique HUB owns the keychain
-- write. The user pastes the raw token in the Create-MCP-Server modal;
-- HUB writes it to the OS keychain under `catique.mcp.{server_id}` and
-- persists only the reference in `auth_json`. To make the lookup
-- unambiguous, the keychain `key` must equal exactly
-- `catique.mcp.{server_id}` — the application-layer validator enforces
-- this on every write going forward.
--
-- What this migration does
-- ========================
-- For each existing row whose `auth_json.type = 'keychain'`, overwrite
-- the `key` to the HUB-namespace shape. The OLD keychain entry (under
-- whatever name the user chose) is NOT migrated — the secret stays
-- where it is, but Catique HUB will look under the new key from now on.
-- Operators must re-populate the OS keychain under `catique.mcp.{id}`
-- before the affected server can answer a `tools/call`.
--
-- Rows with `auth_json.type = 'env'` are untouched — env-var refs stay
-- as the escape hatch for users who insist.
--
-- Idempotency
-- ===========
-- Re-running on an already-migrated DB is a no-op because the UPDATE
-- WHERE clause only matches rows whose key does NOT already start with
-- `catique.mcp.`. SQLite's `json_extract` returns NULL for malformed
-- payloads, which a NULL-aware comparison treats as a non-match — safe
-- under any pre-existing data shape.

UPDATE mcp_servers
   SET auth_json = json_object('type', 'keychain', 'key', 'catique.mcp.' || id),
       updated_at = strftime('%s','now') * 1000
 WHERE auth_json IS NOT NULL
   AND json_extract(auth_json, '$.type') = 'keychain'
   AND (json_extract(auth_json, '$.key') IS NULL
        OR json_extract(auth_json, '$.key') != ('catique.mcp.' || id));
