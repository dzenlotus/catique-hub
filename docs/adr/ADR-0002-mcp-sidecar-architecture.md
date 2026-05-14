# ADR-0002 — MCP Sidecar Architecture: runtime, transport, lifecycle (ctq-56)

**Status:** Accepted
**Date:** 2026-05-01
**Spike-validated:** 2026-05-05 — see `experiments/sidecar-spike/`. Cold-start 20–40 ms (≪ 2 s budget). Q-1 size revised to +30–35 MB (UPX dropped: incompatible with macOS codesign).
**Author:** Catique HUB team
**Roadmap item:** ctq-56 (ADR-0002 MCP sidecar architecture — approval + spike)
**Unblocks:** E5 (real MCP bridge — tool surface, hub-bridge mode)

---

## Context

Catique HUB is a Tauri 2.x desktop application. Its backend is Rust; its AI-orchestration surface (Promptery MCP server) is and will remain Node.js for the foreseeable future — the SDK ecosystem (`@modelcontextprotocol/sdk`) and the existing prompt-inheritance engine are deeply Node-native. Bridging the two runtimes requires a supervised child process: a **sidecar**.

The migration strategy for Catique HUB is: keep Promptery's MCP server in Node, wrap it with a lifecycle manager in Rust (`catique-sidecar`), and expose lifecycle IPC to the Tauri frontend. The sidecar is not the real MCP bridge (that is E5); it is the spawn/health/restart foundation that E5 will build on.

Three open questions must be answered before E5 starts:

| ID | Question |
|----|----------|
| Q-1 | How large is the installer when Node is bundled? Acceptable? |
| Q-2 | What is the exact launcher-binary path convention in Tauri 2.x? |
| Q-3 | How does graceful reload work? What are the shutdown semantics? |

---

## Decision

### 1. Sidecar runtime: bundled Node 20 (deferred to v0.9 installer hardening)

**Trade-off matrix**

| Option | Installer fit | Reproducibility | Ops burden | Extensibility | License |
|---|---|---|---|---|---|
| **System Node (current spike)** | +0 MB | Low — breaks on Node <18, missing on some machines | Low | Good | N/A |
| **Bundled Node 20 (recommended)** | +25–30 MB stripped+UPX | High — version pinned, zero user pre-install | Medium — update Node on security advisories | Best | MIT (Node) |
| **Bun** | +8–12 MB | Medium — Bun API surface diverges from Node, porting risk | Medium | Moderate | MIT (Bun) |
| **Rewrite MCP server in Rust** | +0 MB | High | High — full port of prompt-inheritance engine | Low short-term | N/A |

**Choose bundled Node 20 because** it is the only option that guarantees the exact runtime the MCP server was developed and tested against, requires zero user preconditions, and has a well-understood Tauri sidecar bundling path. The +25–30 MB installer cost (estimate: Node 20 binary ~50 MB unstripped; ~25–30 MB after `strip` + UPX per [Tauri sidecar bundling docs](https://v2.tauri.app/develop/sidecar/)) is acceptable for a developer-tools audience.

**Current spike status:** the implementation in `crates/sidecar/src/lib.rs` shells out to `node` from `PATH` (`Command::new("node")`). This is correct for the spike validation phase. Switching to the bundled binary is a one-line change to the `Command` invocation and a `tauri.conf.json` `externalBin` entry; it is deferred to v0.9 installer hardening (ctq-62 dependency).

**Q-1 answer:** +25–30 MB (stripped+UPX); accepted.

### 2. IPC transport: stdio JSON-RPC 2.0 (line-delimited)

The implementation uses stdio: the Rust manager writes newline-terminated JSON objects to the child's stdin and reads newline-terminated JSON objects from the child's stdout.

**Why stdio, not TCP or Unix sockets:**

- **No port discovery.** A TCP listener requires a free port; discovery between processes adds complexity. Stdio has no discovery step — the pipe is created at spawn time.
- **No firewall or security-group friction.** Loopback TCP ports are occasionally blocked by corporate firewalls and antivirus on Windows. Stdio is not a network socket and is invisible to firewall rules.
- **Lifecycle binding.** When the Rust parent closes stdin, the child observes EOF and exits cleanly (`rl.on("close")`). The transport death and process death are the same event.
- **Simplicity.** The MCP protocol already specifies JSON-RPC 2.0; line-delimited stdout is the canonical transport for CLI-hosted MCP servers.

**Where TCP would have been required:** if external clients (e.g. a second Catique HUB instance, or a browser-based tool) needed to connect directly to Catique HUB's sidecar at runtime. This is explicitly out of scope. External clients connect to Promptery Hub, which manages its own MCP endpoint independently.

**Ping payload shape** (from `crates/sidecar/src/lib.rs` and `sidecar/index.js`):

```json
// request (Rust → Node)
{"jsonrpc":"2.0","id":1,"method":"ping"}

// response (Node → Rust)
{"jsonrpc":"2.0","id":1,"result":{"pong":true,"ts":<unix-ms>}}
```

The `ts` field is informational; the Rust side validates only `result.pong == true`.

### 3. Lifecycle policy: restart policy and supervisor

**Constants** (from `crates/sidecar/src/lib.rs`):

| Constant | Value | Meaning |
|---|---|---|
| `MAX_RESTARTS` | 3 | Maximum auto-restarts in the rolling window |
| `RESTART_WINDOW` | 60 s | Rolling window duration |
| `HEARTBEAT_INTERVAL` | 10 s | Background supervisor ping interval |
| `PING_TIMEOUT` | 5 s | Maximum wait for a `pong` response |

The supervisor task (`supervisor_task`) runs in a dedicated `tokio::spawn`'d loop. Every `HEARTBEAT_INTERVAL` it calls `do_ping`. On ping failure it:

1. Sets status to `Crashed { exit_code: None }`.
2. Checks `may_restart()` — prunes entries older than `RESTART_WINDOW`, then checks `restart_history.len() < MAX_RESTARTS`.
3. If allowed: kills the child, re-spawns, records the restart timestamp, continues the loop.
4. If policy exhausted: logs "restart policy exhausted; staying Crashed" and exits the supervisor loop. The process stays in `Crashed` until the user calls `sidecar_restart` via the IPC command.

The `restart_history` is a `Vec<Instant>` pruned on every `may_restart()` call; the rolling-window approach means a burst of 3 crashes within 60 s trips the policy, but a steady process that occasionally crashes once every 30 s would never trip it.

### 4. Graceful shutdown semantics

`stop(timeout_dur)` (from `do_stop` in `crates/sidecar/src/lib.rs`):

1. Sends `{"jsonrpc":"2.0","id":0,"method":"shutdown"}` to the child's stdin.
2. Drops stdin and stdout handles.
3. Waits up to `timeout_dur` for the child to exit (`tokio::time::timeout`).
4. If the wait times out or returns an error: calls `child.kill()` (SIGKILL on Unix, `TerminateProcess` on Windows), then awaits the reap.
5. Sets status to `Stopped`.

The `restart()` method passes `Duration::from_secs(2)` as the timeout when calling `stop` internally. The user-facing `sidecar_stop` IPC command (not yet wired as of the spike; see `crates/api/src/handlers/sidecar.rs`) should pass a configurable value defaulting to 2 s.

The Node sidecar respects shutdown gracefully: on `method: "shutdown"` it flushes stdout and calls `process.exit(0)` after a 50 ms flush tick. On `SIGTERM`/`SIGINT` it does the same.

**Q-3 answer:** `stop()` sends `shutdown` JSON-RPC, waits up to 2 s (configurable), then SIGKILL. Node side exits within 50 ms of receiving shutdown. Total graceful path: < 100 ms.

### 5. Launcher binary path convention (Q-2)

Tauri 2.x sidecar convention (from [Tauri v2 sidecar docs](https://v2.tauri.app/develop/sidecar/)):

- Bundled binaries are placed at `src-tauri/binaries/<name>-<target-triple>` at build time.
- Declared in `tauri.conf.json` under `bundle.externalBin`:

```json
{
  "bundle": {
    "externalBin": ["binaries/node"]
  }
}
```

- At runtime, Tauri resolves the binary via `tauri::path::App::resource_dir()` + the target-triple suffix. The `Command::new_sidecar("node")` API handles suffix resolution automatically.
- The Node `index.js` script is a resource, not a sidecar binary. It is bundled via `bundle.resources` and resolved with `app.path().resolve_resource("sidecar/index.js")`.

**Current spike** omits `externalBin` because it uses system Node. The migration path for v0.9:

1. Add `"externalBin": ["binaries/node"]` to `tauri.conf.json`.
2. Place `node-<target-triple>` binaries in `src-tauri/binaries/` (CI downloads the official Node 20 binary for each target).
3. Replace `Command::new("node").arg(&index_js)` with `Command::new_sidecar("node")?.arg(&index_js)` in `do_spawn`.
4. Add entitlements for mac notarization (see Consequences).

**Q-2 answer:** `src-tauri/binaries/node-<target-triple>`, declared via `bundle.externalBin`, resolved at runtime by Tauri's `new_sidecar` API.

---

## Spike status

The implementation lives at `crates/sidecar/src/lib.rs` (458 lines, `SidecarManager`) and `sidecar/index.js` (the Node stdio server). It validates the spawn/health/restart story end-to-end: `SidecarManager::start` spawns the child, the supervisor heartbeats at 10 s intervals, ping round-trips confirm JSON-RPC connectivity, and `stop` exercises the graceful shutdown path. The test suite contains 1 integration test (`smoke_ping_pong_shutdown`) marked `#[ignore]` because it requires `node` on PATH; run it locally with:

```
cargo test -p catique-sidecar -- --ignored
```

The spike is complete and confirms the spawn/health/restart story is viable before E5 writes the real MCP bridge.

---

## Consequences

### Positive

- Deterministic Node version in production once bundled Node 20 lands; no user pre-install required.
- Stdio transport requires no port allocation, no firewall exceptions, and no service-discovery mechanism.
- The restart policy (≤ 3 / 60 s → `Crashed`) prevents runaway respawn loops from burning CPU while surfacing a recoverable error state to the UI.
- `SidecarManager` is `Clone` (Arc-backed), so multiple Tauri commands can share it without wrapping it in a second `Arc`.
- The `Crashed` state is serialisable (`#[derive(Serialize, Deserialize)]`) and flows directly to the FE via the existing IPC layer.

### Negative

- **Installer size +25–30 MB** once bundled Node is added. Mitigated by strip+UPX; noted in release communications.
- **Security advisories on Node** require a coordinated update: bump the bundled binary, re-sign, re-notarize, re-publish. Cycle time is estimated at 1–2 days.
- **macOS notarization** requires adding the bundled Node binary to the entitlements list with `com.apple.security.cs.allow-jit` or `allow-unsigned-executable-memory` if Node's JIT is used. This was not verified (see "Unverified claims" below).
- **Windows signing** with `signtool` must include the bundled `node.exe`. The signing pipeline (ctq-62) is a dependency.
- **Current spike discrepancy:** `do_spawn` calls `Command::new("node")`, not `Command::new_sidecar("node")`. This is intentional for the spike but must be corrected before the v0.9 bundled-Node milestone.

---

## Out of scope (deferred to E5 / v0.9)

- Real MCP protocol implementation (`@modelcontextprotocol/sdk` integration, tool surface).
- Hub-bridge mode coexistence: how `catique-sidecar` and the existing Promptery Hub bridge share the Node process or port is not decided here.
- `sidecar_stop` as an explicit IPC command (the handler in `crates/api/src/handlers/sidecar.rs` does not expose a stop command; only `sidecar_status`, `sidecar_ping`, and `sidecar_restart` are wired).
- Shared-secret / capability negotiation between Rust host and Node sidecar (AC-1 of the task description; required before E5 production use).
- Windows UX for "sidecar crashed" (no tray icon or notification strategy decided).
- Bundled Node binary CI pipeline (ctq-62).

---

## Unverified claims (require ctq-62 / code-signing certs)

The following claims were **not verified** during this ADR because they require actual code-signing certificates, a CI runner with Xcode tools, and a Windows signing environment — none of which were available for a static-analysis pass:

1. **macOS notarization** of the bundled `node` binary with `codesign --options runtime` and the required entitlements. It is asserted (per Tauri docs and Apple requirements) that JIT entitlements will be needed; the exact entitlement set has not been confirmed against a real notarization attempt.
2. **Windows signtool** coverage of the bundled `node.exe`. The claim in AC-2 that "bundled Node correctly signs in CI" is plausible given Tauri's `beforeBundleCommand` hook, but has not been tested.
3. **Cold-start ≤ 2 s target**: the task description requests a measured cold-start time. The spike test (`smoke_ping_pong_shutdown`) confirms ping succeeds but does not assert a wall-clock start time. A timed measurement requires a release build with the bundled binary, which was not produced.

These three items are dependencies of ctq-62 (code-signing pipeline).

---

## Open questions for the engineer

| # | Question | Blocking |
|---|---|---|
| OQ-1 | What is the hub-bridge mode coexistence plan? Does E5 replace this sidecar, extend it, or run a second sidecar? | Yes — E5 design |
| OQ-2 | What shared-secret / capability mechanism authenticates Rust ↔ Node IPC? (AC-1 of ctq-56) | Yes — before E5 production |
| OQ-3 | Should `sidecar_stop` be exposed as an IPC command, or is `sidecar_restart` sufficient for the UI? | No — UI design |
| OQ-4 | What is the Windows target triple for `node-<triple>`? (`x86_64-pc-windows-msvc` assumed; verify against CI matrix.) | Before bundled Node milestone |
| OQ-5 | Does Node 20's JIT require `com.apple.security.cs.allow-jit` entitlement, or does `--jitless` flag eliminate the need? | ctq-62 |
| OQ-6 | Decision log uses `D-018` as a reference in `docs/release-runbook.md`. Is the project log numbered sequentially from D-001 or does it have a gap? Resolve before adding more entries. | No — housekeeping |

---

## Related

- ADR-0003 — Agentic Client Adapter Pattern (`docs/adr/ADR-0003-agentic-client-adapters.md`)
- ADR-0004 — Client Instructions Editor (`docs/adr/ADR-0004-client-instructions-editor.md`)
- ADR-0005 — Role-file Sync Format (`docs/adr/ADR-0005-role-sync-format.md`)
- Implementation: `crates/sidecar/src/lib.rs`, `crates/api/src/handlers/sidecar.rs`
- Node sidecar script: `sidecar/index.js`
- Release runbook (signing pipeline): `docs/release-runbook.md`
