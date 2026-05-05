# ADR-0007 — External MCP Server Registry vs Pass-Through Proxy (ctq-114)

**Status:** Accepted
**Date:** 2026-05-05
**Author:** tech-analyst agent
**Roadmap item:** ctq-114
**Unblocks:** ctq-115 (`mcp_servers` schema), ctq-126 (registry MCP tools)

---

## Context

`McpTool` (`crates/domain/src/mcp_tool.rs:12–21`) stores only `name + schema_json + cosmetic fields`. It has no `server_url`, no `transport`, no `auth` pointer. The `McpToolsPage` sidebar (`src/widgets/mcp-tools-page/McpToolsPage.tsx:34`) already labels the entity "MCP SERVERS" — reflecting the unresolved conceptual gap identified in the skills-mcp-proxy audit (F-07, P0; `docs/audit/skills-mcp-proxy-ideas-audit.md:89–99`).

The sidecar (`sidecar/index.js:46–57`) responds only to `ping` and `shutdown`. No MCP SDK is present. ADR-0002 (`docs/adr/ADR-0002-mcp-sidecar-architecture.md:8`) explicitly scopes the real bridge to E5.

ctq-78 positions Catique HUB as vendor-agnostic: it must work alongside Claude Code, Cursor, Qwen, or any agent that speaks MCP. The question is **how** that positioning is delivered:

- **Option A — Registry-only:** Catique HUB stores connection metadata; the calling agent connects to upstream MCP servers directly.
- **Option B — Pass-through proxy:** Catique HUB sidecar fan-outs to upstream servers, merging their tool surfaces and relaying all calls.
- **Option C — Hybrid:** registry by default; opt-in proxy per server.

---

## Trade-off Matrix

| Axis | Registry-only (A) | Pass-through proxy (B) | Hybrid (C) |
|---|---|---|---|
| **Fit to vendor-agnostic positioning (ctq-78)** | Good — hub stays metadata-only; any agent can consume the registry | Best — single merged tool list, agents need no connection logic | Good — same as A by default |
| **Auth/secrets blast radius** | Low — upstream tokens never enter HUB process; OS keychain ref or env-ref stored; raw token never in DB | High — HUB process holds all upstream tokens; a compromise of the sidecar exposes all credentials | Medium — proxy surfaces only where explicitly opted in |
| **Token-cost amplification** | Zero — HUB is not in the request path; agent pays upstream context directly | 100 % — every upstream call passes through HUB sidecar, doubling transport hops | Partial — only proxied servers add a hop |
| **Latency overhead per call** | 0 ms (HUB not in path) | ~2–10 ms additional round-trip over stdio JSON-RPC (ADR-0002 cold-start 20–40 ms; per-call IPC overhead estimated < 5 ms on localhost stdio) | 0 ms for registry servers; ~2–10 ms for proxied servers |
| **Failure modes** | Upstream server down: only that server's tools fail; HUB bridge stays reachable | Upstream server down: sidecar hangs or errors on that route; supervisor (≤ 3 restarts / 60 s per `crates/sidecar/src/lib.rs:84–88`) may mark HUB Crashed, taking the entire bridge offline | Partial blast radius |
| **Implementation cost (v1)** | S — new `mcp_servers` table + `McpServer` domain type + 2 IPC read commands + 2 MCP tool exposures | XL — `@modelcontextprotocol/sdk` integration in sidecar, auth-token store, SSE/http/stdio multiplexer, streaming passthrough, error mapping | M–L — must build both paths; adds branching complexity for little v1 gain |
| **Maintenance cost** | Low — auth rotation is the user's concern; HUB only stores the keychain entry name | High — auth rotation logic lives in HUB; transport upgrades (e.g. MCP SSE → Streamable HTTP) must be ported to the sidecar | Medium |
| **Extensibility (stdio/http/sse mix)** | Good — registry stores `transport` field; agent picks the right SDK; HUB is agnostic | Complex — sidecar must implement all three client transports to connect outward | Good for registry side |
| **Elastic 2.0 / hosted-service prohibition** | Safe — HUB relays no content, only metadata; strictly outside "providing the software as a service" | At risk — if HUB is run in a multi-user or networked context and relays upstream traffic, it may cross the hosted-service threshold | Registry path is safe; proxy path carries same risk as B |

---

## Decision

**Option A — Registry-only** is selected for v1.

### Decisive axis

**Auth/secrets blast radius + failure-mode coupling.** The proxy model puts upstream credentials inside the HUB sidecar process and wires upstream availability into Catique HUB's own health status. The sidecar supervisor (`crates/sidecar/src/lib.rs:84`) already limits auto-restarts to 3 within 60 s; a flaky upstream server consuming those restarts could take the entire MCP bridge offline. The registry model keeps the blast radius inside the calling agent's process, which already holds the session credentials and can handle partial upstream unavailability without affecting HUB.

### Auth-storage decision

Upstream connection credentials MUST be stored as one of:
- An **OS keychain reference** (the string key under which the token is stored in the OS keychain — e.g. `"catique.mcp.github_mcp_token"`).
- An **environment-variable name** (e.g. `"GITHUB_TOKEN"`).

Raw tokens MUST NOT appear in `mcp_servers.auth_json`. The column stores only the reference type + reference key as a JSON object: `{"type": "keychain", "key": "..."}` or `{"type": "env", "key": "..."}`. This matches the locked constraint in the task brief.

### Rationale

1. **Personal-tool ethos wins ties** (project invariant). Registry requires zero new stateful services; the `mcp_servers` table is SQLite and is read-only from the agent's perspective.
2. **Vendor-agnostic positioning is served equally well.** Claude Code, Cursor, and Qwen all implement MCP client transports natively. Returning connection metadata is sufficient for them to establish their own sessions. HUB does not need to be the router.
3. **Implementation cost is S vs XL.** The proxy requires full `@modelcontextprotocol/sdk` client integration (F-08 is currently XL work per audit line 106), auth token lifecycle management, and per-transport multiplexing. Registry is a new table + 2 read tools.
4. **Elastic 2.0 compliance is unambiguous.** Registry mode: HUB relays no upstream content, zero data-relay business. Proxy mode: legal review required before shipping.

Pass-through proxy remains the natural E6 upgrade once the registry pattern is proven and once ctq-126 tooling shows which servers users actually attach — providing real demand signal before the XL investment.

---

## Implementation Outline for ctq-115

### `013_mcp_servers.sql` (pseudo-DDL — not production code)

```sql
CREATE TABLE mcp_servers (
    id          TEXT    NOT NULL PRIMARY KEY,  -- nanoid, same pattern as other entities
    cat_id      TEXT    NOT NULL REFERENCES cats(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    description TEXT,
    server_url  TEXT    NOT NULL,              -- e.g. "https://api.example.com/mcp"
    transport   TEXT    NOT NULL               -- CHECK(transport IN ('http','sse','stdio'))
                CHECK(transport IN ('http','sse','stdio')),
    auth_json   TEXT,                          -- NULL = no auth required
                                               -- non-NULL = {"type":"keychain"|"env","key":"..."}
                                               -- MUST NOT contain a raw token value
    enabled     INTEGER NOT NULL DEFAULT 1    CHECK(enabled IN (0,1)),
    position    REAL    NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX mcp_servers_cat_id ON mcp_servers(cat_id);
```

Constraint note: `auth_json` validation (rejecting raw tokens) belongs at the application layer, matching the existing `schema_json` validation pattern in `crates/application/src/mcp_tools.rs:154–160`.

### New domain type (sketch)

```rust
// crates/domain/src/mcp_server.rs
pub struct McpServer {
    pub id: String,
    pub cat_id: String,
    pub name: String,
    pub description: Option<String>,
    pub server_url: String,
    pub transport: McpTransport,   // enum: Http | Sse | Stdio
    pub auth_json: Option<String>, // keychain-ref or env-ref JSON only
    pub enabled: bool,
    pub position: f64,
    pub created_at: i64,
    pub updated_at: i64,
}
```

### Repository (new — `McpServerRepository`)

Functions required for v1: `create`, `list_by_cat`, `get_by_id`, `update`, `delete`.

### IPC commands (new — `crates/api/src/handlers/mcp_servers.rs`)

- `list_mcp_servers(cat_id)` — returns `Vec<McpServer>` (auth_json included; frontend must not display the raw value).
- `get_mcp_server_connection_hint(server_id)` — returns `{ server_url, transport, auth_ref: { type, key } }`. The MCP tool `get_mcp_server_connection_hint` (ctq-126) will wrap this.

### MCP surface (ctq-126 scope)

Two new tools on the sidecar's MCP surface:
- `list_mcp_servers` — returns connection metadata array for the active cat.
- `get_mcp_server_connection_hint` — returns single server's URL, transport, auth reference for the caller to establish a direct connection.

Neither tool relays upstream calls.

---

## Acceptance Criteria for ctq-115 (`mcp_servers` schema + repo)

**AC-1.** Migration `013_mcp_servers.sql` applies cleanly on top of `010_backfill_default_boards.sql` with no FK violations on a fresh DB and on a DB seeded with at least one cat.

**AC-2.** `McpServerRepository::create` rejects a record where `auth_json` contains a key named `"token"`, `"secret"`, or `"password"` at the application layer (same guard pattern as `schema_json` validation in `mcp_tools.rs:154`).

**AC-3.** `transport` column rejects any value outside `('http','sse','stdio')` — enforced by the SQLite `CHECK` constraint; a direct SQL INSERT with `transport = 'grpc'` returns a constraint error.

**AC-4.** `list_by_cat(cat_id)` returns only rows belonging to the given cat; inserting a server for cat-A and querying for cat-B returns an empty list.

**AC-5.** Deleting a cat cascades to delete its `mcp_servers` rows (FK `ON DELETE CASCADE`); verify by count before and after.

**AC-6.** `get_by_id` returns `None` for a server belonging to a different cat than the one in session context (application-layer ownership check, not just DB query).

**AC-7.** `enabled = 0` servers are returned by `list_by_cat` with `enabled: false`; the MCP tool `list_mcp_servers` MUST filter out disabled servers before returning to the calling agent.

---

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | Agent does not support the `keychain`-ref pattern and expects a raw token | Medium — agents have varying auth-injection models | High — server is unreachable | Document the `env`-ref alternative (`{"type":"env","key":"MY_TOKEN"}`); most agents resolve env vars at session start |
| R-2 | `transport = 'stdio'` servers cannot be reached by a remote agent (process-local only) | Medium — stdio MCP servers are common in developer tooling | Medium — silent connection failure | Add a UI warning when `transport = 'stdio'` is selected: "stdio servers are only reachable by local processes" |
| R-3 | Registry grows stale: server URL changes, cert expires, auth key rotates — HUB never knows | High over time | Low per incident — agent errors on connect, not on HUB | `enabled` flag allows quick disable; future `last_verified_at` column (out of scope v1) can surface staleness |

---

## Liability / Elastic 2.0 Note

Registry mode keeps Catique HUB strictly out of the data-relay business. The application stores only connection metadata (URL, transport type, keychain-reference key). No upstream MCP traffic — prompts, tool inputs, tool outputs — passes through the HUB process. This is materially different from the pass-through proxy model, which would relay user content through a service layer.

Under the Elastic License 2.0's restriction on "providing the functionality of the licensed software to third parties as a hosted service," registry-only is safe: the software manages a local metadata table; the upstream interaction is entirely between the agent runtime and the upstream MCP server. No legal review is required for v1. The proxy model would require legal review before shipping in any networked or multi-user context.

---

## Open Questions for the Engineer

| # | Question | Blocking |
|---|---|---|
| OQ-1 | Which migration numbers (011, 012) are reserved for in-flight work before ctq-115 ships? Confirm `013_mcp_servers.sql` is the correct filename or adjust to the next available slot. | Yes — before writing the migration file |
| OQ-2 | Should `auth_json` application-layer validation use an allowlist (`{"type","key"}` only) or a denylist (reject known secret key names)? Allowlist is stricter and simpler to audit. | Yes — before `McpServerRepository::create` |
| OQ-3 | For `transport = 'stdio'`, `server_url` is meaningless — it would be a binary path + args. Should the schema use a separate `command` column, or encode the command in `server_url` with a `stdio://` scheme? | Yes — schema design |
| OQ-4 | ctq-126 scopes `list_mcp_servers` and `get_mcp_server_connection_hint` as MCP surface tools. Confirm whether these tools should appear on the sidecar's tool surface immediately in E5, or only after the registry has at least one enabled server. | Before E5 MCP bridge work |

---

## Related

- ADR-0002 — MCP Sidecar Architecture (`docs/adr/ADR-0002-mcp-sidecar-architecture.md`) — sidecar lifecycle; E5 bridge is deferred
- Audit — Skills / MCP Proxy / Ideas (`docs/audit/skills-mcp-proxy-ideas-audit.md`) — F-07, F-09, F-11 are the root findings this ADR resolves
- Implementation: `crates/domain/src/mcp_tool.rs` — existing `McpTool` shape (no server connection fields)
- Downstream: ctq-115 (`mcp_servers` schema), ctq-126 (proxy/list MCP tools)
