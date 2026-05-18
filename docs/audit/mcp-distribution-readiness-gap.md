# MCP distribution readiness — gap analysis

**Status:** open, no owner.
**Surfaces:** first-run onboarding of the bundled release build.
**Symptom that triggered the audit:** packaged `.app` ran for the first time, no
provider config (Claude Desktop / Claude Code / Codex) had a `catique-hub`
MCP-server entry added, despite the Settings UI showing all three as
`connected`.

## TL;DR

The packaged release build cannot register Catique HUB as an MCP server in any
external client today. Three independent gaps stack — fixing any one alone is
useless without the others.

| # | Gap | Severity | File ref |
|---|---|---|---|
| 1 | `catique-hub-mcp` binary doesn't exist | blocker | `crates/application/src/connected_providers.rs:507-513` |
| 2 | Node sidecar isn't bundled into the `.app` | blocker | `src-tauri/src/lib.rs:374-386` |
| 3 | `bundle.mcp` only flows to provider configs when at least one non-system role exists | design hole | `crates/application/src/connected_providers.rs:229-359` + adapters' `sync()` |

## Current behaviour (release build, first launch on a fresh user)

1. `spawn_orchestrator(pool)` is started from `src-tauri/src/lib.rs:87`.
2. `add_provider` IPC handler runs per detected provider, inserts a row into
   `connected_clients` (`status='connected'`, `last_synced_at` ≠ 0).
3. The orchestrator's coalesced sync loop calls `build_bundle()`
   (`connected_providers.rs:229`). With zero non-system roles it produces
   `RoleBundle { roles: vec![], mcp: Some(default_mcp_entry()) }`.
4. Each adapter's `sync()` runs. **All three adapters short-circuit on the
   role-side of the bundle** and only write MCP entries when `bundle.mcp` is
   `Some` AND the role-driven write logic has fired. Concretely:
   - `claude_desktop.rs:105-121` — guards on `if let Some(mcp) = bundle.mcp.as_ref()`
     but the surrounding orchestrator flow does not invoke `sync` until a role
     mutation triggers `SyncTrigger`. On fresh DB with no role mutations,
     **`sync()` is never called.**
   - Same shape in `claude_code.rs` and `codex.rs`.
5. Result: `connected_clients` rows exist with `last_synced_at` set, but the
   on-disk config files of those providers are unchanged.

Even if `sync()` *were* called, gap #1 would make the result useless — see
below.

## Gap details

### Gap 1 — `catique-hub-mcp` binary is a placeholder

```rust
// crates/application/src/connected_providers.rs:507-513
fn default_mcp_entry() -> McpEntry {
    McpEntry {
        command: "catique-hub-mcp".into(),
        args: vec!["--stdio".into()],
        env: vec![],
    }
}
```

Search for `catique-hub-mcp` across the workspace returns this line and a
single test fixture (`crates/application/tests/role_sync_skill_attachments.rs:156`).
No Cargo target builds it, no `bin/` ships it, it's not on the developer's
`PATH`. If a provider config did record this entry, the launched MCP client
would fail to spawn with `ENOENT`.

### Gap 2 — Node sidecar lives at the developer's workspace path

```rust
// src-tauri/src/lib.rs:374-386
fn resolve_sidecar_dir() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .expect("src-tauri parent should be workspace root")
        .join("sidecar")
}
```

`env!("CARGO_MANIFEST_DIR")` is a compile-time string. The release binary
shipped to friends carries the absolute path of the developer's machine — on
the receiver's machine that path does not exist. Inline comment acknowledges
the gap: *"In the spike, always use the workspace-relative path. The
`resources` bundling for production is tracked in E5."*

The bundled `.app/Contents/Resources/` directory carries only `icon.icns`.

### Gap 3 — provider sync depends on user-created roles

`build_bundle` reads `roles WHERE COALESCE(is_system, 0) = 0`. On a fresh DB
that returns an empty Vec. The adapters' `sync()` methods do not perform any
provider-level catique-hub MCP write that's independent of the role list —
the catique-hub MCP entry is rewritten alongside every role-driven sync but
never **initialised** on its own.

This means a brand new user who hasn't created a role in Catique HUB yet
sees Claude Desktop / Cursor / Codex unaware of catique-hub even when the
binaries from gaps 1 + 2 exist.

## Proposed work (ordered)

The order matters — earlier steps unblock later ones, and shipping any
intermediate state without the prerequisites results in broken configs on
user machines.

### W1 — `catique-hub-mcp` stdio MCP server crate

- New workspace member `crates/mcp-server-bin/` producing `[[bin]]
  catique-hub-mcp`.
- Exposes the existing tool surface (`list_tasks`, `create_task`,
  `list_roles`, `list_skills`, etc.) over stdio using `rmcp` or
  `mcp-sdk-rs`, whichever the team has already adopted in `crates/api`.
- Shares the same SQLite pool (`open_pool(db_path()?)`) and reuses the
  use-case layer in `crates/application/`.
- Effort: **3–5 days** including a smoke test that spawns the bin and
  exercises one read + one write tool over stdio.

### W2 — `.app` packaging of W1 and the Node sidecar

- Move `catique-hub-mcp` and `sidecar/` into Tauri's bundled resources
  via `tauri.conf.json::bundle.resources` and `externalBin` respectively.
- Replace `resolve_sidecar_dir` and `default_mcp_entry` with
  `tauri::api::path::resource_dir()`-based lookups so dev builds and
  release builds resolve the right absolute path at runtime.
- Add a debug-only fallback that walks up `CARGO_MANIFEST_DIR` so
  `pnpm tauri dev` still works without copying resources.
- Effort: **1 day**, plus signing + notarization parity (W4).

### W3 — bootstrap catique-hub MCP independent of roles

- Add an `install_catique_mcp` step that runs from `add_provider` (and on
  orchestrator startup against every `status='connected'` row) writing
  `mcpServers["catique-hub"] = default_mcp_entry()` into the provider's
  config file even when `RoleBundle::roles` is empty.
- Existing role-driven `sync()` continues to refresh the entry on every
  role mutation — idempotent overwrite via the same `mutate_claude_json`
  pattern.
- Add a unit test per adapter: `install_catique_mcp_on_empty_db_writes_entry`.
- Effort: **0.5–1 day** assuming W1 + W2 are in.

### W4 — codesigning the new binary

- `catique-hub-mcp` and the Node sidecar both need ad-hoc signing in dev
  bundles and Developer-ID signing in release. Extend the existing
  signing pipeline in `.github/workflows/build.yml` accordingly.
- Verify with `codesign -dv` on each binary inside `Contents/MacOS/`
  and `Contents/Resources/`.
- Effort: **0.5 day**.

## Acceptance criteria

The work is complete when, on a brand-new macOS install with no Catique
HUB data dir:

1. First launch of `Catique HUB.app` creates `~/Library/Application
   Support/catique/`, runs all migrations, and seeds the system roles.
2. `~/Library/Application Support/Claude/claude_desktop_config.json`,
   `~/.claude.json`, and `~/.codex/config.toml` each gain an
   `mcpServers["catique-hub"]` entry whose `command` is an absolute path
   pointing into the bundled `.app/Contents/Resources/`.
3. Launching Claude Desktop afterwards lists the catique-hub MCP server
   in its `Available tools` panel without manual editing of any config.
4. The MCP Sidecar badge in Catique HUB settings flips from `Starting…`
   to `Running` within 5 s of app launch, with latency reporting a
   non-`—` value.

## Out of scope

- HTTP transport for `catique-hub-mcp`. stdio is sufficient for all three
  adapters today. The `McpEntry` struct allows extension if a future
  provider needs it.
- Updater integration (E6).
- Auto-rollback if the user manually deletes the catique-hub entry from
  a provider config. The orchestrator overwrites on next sync; that's
  the contract.

## Related code references

- Orchestrator entry point: `src-tauri/src/lib.rs:122-152`.
- `spawn_orchestrator`: `crates/application/src/connected_providers.rs:108`.
- `build_bundle`: `crates/application/src/connected_providers.rs:229-359`.
- `default_mcp_entry`: `crates/application/src/connected_providers.rs:507-513`.
- Adapter trait + `CATIQUE_MCP_KEY`: `crates/clients/src/lib.rs:63, 233-249`.
- Adapters' `sync()`:
  `crates/clients/src/adapters/claude_desktop.rs:105-121`,
  `crates/clients/src/adapters/claude_code.rs`,
  `crates/clients/src/adapters/codex.rs`.
- Sidecar path resolver: `src-tauri/src/lib.rs:374-386`.

## Memory

Catique HUB data dir is split: release `catique/`, debug `catique-dev/`
(see `crates/infrastructure/src/paths.rs::data_dir_name`). The W3 install
step must use whichever directory the runtime build profile resolves to.
