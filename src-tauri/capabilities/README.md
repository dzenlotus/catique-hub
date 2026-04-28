# Capabilities

Tauri 2.x capabilities define which permissions the frontend can call from the
WebView. They are the contract surface between the renderer and the Rust core.

## Principle: least privilege; expand only on documented need

Every permission added here widens the attack surface. Before adding a new
permission:

1. **Justify it** — link the ADR or PR that motivated it.
2. **Scope it** — limit `windows` and (where possible) URLs/args.
3. **Audit it** — confirm the underlying plugin's source and license.

## What ships in E1.1 (this scaffold)

- `core:default` — Tauri's minimal baseline (event listening, app metadata).
- `core:window:allow-close` / `allow-minimize` / `allow-hide` / `allow-show` /
  `allow-set-focus` — window lifecycle for the chrome buttons.

That's it. Notably **NOT** included:

- **No `fs` plugin** — SQLite goes through Rust commands per ADR D-022. The
  renderer never touches the filesystem directly.
- **No `shell` plugin** — `shell:open` will be added only when an in-app
  "Open in browser" link demands it, with URL allow-list.
- **No `dialog` plugin** — file pickers will be added when attachments land.
- **No `http` plugin** — outbound HTTP goes through the Rust core (proxy,
  retry, telemetry hooks all live there).

## Adding a new permission

1. Identify the plugin (e.g. `tauri-plugin-dialog`).
2. Add the crate to `src-tauri/Cargo.toml` and register it in `lib.rs`.
3. Add the permission identifier to `default.json` (or a new capability file
   for non-main windows).
4. Update this README with the justification.
5. PR review must call out capability changes explicitly.

## References

- Tauri 2.x permissions guide: https://tauri.app/security/permissions/
- ADR D-022 (`docs/catique-migration/adr/0001-ipc-vs-graphql-vs-rest.md`) — IPC
  via Tauri commands; no plugin shortcuts that bypass the Rust boundary.
