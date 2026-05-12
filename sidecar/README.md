# catique-sidecar

MCP server for Catique HUB. Lives inside the Tauri app's process tree as a Node child spawned via the `tauri::process::Command` API; speaks MCP over stdio plus a sentinel-byte-multiplexed supervisor channel back to the Rust host.

## What this is (ctq-112 / E5 round 1)

A Node MCP server built on `@modelcontextprotocol/sdk@1.29.0` (exact pin) that exposes a small read-side tool surface. Tool implementations live in **Rust use-cases** (`crates/application`); when an MCP client invokes a tool, the Node side forwards `(method, params)` back to Rust over the same stdio pipe — no Tauri IPC re-entry, no WebView round-trip.

Tool surface this round (5 tools):

| Tool | Rust use-case it dispatches to |
|---|---|
| `list_boards` | `BoardsUseCase::list` |
| `list_columns` | `ColumnsUseCase::list` |
| `list_tasks` | `TasksUseCase::list` |
| `get_task` | `TasksUseCase::get` |
| `get_task_bundle` | `TasksUseCase::resolve_task_bundle` |

The full inventory in `tool-manifest.json` is hand-authored for this iteration. `TODO(ctq-112-manifest-gen)` tracks the xtask-driven generator that will derive the manifest from the `#[tauri::command]` signatures.

## Wire protocol — sentinel-byte multiplexing

Both stdin and stdout carry **two** newline-delimited JSON streams over the same pipe (architect's R-1, Option B). Frames whose first byte is `\x01` (SOH) belong to the supervisor channel; everything else is plain MCP traffic for the SDK's `StdioServerTransport`.

Supervisor channel methods:

| Method | Direction | Purpose |
|---|---|---|
| `__ping` | Rust → Node | Heartbeat. Reply: `{ pong: true, ts: <ms> }`. |
| `__shutdown` | Rust → Node | Graceful exit. Reply: `{ ok: true }`, then `process.exit(0)`. |
| `ipc_call` | Node → Rust | Reverse dispatch. `params: { method, params }` — Rust resolves with the use-case JSON, or `error` on failure. |

The Rust transport lives in `crates/sidecar/src/lib.rs`; the dispatch table from `(method, params)` to use-case calls lives in `crates/api/src/mcp_bridge/mod.rs`.

## Run standalone for debugging

```bash
node sidecar/index.js
```

The MCP SDK speaks line-delimited JSON-RPC. Anything you type that **doesn't** start with `\x01` will be parsed as MCP traffic. To send a supervisor frame from a shell:

```bash
printf '\x01{"jsonrpc":"2.0","id":1,"method":"__ping"}\n' | node sidecar/index.js
```

Diagnostic output goes to **stderr** with the `[catique-sidecar]` prefix so it never collides with the multiplexed stdout.

## Out of scope this round (deferred MCP-S* steps)

- **MCP-S4** — shared-secret env handshake.
- **MCP-S5** — canonical-XML serialiser for `get_task_bundle` (currently returns the existing JSON shape).
- **MCP-S6** — `sidecar_stop` IPC command.
- **MCP-S7** — per-session role scope filtering on the tool surface.
- **MCP-S8** — full smoke test on CI (placeholder lives at `tests/smoke.test.mjs`, skipped).

## Related ADRs

- `docs/adr/ADR-0002-mcp-sidecar-architecture.md` — process-shape decision.
- `docs/adr/ADR-0007-mcp-server-registry.md` — registry-only scope.
