/**
 * Upstream MCP client pool (ADR-0008 / ctq-129 / PROXY-S2).
 *
 * The sidecar plays two roles simultaneously:
 *
 *   * **MCP server** — speaks to the external agent (Claude Code etc.)
 *     over stdio via `StdioServerTransport`. Handled by `index.js`.
 *   * **MCP client** — speaks to upstream MCP servers registered in
 *     Catique HUB (Atlassian, GitHub, …). Handled by THIS module.
 *
 * Each unique `server_id` gets one cached client. Caching across calls
 * keeps the upstream transport warm (avoiding re-spawn of stdio
 * subprocesses on every tool call); the cache is cleared on sidecar
 * shutdown.
 *
 * Secret wiring is **not in this round.** PROXY-S2 round 2 (or
 * PROXY-S3 round 2 — see ctq-129 / ctq-130) plumbs the
 * `resolve_keychain` callback into transport headers / env. Until
 * then, upstream servers must be unauthenticated, OR ship credentials
 * out-of-band (e.g. baked into the stdio command).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

/**
 * @typedef {object} ServerMeta
 * @property {string} id             — `mcp_servers.id`.
 * @property {string} name           — display name.
 * @property {"stdio"|"http"|"sse"} transport
 * @property {string|null} url       — set for http / sse.
 * @property {string|null} command   — set for stdio; whitespace-split.
 */

/**
 * Build the transport for one server. The dispatch is closed by the
 * `mcp_servers.transport` CHECK; anything outside the three branches
 * is a schema-layer regression.
 *
 * For stdio: the `command` column carries `node /path/to/server.js`
 * or similar — split on whitespace into `[command, ...args]`. This is
 * deliberately naive; future versions may store a structured
 * `{command, args[]}` shape.
 *
 * @param {ServerMeta} meta
 */
function buildTransport(meta) {
  switch (meta.transport) {
    case "stdio": {
      if (!meta.command) {
        throw new Error(
          `mcp_server ${meta.id}: stdio transport requires command`,
        );
      }
      const parts = meta.command.trim().split(/\s+/);
      const [command, ...args] = parts;
      return new StdioClientTransport({ command, args });
    }
    case "http": {
      if (!meta.url) {
        throw new Error(
          `mcp_server ${meta.id}: http transport requires url`,
        );
      }
      return new StreamableHTTPClientTransport(new URL(meta.url));
    }
    case "sse": {
      if (!meta.url) {
        throw new Error(
          `mcp_server ${meta.id}: sse transport requires url`,
        );
      }
      return new SSEClientTransport(new URL(meta.url));
    }
    default:
      throw new Error(
        `mcp_server ${meta.id}: unknown transport "${meta.transport}"`,
      );
  }
}

/**
 * Cache entry. The `pending` field holds the in-flight `connect()`
 * promise so concurrent callers do not race to open two clients for
 * the same `server_id`.
 *
 * @typedef {object} ClientCacheEntry
 * @property {Client|null} client
 * @property {Promise<Client>|null} pending
 */

/**
 * Module-level cache. Keyed by `server_id`. Re-instantiating the pool
 * on every call would defeat connection reuse, so the state lives at
 * module scope; tests that need isolation call `_resetForTests` (only
 * exported under the test guard).
 *
 * @type {Map<string, ClientCacheEntry>}
 */
const cache = new Map();

/**
 * Get-or-create a connected MCP client for one upstream server.
 *
 * Idempotent: subsequent calls for the same `server_id` return the
 * cached client. Concurrent first-call races share the same
 * `connect()` promise; only one transport is opened.
 *
 * @param {ServerMeta} meta
 * @returns {Promise<Client>}
 */
export async function getClient(meta) {
  const cached = cache.get(meta.id);
  if (cached?.client) return cached.client;
  if (cached?.pending) return cached.pending;

  const transport = buildTransport(meta);
  const client = new Client(
    { name: "catique-sidecar-client", version: "0.1.0" },
    { capabilities: {} },
  );
  const pending = client.connect(transport).then(() => {
    cache.set(meta.id, { client, pending: null });
    return client;
  });
  cache.set(meta.id, { client: null, pending });
  return pending;
}

/**
 * List the tools an upstream server advertises. Returns the SDK's
 * raw `{ tools: [...] }` shape; PROXY-S4 introspection consumes this
 * via the supervisor channel.
 *
 * @param {Client} client
 */
export async function listUpstreamTools(client) {
  return client.listTools();
}

/**
 * Invoke `tools/call` against the upstream. Returns the upstream's
 * raw `{ content, isError? }` reply so the proxy can pass through
 * the `isError: true` signal verbatim — the SidecarUpstream adapter
 * on the Rust side detects it and maps to `UpstreamError::UpstreamIsError`.
 *
 * @param {Client} client
 * @param {string} toolName     unqualified upstream tool name
 * @param {object} args
 */
export async function callUpstreamTool(client, toolName, args) {
  return client.callTool({ name: toolName, arguments: args ?? {} });
}

/**
 * Close every cached upstream client. Called from `__shutdown` so
 * stdio child processes terminate cleanly.
 *
 * Each close is awaited individually; failures are logged but do not
 * abort the rest of the pool (one stuck upstream must not block
 * shutdown).
 *
 * @param {(msg: string) => void} log
 */
export async function closeAll(log) {
  const entries = Array.from(cache.entries());
  cache.clear();
  await Promise.all(
    entries.map(async ([id, entry]) => {
      try {
        if (entry.client) {
          await entry.client.close();
        }
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        log(`upstream-client[${id}] close error: ${msg}`);
      }
    }),
  );
}

/**
 * Test-only cache reset. Not part of the production surface.
 * @internal
 */
export function _resetForTests() {
  cache.clear();
}
