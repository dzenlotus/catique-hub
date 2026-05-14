# ADR-0008 — MCP Pass-Through Proxy (supersedes ADR-0007)

**Status:** Accepted — **implementation complete** (2026-05-12)
**Date:** 2026-05-12
**Author:** Catique HUB team
**Supersedes:** ADR-0007 (`docs/adr/ADR-0007-mcp-server-registry.md`)
**Roadmap items affected:** ctq-114 (revisited), ctq-115 (auth-storage clause flipped), ctq-126 (closed 2026-05-12)

## Implementation status (added 2026-05-12)

Functionally complete on branch `catique/audit-roadmap-spike`. The seven sub-tasks of ctq-126 (PROXY-S1 through PROXY-S7) merged in a single session; see the commit chain below and the per-task summary reports in Promptery for details.

| Task | Slug | Status | Commits |
|---|---|---|---|
| Migrations 022/023/024 + keychain namespace | ctq-128 (PROXY-S1) | Done | `a852c3b` / `b4fec32` |
| Node outbound MCP client pool | ctq-129 (PROXY-S2) | Done | `068d182` |
| Rust outbound channel + `McpProxyUseCase` | ctq-130 round 1 (PROXY-S3) | Done | `b95b797` |
| Real OS-keychain backend (keyring crate) | ctq-130 round 2 (PROXY-S3) | Done | `b4fec32` |
| `list_proxied_tools` + `status` + `list_tools_by_server` | ctq-131 round 1 (PROXY-S4) | Done | `a16efc9` |
| Introspect-on-create + refresh + reconciliation | ctq-131 round 2 (PROXY-S4) | Done | `c3ee096` |
| Bridge dispatch arms | ctq-132 (PROXY-S5) | Done (folded into S3 round 1) | `b95b797` |
| MCP servers page + create-dialog rewrite | ctq-133 (PROXY-S6) | Done | `46cb7e6` |
| Adapter single-entry mcp.json + role-file XML | ctq-134 (PROXY-S7) | Done | `f4cf54d` |

**Open follow-ons tracked on `v0.9 MCP Sidecar`:**
- **ctq-135 (PROXY-S8)** — auth wiring end-to-end (Node-side `resolve_keychain` + bridge `store_secret` + dialog field). Backend is ready; UI marker `TODO(proxy-s3-r2)` in `mcp-server-create-dialog`.
- **ctq-136 (PROXY-S9)** — role-editor MCP tree picker + sentinel-row wildcard for whole-server attachment.

**Lower-priority hygiene items**, not blocking ctq-126 close-out (see parent task summary report for the full list): pre-existing tsc baseline fix-up, `keyring` 3.6.3 → 4.0.1 dep bump, drop the now-redundant `mcp_server_tools` join table, `notifications/tools/list_changed` push from Rust on refresh.

---

## TL;DR

ADR-0007 picked **Option A — registry-only** for v1: Catique HUB stores connection metadata for upstream MCP servers; external agents establish sessions and resolve credentials themselves. That decision was wrong against the actual product intent. Catique HUB is supposed to be the **single configuration surface and the single relay** for MCP — the external agent only ever talks to Catique HUB, never to the upstream server directly. This ADR flips the decision to **Option B — pass-through proxy** (with the introspection workflow ADR-0007 omitted) and lists the deltas against the just-shipped registry implementation.

---

## What the product actually requires

Reconstructed from product intent (2026-05-12 user statement):

1. **Create-time introspection.** When the user creates an MCP server in Catique HUB (modal: type, URL/command, credentials), the app immediately:
   * connects to the upstream server using the supplied credentials;
   * issues the MCP `initialize` + `tools/list` handshake;
   * persists the tool inventory locally (`mcp_tools` rows, one per upstream tool) with each tool's `inputSchema` + description;
   * auto-generates the per-tool prompt block (the XML/markdown the LLM agent will see) from the inventory.
   The user does not type any tool descriptions by hand. The MCP server, on creation, appears in the UI as a **group** with the live tool list and a status indicator (green = healthy, red = unreachable / contract mismatch).

2. **Refresh on contract drift.** A "refresh" action on the MCP group re-runs `tools/list` against the upstream and reconciles: new tools added, removed tools soft-deleted (kept for audit, hidden from new roles), changed schemas flagged for review.

3. **Role-level granularity.** A Role can attach either an entire MCP server ("Atlassian.*") or a hand-picked subset of its tools ("Atlassian.create_issue + .list_issues"). The role-sync output (`catique-{role_id}.md` / `.mdc`) regenerates with one XML block per attached tool, containing only the metadata the LLM needs to invoke that specific tool through Catique HUB.

4. **Run-time relay.** When the external agent (Claude Code, Codex, OpenCode) needs to call a tool listed in its role file, it issues an MCP `tools/call` to **our sidecar**. Our sidecar dispatches into the Rust use-case, which:
   * resolves the registered upstream server for that tool;
   * loads the credentials from our OS keychain (under our key);
   * opens or reuses a session against the upstream server using the upstream's native MCP client (stdio / HTTP / SSE);
   * forwards `tools/call` upstream;
   * returns the result back to the calling agent as if Catique HUB were the origin server.
   The external agent has **no knowledge** of the upstream server — its only MCP endpoint is Catique HUB.

5. **Single configuration surface.** The user configures any MCP server exactly once, in Catique HUB. Adapter writes (Claude Code's `mcp.json`, Codex's config, OpenCode's manifest) only ever list **one** MCP server entry: Catique HUB itself.

This is the model the user always intended. ADR-0007 reconstructed a different model (registry-only) from an audit document and assumed it because the cost matrix was friendlier. It was the wrong call.

---

## Decision

**Option B — pass-through proxy** for v1, *with* the create-time introspection workflow ADR-0007 did not contemplate.

### What stays from ADR-0007 implementation

| Asset | Verdict |
|---|---|
| `mcp_servers` table schema (`crates/infrastructure/src/db/migrations/013_mcp_servers.sql`) | **Stays.** Same columns work; semantics of `auth_json` change (see below). |
| `McpServer` domain struct (`crates/domain/src/mcp_server.rs`) | **Stays.** Transport enum, command/url split, position, enabled flag — all reusable. |
| `McpTool` domain struct (`crates/domain/src/mcp_tool.rs`) | **Stays.** Becomes the storage layer for the tool inventory pulled from upstream `tools/list`. |
| `McpServersUseCase::list` / `create` / `update` / `delete` | **Stays as the CRUD layer.** `create` gains a synchronous introspection side-effect (see Implementation). |
| Sentinel-byte multiplexed sidecar transport (`crates/sidecar/src/lib.rs`) | **Stays.** This was the right call regardless of proxy vs registry. |
| `mcp_bridge` dispatch table (`crates/api/src/mcp_bridge/mod.rs`) | **Stays for the Catique-native tools** (`list_boards`, `get_task_bundle`, etc.). The MCP-server tools (`list_mcp_servers`, `get_mcp_server_connection_hint`) become internal-only, hidden from the external tool surface. |

### What flips

| Element | ADR-0007 (registry) | ADR-0008 (proxy) |
|---|---|---|
| `auth_json` semantics | Reference only (`{"type":"keychain","key":"…"}` or `{"type":"env","key":"…"}`). Raw token forbidden. | Reference points to a secret **we own** (OS keychain entry under `catique.mcp.{server_id}` namespace). User pastes the raw token in the modal; Catique writes it to keychain under our key; DB stores only the reference. |
| Upstream connection | Never. Agent does it. | Catique sidecar opens it on create (for `tools/list`), on health-poll, and on every `tools/call` relay. |
| Tool inventory | Not stored. | Stored as `mcp_tools` rows linked to the server, regenerated on refresh. |
| Tool surface exposed to external agents | `list_mcp_servers` + `get_mcp_server_connection_hint` (gives them the upstream URL). | `tools/list` returns the merged inventory across all enabled MCP servers, each tool namespaced as `{server_name}.{tool_name}`. Catique appears to the agent as a single MCP server. |
| `tools/call` from external agent | N/A — agent calls upstream directly. | Routed by sidecar into Rust → resolved to a (server, tool) pair → relayed upstream using the stored creds → response returned to caller. |
| Role-sync output | Lists upstream server connection metadata. | Lists tool-level XML blocks (one per attached tool) pointing the agent at Catique's own MCP endpoint. |
| `ClientAdapter::write_mcp_config` (where it exists) | Writes each upstream as a separate entry. | Writes a single entry: Catique HUB itself. |

### The four ADR-0007 risk axes — revisited

ADR-0007 used four axes to reject proxy. Each is re-examined under the actual product model:

1. **Auth blast radius.** *ADR-0007:* "HUB process holds all upstream tokens; a compromise of the sidecar exposes all credentials." *Mitigation:* the OS keychain is the canonical store; the sidecar pulls one secret at a time on demand (no in-memory cache beyond the active call). Compromise of the running sidecar exposes only the secrets used during its lifetime, not the whole inventory. Decryption-at-rest is the OS's keychain, not ours.

2. **Failure coupling.** *ADR-0007:* "A flaky upstream consuming restart budget could take the entire bridge offline." *Mitigation:* relay failures **must not** propagate to the supervisor heartbeat. The supervisor's `__ping` (`crates/sidecar/src/lib.rs:84`) is independent of `tools/call`. A `tools/call` to a dead upstream returns `isError: true` to the calling agent and increments a per-server failure counter; the bridge keeps running. The 3-restart / 60s policy applies only to sidecar process death, not to upstream failures.

3. **Implementation cost.** *ADR-0007:* "S vs XL." Accepted. Proxy is XL. This work is the product, not a cost-saving deferral. The cost was always going to land — ADR-0007 deferred it by mis-scoping the v1 surface.

4. **Elastic 2.0.** *ADR-0007:* "May cross the hosted-service threshold if HUB runs in a networked context and relays upstream traffic." *Mitigation:* Catique HUB ships as a personal desktop tool. Relay happens in-process on the user's own machine using the user's own credentials. This is no different from any local MCP client (Claude Code itself relays the agent's `tools/call` through its own process to the upstream server). The Elastic 2.0 "providing the software as a service" clause targets multi-tenant hosted deployments, not on-device proxying. A clause in the release runbook explicitly forbids running Catique HUB as a shared network service.

---

## Implementation deltas — what needs to change in code

Listed by surface, with the file path for each. None of this is implemented yet on `catique/audit-roadmap-spike`; everything below is the next round of work, blocked on this ADR landing.

### Database

1. **Migration `022_mcp_keychain_namespace.sql`** — `auth_json` semantics flip is **not** a schema change but the validation rule in `McpServersUseCase` flips: `keychain` reference key must be under the `catique.mcp.{server_id}` namespace (enforced on write). Pre-existing rows (if any) are migrated to the new namespace; rows referencing `env:*` are kept as escape hatch for users who insist.

2. **Migration `023_mcp_tools_link.sql`** — add `mcp_tools.server_id TEXT REFERENCES mcp_servers(id) ON DELETE CASCADE` (nullable for backward compat with hand-authored tools). Add `mcp_tools.upstream_name TEXT` (the `{server_name}.{tool_name}` qualified name as the upstream sees it; may differ from local display `name`). Add `mcp_tools.source TEXT CHECK(source IN ('upstream','manual')) NOT NULL DEFAULT 'manual'`. Add `mcp_tools.last_synced_at INTEGER`.

3. **Migration `024_mcp_call_log.sql`** — new table for relay observability:
   ```
   mcp_call_log(id, server_id, tool_name, started_at, finished_at, success INTEGER, error TEXT, bytes_in, bytes_out)
   ```
   Keep a 7-day rolling window; drop older rows on every `tools/call` via a trigger or scheduled task.

### Sidecar (Node side)

1. `sidecar/index.js` — replace the current "tool surface comes from `tool-manifest.json`" path with two-stage dispatch:
   * Catique-native tools (read-side `list_boards` / `get_task_bundle` / …) still come from the manifest and still resolve through `ipc_call` to Rust.
   * MCP-proxied tools come from a runtime registry the Node side fetches via an `ipc_call("list_proxied_tools")` at startup (and on a `tools/list_changed` notification). For each `tools/call` against a proxied tool, Node calls `ipc_call("proxy_tool_call", { server_id, tool_name, args })` and returns the result.

2. New file `sidecar/upstream-clients.js` — pool of upstream MCP clients (stdio, HTTP, SSE) opened on demand using `@modelcontextprotocol/sdk` *client* API (we currently only use the *server* API). Owned by Node because the SDK is Node-only; Rust orchestrates lifecycle through `ipc_call` requests.

3. `sidecar/tool-manifest.json` — keep, but restrict it to the Catique-native tool surface only. Proxied tools live in the dynamic registry.

### Sidecar (Rust side)

1. `crates/sidecar/src/lib.rs:574-584` — the `TODO(ctq-126): forward to mcp_outbound channel` block becomes a real channel. The reader task pushes plain-MCP frames (the responses to outbound `tools/call`s) into a `tokio::sync::mpsc` keyed by JSON-RPC id, mirroring the supervisor `pending` map.

2. New `crates/sidecar/src/outbound.rs` — write side. `SidecarManager::call_upstream(server_id, tool_name, args)` issues an outbound frame and awaits the matching response. Same lifetime as the manager.

### Application

1. `crates/application/src/mcp_servers.rs` — `create` gains an `introspect_and_persist` step: on successful insert, asynchronously open a session against the upstream, fetch `tools/list`, persist into `mcp_tools` with `source = 'upstream'`. Failure of introspection does **not** roll back the server row — the row exists with status `Unreachable` until the next refresh.

2. New use-case `McpServersUseCase::refresh(server_id)` — re-runs introspection; reconciles: insert new, soft-delete missing, flag schema diffs.

3. New use-case `McpServersUseCase::status(server_id)` — last-known health, last sync timestamp, tool count. Backs the green/red dot in the UI.

4. New use-case `McpProxyUseCase::call(server_id, tool_name, args)` — the actual relay. Resolves keychain, opens or reuses sidecar's upstream client, issues `tools/call`, logs to `mcp_call_log`, returns result.

### Tauri IPC

1. New commands in `crates/api/src/handlers/mcp_servers.rs`:
   * `refresh_mcp_server(server_id)`
   * `get_mcp_server_status(server_id)`
   * `list_mcp_tools_by_server(server_id)` — backs the UI group list.

2. The existing `list_mcp_servers` / `get_mcp_server` stays for the UI; the registry-style `get_mcp_server_connection_hint` is **removed** from the external MCP tool surface (it was registry-only signalling).

### MCP bridge

`crates/api/src/mcp_bridge/mod.rs`:

1. `list_mcp_servers` / `get_mcp_server_connection_hint` — removed from the external tool surface. The external agent should not see them at all.

2. `proxy_tool_call(server_id, tool_name, args)` — added. Delegates to `McpProxyUseCase::call`.

3. The Node side calls `list_proxied_tools` (new dispatch entry) at startup to learn what tools to expose under `tools/list` to the external agent.

### Role-sync

1. `crates/clients/src/adapters/{claude_code,codex,opencode}.rs::render_role_file` — for each MCP tool attached to the role (whether via whole-MCP or cherry-picked), render an XML block:
   ```xml
   <mcp-tool server="catique" name="atlassian.create_issue">
     <description>...</description>
     <input-schema>...</input-schema>
   </mcp-tool>
   ```
   The agent learns from this block that the tool is reachable through the Catique MCP endpoint (which it already knows about — Catique is the single MCP entry in the adapter's config file).

2. `write_mcp_config` (the adapter method that mints `mcp.json` / equivalent) — collapses all configured MCP servers in Catique HUB into a single entry pointing at Catique HUB's sidecar. No upstream entries are written.

### UI (FSD slices)

1. **`widgets/mcp-tool-create-dialog`** → revisit. Today it creates a `McpTool` row by hand. Should become "Create MCP Server" (server-level), not "Create MCP Tool" (tool-level). Tool rows come from introspection, not user input.

2. **`widgets/mcp-tools-page`** → group view: each `McpServer` is a header with the live status dot, refresh button, and the list of its tools below. Clicking a tool shows its schema. Drag-from-tool-into-role for cherry-picking still works.

3. **`widgets/role-editor`** → MCP attachment becomes a tree: each MCP server is a parent node; tools are children. Whole-server attachment is a single click on the parent.

### Documentation

* This ADR (ADR-0008).
* ADR-0007 — add a banner at the top: "Superseded by ADR-0008 (2026-05-12)."
* `docs/audit/skills-mcp-proxy-ideas-audit.md` — re-tag F-07/F-09 as resolved by this ADR.

---

## Out of scope for this ADR

The following are explicit Phase-2 items, not blockers for proxy v1:

* Multi-tenant relay (network-mode Catique HUB serving multiple users). Explicitly forbidden by the Elastic 2.0 mitigation clause.
* Token cost / quota dashboard for relayed calls (would fit cleanly on top of `mcp_call_log`, but is a follow-on UI deliverable).
* Hot-reload of credentials without restarting the sidecar.
* Streaming `tools/call` responses (the current MCP spec is request/response; if a future tool requires streaming, the relay can pass it through, but we don't pre-build for it).
* Cross-server tool name collision policy beyond the `{server_name}.{tool_name}` qualifier (e.g., two servers exposing the same `search` tool — both stay distinguishable by namespace).

---

## Migration from the just-shipped registry implementation

Round-21 (the uncommitted working tree at the time of this ADR) shipped the registry-only path end-to-end: `list_mcp_servers` and `get_mcp_server_connection_hint` are wired through `mcp_bridge` and exposed to external agents.

The pragmatic sequence:

1. **Land round-21 as-is** so the working tree stops drifting (the rename + sidecar transport are correct under both ADRs; only the *surface* exposed by `mcp_bridge` needs to change).
2. **Strip the registry-only tools from the external surface** in a follow-on commit — `list_mcp_servers` / `get_mcp_server_connection_hint` keep their IPC bindings for internal UI use but are removed from `mcp_bridge::dispatch` and `tool-manifest.json`.
3. **Build introspection + relay** as the new ctq-126 (rewritten from the registry brief).
4. **Update ADR-0003** (adapter list) and **ADR-0005** (role-sync format) for the single-entry MCP config and the per-tool XML blocks.

Each step ships independently. No big-bang rewrite.

---

## References

* ADR-0002 (sidecar architecture) — supervisor + transport layer, unchanged by this ADR.
* ADR-0007 (registry-only) — superseded.
* `docs/audit/skills-mcp-proxy-ideas-audit.md` — F-07 (entity gap) and F-09 (proxy ideas) are resolved here.
* Roadmap: ctq-126 brief needs rewriting against this ADR before any code lands.
