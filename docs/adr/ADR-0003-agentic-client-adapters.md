# ADR-0003 — Agentic Client Adapter Pattern (ctq-67)

**Status:** Accepted  
**Date:** 2026-05-01  
**Author:** Catique HUB team  
**Roadmap item:** ctq-67 (Auto-discovery of installed agentic clients)  
**Unblocks:** ctq-68 (Global instructions editor), ctq-69 (Roles sync)

---

## Context

Catique HUB needs to detect which agentic CLI tools (Claude Code, Claude Desktop, Cursor, Qwen CLI) are installed on the user's machine and expose their config directories for downstream features (global instructions editing, role-file sync). The detection must be lightweight, non-intrusive, and produce a stable data model for the Settings UI.

---

## Decision

### 1. Adapter pattern — one Rust struct per client

Each agentic client is represented by a single `struct` in `crates/clients/src/adapters/` that implements the `ClientAdapter` trait. There is no meta-abstraction (no plugin system, no reflection). Adding a new client requires:

1. Create `src/adapters/<name>.rs` implementing `ClientAdapter`.
2. Register it in `all_adapters()` in `crates/clients/src/lib.rs`.
3. No other changes required.

The trait is object-safe (`Box<dyn ClientAdapter>`) so the registry and use-case can iterate a heterogeneous list.

### 2. Storage: `~/.catique-hub/connected-clients.json`

The registry is persisted as a single JSON file at `~/.catique-hub/connected-clients.json`. This location was chosen over `$APPLOCALDATA/catique/` so the file:

- Survives data-directory wipes (the user can reset Catique Hub's DB without losing client detection state).
- Is readable by external tooling without knowledge of the platform-specific app data path.
- Has a clear, predictable location for debugging.

**Atomic writes:** saves use write-to-temp + rename (`<path>.json.tmp` → `<path>.json`), which is atomic on POSIX filesystems. This prevents a half-written file from corrupting the registry on crashes.

### 3. Discovery trigger: app start + manual rescan from Settings

Discovery is triggered by:

- **Manual rescan:** the user clicks "Просканировать" in Settings → Connected agents (calls `discover_clients` IPC command).
- There is no filesystem watcher. This is an explicit out-of-scope decision for v1.
- There is no automatic trigger on app start. The first cold-start keeps its startup budget unaffected (`ADR-0003 §startup-budget`). The first-launch flow may call `discover_clients` after import completes, but this is not mandatory.

### 4. Platform: macOS only for v1

All adapter `detect()` methods are guarded with `#[cfg(not(target_os = "macos"))] return Ok(false)`. On non-macOS targets:

- Path-building methods (`config_dir`, `signature_file`, `instructions_file`) still return the expected macOS path — this is useful for rendering in the UI and for cross-compilation/CI.
- `detect()` always returns `Ok(false)` without touching the filesystem.

Windows and Linux support are deferred. The compile-time guard approach means adding a platform is a localised change inside each adapter's `detect()` body only.

### 5. Error handling: missing client = `Status::NotInstalled`, not an error

When a client's signature path does not exist on disk, `detect()` returns `Ok(false)` — not an `Err`. This is intentional: "client not installed" is a normal, expected condition, not an exceptional one. Errors are reserved for cases where the adapter itself cannot function (e.g. `dirs::home_dir()` is unavailable — `AdapterError::HomeDirUnavailable`).

### 6. Per-client `enabled: bool` toggle persists across rescans

The `ConnectedClient` struct carries both `installed` (set from `detect()` at scan time) and `enabled` (user toggle, persisted). The merge logic in `registry::rescan` enforces:

- **New client** (not in existing registry): `enabled = installed` (enabled by default if present).
- **Known client**: `enabled` is preserved from the persisted state (user's choice is respected even after reinstall/uninstall cycles).
- **Orphaned client** (adapter removed from the codebase): remains in the registry with `installed = false`, `enabled` preserved.

---

## Adapter signature paths

| Client         | Config dir                                          | Signature path probed                                           | Notes                                           |
|----------------|-----------------------------------------------------|-----------------------------------------------------------------|-------------------------------------------------|
| Claude Code    | `~/.claude/`                                        | `~/.claude/settings.json` or `~/.claude/CLAUDE.md` (either)   | Fallback accepts CLAUDE.md for users without settings.json |
| Claude Desktop | `~/Library/Application Support/Claude/`             | `~/Library/Application Support/Claude/claude_desktop_config.json` | macOS-only path by nature |
| Cursor         | `~/.cursor/`                                        | `~/.cursor/mcp.json`                                           | Primary signature; fallback to AppSupport considered but not needed in v1 |
| Qwen CLI       | `~/.qwen/`                                          | `~/.qwen/` (directory existence)                               | Best-effort: no canonical single-file signature known as of 2026-Q2 (OQ-1) |

---

## IPC commands

Three commands are registered in `src-tauri/src/lib.rs`:

| Command                    | Rust handler                          | Description                                        |
|----------------------------|---------------------------------------|----------------------------------------------------|
| `discover_clients`         | `handlers::clients::discover_clients` | Rescan filesystem, persist, emit `client:discovered` |
| `list_connected_clients`   | `handlers::clients::list_connected_clients` | Read cached registry without scanning      |
| `set_client_enabled`       | `handlers::clients::set_client_enabled` | Toggle `enabled` flag, persist, emit `client:updated` |

Additional commands added for ctq-68/ctq-69 readiness: `read_client_instructions`, `write_client_instructions`, `list_synced_client_roles`, `sync_roles_to_client`.

---

## Role-sync extension surface (ctq-69)

The `ClientAdapter` trait exposes three optional methods gated on `supports_role_sync()`:

- `agents_dir() → Result<PathBuf, AdapterError>` — directory where managed role files are written.
- `agent_filename(role_id) → String` — filename for a given role (includes `catique-` prefix + correct extension).

| Client         | supports_role_sync | agents_dir            | file extension |
|----------------|--------------------|-----------------------|----------------|
| Claude Code    | true               | `~/.claude/agents/`   | `.md`          |
| Claude Desktop | false              | n/a                   | n/a            |
| Cursor         | true               | `~/.cursor/rules/`    | `.mdc`         |
| Qwen CLI       | false              | n/a                   | n/a            |

---

## Out of scope (v1)

- Filesystem watcher (rescan-on-app-focus). Manual button is sufficient for v1.
- Client config writes — that is ctq-68.
- Roles sync implementation — that is ctq-69.
- Windows / Linux support.

---

## Crate layout

```
crates/
  clients/          # ClientAdapter trait + 4 adapters + all_adapters() factory
    src/adapters/
      claude_code.rs
      claude_desktop.rs
      cursor.rs
      qwen.rs
  domain/           # ConnectedClient struct (ts-rs exported to bindings/)
  application/      # ClientsUseCase (discover, list, set_enabled, instructions, sync)
  infrastructure/   # registry::{load, save, rescan} + RegistryError
  api/              # Tauri IPC handlers (clients.rs)

src/
  entities/connected-client/   # FSD entity slice (api + model + ui)
  widgets/connected-agents-section/  # Settings UI section
  widgets/client-instructions-editor/  # Instructions editor dialog (ctq-68)
bindings/
  ConnectedClient.ts           # ts-rs generated
```

---

## Consequences

- Adding a fifth client (e.g. Gemini CLI) requires only one new `src/adapters/<name>.rs` file and one line in `all_adapters()`.
- The JSON-on-disk format is stable across rescans thanks to the merge semantics.
- The macOS compile-time guard means CI on Linux gives a clean build without false "not installed" reports polluting test output.
- ctq-68 (Global instructions editor) can be built immediately: the `instructions_file()` path per adapter is already defined, and `read_client_instructions` / `write_client_instructions` IPC commands are wired.
- ctq-69 (Roles sync) can be built immediately: `supports_role_sync()`, `agents_dir()`, and `agent_filename()` are already part of the trait.
