# sidecar-spike (ctq-56 / ADR-0002 validation)

Standalone, throwaway proof that Tauri 2.x can host a Node sidecar over
stdio JSON-RPC. Not part of the Catique HUB Cargo workspace, not part of
the root `pnpm` graph — its own `Cargo.toml` (single-member workspace) and
its own `package.json`.

The architecture is locked in
[`docs/adr/ADR-0002-mcp-sidecar-architecture.md`](../../docs/adr/ADR-0002-mcp-sidecar-architecture.md).
This spike validates the assumptions, it does **not** redesign anything.

## What it contains

```
experiments/sidecar-spike/
  package.json                # @tauri-apps/cli only
  dist/
    index.html                # 1 button + 1 textarea, no bundler
    main.js                   # uses window.__TAURI_INTERNALS__.invoke
  sidecar/
    index.js                  # line-delimited JSON-RPC server (echo / ping / shutdown)
  scripts/
    bench-cold-start.mjs      # standalone cold-start benchmark
  src-tauri/
    Cargo.toml                # isolated [workspace] table
    build.rs
    tauri.conf.json
    capabilities/default.json
    src/
      lib.rs                  # SpikeManager: spawn, echo, shutdown
      main.rs
```

## How to run

### 1. The Node sidecar standalone (sanity check)

```sh
cd experiments/sidecar-spike
node sidecar/index.js
# then paste a line:
{"jsonrpc":"2.0","id":1,"method":"echo","params":{"msg":"hi"}}
# response on stdout:
{"jsonrpc":"2.0","id":1,"result":{"echoed":"hi","ts":1762345678901}}
```

### 2. Cold-start benchmark (no Tauri build needed)

Measures `child_process.spawn(node, [index.js])` -> first echo response.
This is the same path Tauri's `setup` callback exercises, minus a constant
WebView boot offset.

```sh
cd experiments/sidecar-spike
node scripts/bench-cold-start.mjs 5
```

### 3. Full Tauri shell

```sh
cd experiments/sidecar-spike
pnpm install            # installs @tauri-apps/cli only
pnpm tauri dev          # opens a 720x480 window with "ping sidecar" + log
```

Click "ping sidecar". The frontend invokes `sidecar_echo`, the Rust shell
forwards JSON-RPC to Node, the response is rendered in the textarea, and
`sidecar_status` reports `cold_start_ms` after the first round-trip.

## Results

Hardware: M-series Mac, macOS 15, on AC power, no other heavy load.
Run via `node scripts/bench-cold-start.mjs 5`, twice each, on
two Node majors (Node 20 not installed locally — see Caveats).

| Node | run 1 | run 2 | run 3 | run 4 | run 5 | min | **median** | max |
|---|---|---|---|---|---|---|---|---|
| 24.13.0 (pass A) | 24.1 | 31.5 | 38.5 | 31.3 | 23.2 | 23.2 | **31.3** | 38.5 |
| 24.13.0 (pass B) | 24.6 | 19.7 | 19.0 | 20.0 | 19.5 | 19.0 | **19.7** | 24.6 |
| 22.22.0          | 75.8 | 39.5 | 41.1 | 33.8 | 35.8 | 33.8 | **39.5** | 75.8 |

All values in milliseconds.

**Cold-start budget per ADR Q-1: ≤ 2000 ms on M-series. Observed
median: 19.7–39.5 ms — two orders of magnitude under budget.**

The Tauri shell itself adds a constant ~150–400 ms WebView boot before
`setup` fires; even with that overlay added, total shell-to-first-echo
stays comfortably under 1 s.

## What the spike showed about the ADR's open questions

### Q-1 — installer size with bundled Node

ADR claims +25–30 MB stripped+UPX. Local check on Node 22.22.0 / arm64:

| State | Size |
|---|---|
| Unstripped (nvm download) | 112 MB |
| `strip -x` | 86 MB |
| `gzip -9` (proxy for DMG/MSI compression) | 32 MB |

The ADR estimate of ~25–30 MB is realistic but on the optimistic edge —
expect 30–35 MB for the per-target binary alone; UPX on the Node binary
is risky on macOS (codesign invalidation) and may not be applicable.
**Recommend the ADR Q-1 estimate be widened to "+30–35 MB" once we have a
real CI-produced bundled binary.**

The ADR's note about ~50 MB unstripped also underestimates current Node:
modern Node 22+ on arm64 darwin is 110+ MB unstripped. Node 20 LTS is
similar order of magnitude. This does not change the decision (still
acceptable for a developer-tools audience) but the headline number in
release comms should be updated.

### Q-2 — launcher binary path convention

The spike uses **system Node** (matches the current state of
`crates/sidecar/src/lib.rs`); it does **not** use `tauri::process::Command::new_sidecar`.
Reason: the spike's purpose is to validate the spawn / IPC story; binary
bundling is a CI-pipeline concern (ctq-62) and would have required
downloading a Node 20 release for arm64+x64+windows targets, codesign-
ing the macOS binary, and configuring `bundle.externalBin`. All of those
are out of scope per the task brief.

What the spike **did** validate:

- `app.path().resource_dir()` resolves correctly inside the bundle.
- Resources declared as `"../sidecar/index.js"` in `bundle.resources`
  land at `<app>.app/Contents/Resources/_up_/sidecar/index.js`. The
  `_up_` segment is Tauri 2.x's encoding for `..` path components in
  resource entries; if you forget this, the dev path works but the
  bundled path fails. **This is a real footgun and worth a note in the
  release runbook.**
- A dev-time fallback walking up from `CARGO_MANIFEST_DIR` lets the spike
  run without rebuilding the bundle on every iteration. Production code
  should drop the dev fallback once `externalBin` ships in v0.9.

The exact `externalBin` migration path (Q-2 closure) remains as ADR
section 5 already describes — the spike does not change that plan.

### Q-3 — graceful reload / shutdown semantics

The spike implements a simplified shutdown: drop stdin, wait 250 ms,
SIGKILL on timeout. The Node side honours both `rl.on("close")` (EOF)
and the `shutdown` JSON-RPC method (used by the production crate). Both
paths exit within ~50 ms of receiving the signal.

Observed in `pnpm tauri dev`:

- Window close fires `RunEvent::ExitRequested`.
- `Inner::shutdown` runs in a one-shot tokio runtime (because the main
  Tauri runtime is being torn down), drops stdin, awaits the child.
- Node logs `stdin closed, exiting 0` to stderr, exits within 50–80 ms.
- No zombie / orphaned `node` process observable in `ps`.

**Q-3 confirmed: graceful shutdown total < 100 ms in the typical case,
< 250 ms worst case before SIGKILL escalation.** Matches ADR claim.

The graceful-reload (live restart with a new index.js) story is not
exercised by the spike — that involves the supervisor's restart-policy
machinery already implemented in `crates/sidecar`. Recommend a follow-up
test that touches the JS file and verifies the supervisor path; that is
better done against the production crate, not this throwaway spike.

## Out of scope (per task brief and ADR)

- macOS notarization / codesign of a bundled Node binary (ctq-62).
- Windows Authenticode / signtool coverage of `node.exe` (ctq-62).
- Real MCP protocol surface (`@modelcontextprotocol/sdk`) — E5.
- Restart policy + supervisor heartbeat (already in `crates/sidecar`).
- Shared-secret / capability handshake between Rust and Node (AC-1 of
  ctq-56; tracked as ADR-0002 OQ-2).
- Hub-bridge mode coexistence (OQ-1).

## Gotchas observed during the spike

1. **`bundle.resources` path mangling.** Tauri 2.x rewrites `../foo` to
   `_up_/foo` inside the resource dir. The Rust resolver must check both
   the `_up_/sidecar/index.js` and bare `sidecar/index.js` shapes, plus
   a dev fallback. Documented in `resolve_sidecar` in `src-tauri/src/lib.rs`.

2. **Tauri's `RunEvent::ExitRequested` runs after the async runtime is
   gone.** The shutdown path has to spin up a `tokio::runtime::Builder::new_current_thread`
   to await the child. The production crate already does this; replicated
   here for parity. If you forget, `child.wait()` panics with "no
   reactor running".

3. **CSP without `unsafe-inline` for scripts.** The spike's HTML uses an
   external `main.js` rather than inline `<script>` so the Tauri default
   CSP works without exceptions. Style allows `unsafe-inline` only for
   the small inline `<style>` block — production should move to an
   external stylesheet, this is a spike.

4. **Capabilities table has no extra permissions.** Only `core:default`
   and `core:window:default`. The custom commands `sidecar_status` /
   `sidecar_echo` are auto-allowed for the `main` window because they are
   declared via `invoke_handler`. Path-scope is **not** opened — there is
   no `fs:` permission, no `shell:`, no `http:`. This is the floor model
   for the production app.

5. **Node version drift.** Local machine has Node 22 + 24, no Node 20.
   The spike measures cold-start under both 22 and 24; the ADR mandates
   bundled Node 20. Modern Node startup time is dominated by V8 init and
   has been roughly constant across 18 / 20 / 22 / 24, so the conclusion
   "well under 2 s" is portable. CI should re-run this benchmark against
   the actual bundled Node 20 binary as part of ctq-62 to nail the
   number on a clean install.

## Top open question (escalation)

**ADR-0002 Q-1 size estimate is optimistic.** Node 20 LTS bundled and
codesigned for macOS arm64 is likely to land at 30–35 MB compressed
(not 25–30), and **UPX is incompatible with macOS code-signing**, so the
"strip+UPX" mitigation in the ADR is half-applicable. Suggest revising
ADR Q-1 to "+30–35 MB" with a footnote that UPX is Windows-only.

Q-2 and Q-3 stand as written in the ADR.
