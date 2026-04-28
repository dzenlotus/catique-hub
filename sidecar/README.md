# catique-sidecar

PoC for ctq-56 / ADR-0002 spike. Validates the Tauri sidecar spawn/lifecycle/health story **before** the real MCP implementation in E5.

## What this is

A minimal stdio JSON-RPC 2.0 server written in Node.js (ESM, no dependencies). Tauri spawns it as a child process at startup, communicates with it by writing JSON lines to its stdin and reading JSON lines from its stdout, and monitors it for crashes.

Supported methods:

| Method | Response |
|---|---|
| `ping` | `{ jsonrpc: "2.0", id, result: { pong: true, ts: <ms> } }` |
| `shutdown` | `{ ok: true }` then exits 0 |
| anything else | JSON-RPC error -32601 |

All diagnostic output goes to **stderr** with the prefix `[catique-sidecar]`.

## How Tauri spawns it

In `src-tauri/src/lib.rs` `setup` hook, `SidecarManager::start(sidecar_dir)` calls:

```
tokio::process::Command::new("node")
    .arg(sidecar_dir.join("index.js"))
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::inherit())
    .spawn()
```

`sidecar_dir` resolves to:
- **dev** — `<workspace_root>/sidecar/` (via `cfg!(debug_assertions)`)
- **prod** — `<app_resource_dir>/sidecar/`

## Run standalone for debugging

```bash
node sidecar/index.js
```

Then type JSON-RPC lines into stdin:

```
{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}
{"jsonrpc":"2.0","id":2,"method":"shutdown"}
```

Expected stdout:

```
{"jsonrpc":"2.0","id":1,"result":{"pong":true,"ts":1234567890}}
{"ok":true}
```

## NOT in scope (E5 work)

- `@modelcontextprotocol/sdk` integration
- Real MCP tool surface (`list_tasks`, `get_task_bundle`, etc.)
- Rust IPC transport (Unix domain socket / named pipe)
- AI-client config installer
