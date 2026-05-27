# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project at a glance

Catique HUB is a **Tauri 2.x desktop app** (macOS + Windows) for AI agent orchestration via kanban + prompt inheritance. The repo is a hybrid TypeScript/Rust monorepo: a Vite-built React frontend in `src/`, a Cargo workspace of Rust crates in `crates/`, a Tauri shell in `src-tauri/`, an MCP Node sidecar in `sidecar/`, and a standalone MCP binary in `crates/mcp-server-bin/`.

Package manager is **pnpm 10.30.3** (Node ≥20). Rust toolchain is **1.81** with `clippy::all -D warnings` enforced.

## Common commands

### Frontend (run from repo root)
- `pnpm dev` — Vite dev server on port **1420** (Tauri reads this from `tauri.conf.json devUrl`). Standalone, no Rust.
- `pnpm build` — `tsc --noEmit` then `vite build`. CI relies on the tsc pass.
- `pnpm test` / `pnpm test:watch` — Vitest. Includes `src/**/*.{test,spec}.{ts,tsx}` only — the Node sidecar smoke test (`sidecar/tests/`) uses `node:test` and is NOT in Vitest discovery.
- Single Vitest file: `pnpm exec vitest run src/widgets/kanban-board/KanbanBoard.test.tsx`
- Single Vitest test by name: `pnpm exec vitest run -t "renders empty state"`
- `pnpm test:cov` — coverage report (NFR §5 target is 75% branches, not yet CI-enforced).
- `pnpm storybook` on port 6006; `pnpm build-storybook` for static export.

### Tauri (full desktop app)
- `pnpm tauri:dev` — boots Vite + Rust shell. Uses `catique-dev/` data dir (see "Dev/prod data isolation" below).
- `pnpm tauri:build` — packages signed `.dmg`/`.msi`. Pulls the standalone `catique-hub-mcp` binary from `src-tauri/binaries/` as an external bin.

### Rust workspace
- `cargo fmt --all -- --check` — formatting gate.
- `cargo clippy --workspace --all-targets -- -D warnings` — lint gate; `-D warnings` is non-negotiable in CI.
- `cargo test --workspace --all-targets` — full test suite.
- Single Rust test: `cargo test -p catique-application boards::tests::create_board_emits_event`
- **Regenerate `bindings/`**: `cargo test -p catique-domain -p catique-api`. ts-rs `#[ts(export)]` emits files only inside `export_bindings_*` tests.

### E2E (Playwright via mock IPC bridge — no `tauri-driver`)
- `pnpm e2e` — `pnpm e2e:build && playwright test`. The build sets `VITE_E2E=1` so `src/e2e/bridge/` installs `window.__TAURI_INTERNALS__` and every `invoke()` resolves against in-memory state. **No Rust process is involved.**
- `pnpm e2e:dev` — headed/debug mode.
- Single spec: `pnpm exec playwright test e2e/specs/kanban.spec.ts`

### Codegen
- `pnpm tokens:build` — regenerates `src/app/styles/tokens.generated.css` from `design-tokens/tokens.json`. **Never hand-edit `tokens.generated.css`.**
- `pnpm icons:build` — sprite generation under `src/shared/ui/icon/`.

## Architecture

### Rust workspace (Clean-Architecture-ish, ADR-0001 §OQ-3)

Strict layering — imports go **downward only**:

```
src-tauri (shell)  →  api  →  application  →  domain
                   ↘  api  →  infrastructure (SQLite/FS/keychain)
                              ↘ clients (agent file adapters)
                   ↘  sidecar (Node MCP lifecycle bridge)
```

- `crates/domain/` — pure value objects + entity structs. **No IO, no async.**
- `crates/application/` — use cases that orchestrate domain + infrastructure. Owns `AppError` (the single typed error returned to Tauri).
- `crates/infrastructure/` — SQLite (rusqlite 0.32 + r2d2 pool, exact-pinned), filesystem, OS keychain (`keyring` 3 with per-target native backends).
- `crates/api/` — Tauri IPC layer: `handlers/<domain>.rs` + `events.rs`. The only "flat" artefact is the registration list that `src-tauri/src/lib.rs` passes to `tauri::generate_handler!`.
- `crates/sidecar/` — Node MCP sidecar lifecycle + sentinel-byte multiplexed stdio (`\x01` prefix = supervisor channel, plain frames = MCP SDK).
- `crates/mcp-server-bin/` — standalone `catique-hub-mcp` binary launched directly by external MCP clients (Claude Desktop, Claude Code, Codex). Owns its own DB pool; SQLite WAL handles concurrent reads if the Tauri UI is open.
- `crates/clients/` — agent-file adapters (Claude Code, Codex, etc.) for the role-sync pipeline.
- `src-tauri/` — Tauri shell binary. Window setup, plugin wiring, command registry. `tauri-plugin-single-instance` is wired so a second `tauri dev` focuses the running instance instead of opening a duplicate window.

### Frontend (FSD — 6 canonical layers, migration in progress on `refactor` branch)

```
src/
├── app/        providers, routing, root composition, styles, test-setup
├── pages/      route-bound composition slices (one slice per URL)
├── widgets/    reusable / layout UI blocks (sidebars, top-bar, toaster, shells)
├── features/   user interactions — dialogs, editors, action panels
├── entities/   domain primitives — model/store.ts (TanStack Query keys + hooks) + ui/<Component>/
├── shared/     ui (RAC-based kit), api (invoke wrapper), lib, storage, config
├── e2e/        mock IPC bridge for Playwright (gated behind VITE_E2E === "1")
└── types/      global .d.ts
```

Path aliases (mirror `tsconfig.json` and `vite.config.ts`):

| Alias | Target |
|---|---|
| `@/` | `src/` |
| `@app/` | `src/app/` |
| `@pages/` | `src/pages/` |
| `@widgets/` | `src/widgets/` |
| `@features/` | `src/features/` |
| `@entities/` | `src/entities/` |
| `@shared/` | `src/shared/` |
| `@bindings/` | `bindings/` (ts-rs output) |

**Import direction is strictly downward**: `app → pages → widgets → features → entities → shared`. Cross-slice imports inside the same layer go through `@x/` per FSD public API rule. `widgets → app/providers` (and other current violations) are tracked in `docs/audit/fsd-audit-2026-05.md` — when touching that code, fix it (move shared hooks like `useToast` into `shared/`) rather than extend the violation.

Until the F2–F4 phases complete, some `pages/<x>` slices are thin re-exports of legacy `widgets/<x>-page` modules — that's the documented intermediate state (see `docs/audit/fsd-audit-2026-05.md`).

### IPC contract & ts-rs bindings

The `bindings/` directory holds Rust→TypeScript type definitions emitted by `ts-rs` 8.x `#[derive(TS)] #[ts(export, export_to = "../../bindings/")]`. Files **are committed** (decision in `bindings/README.md`) so a fresh clone can `pnpm i && pnpm dev` without a Rust toolchain. Never hand-edit them — they get overwritten on `cargo test`. If a Rust struct changes its serde shape, run `cargo test -p catique-domain -p catique-api` and commit the bindings diff with the same PR.

IPC uses **camelCase** keys on the TS side; `i64` is `bigint`. The wrapper `src/shared/api/invoke.ts` is the only call site that imports `@tauri-apps/api/core`.

### TanStack Query as the IPC cache

Every entity in `src/entities/<x>/model/store.ts` exports a `<x>Keys` object (`all`, `byBoard(id)`, `detail(id)`, …) and hooks (`use<X>`, `useCreate<X>`, …) built on `useQuery`/`useMutation`. Mutations invalidate keys by convention; do not roll a parallel cache. `EventsProvider` (`src/app/providers/EventsProvider.tsx`) bridges Rust→TS realtime events into `queryClient.invalidateQueries` — when adding a new mutation on the Rust side, emit a matching event from `crates/api/src/events.rs` and invalidate the matching key set in the provider.

### Routing

`wouter` (~2 KB). The canonical map lives in `src/app/routes.ts`; build URLs through the helpers there (`boardPath`, `taskPath`, `rolePath`, …) instead of inlining strings. `pathForView`/`viewForPath` reconcile sidebar `NavView` ↔ URL and are the only place that should match URLs with `startsWith`/regex. Sidebar-driven navigation calls `setLocation(pathForView(view))`.

### E2E bridge

`src/e2e/bridge/` installs a permissive in-memory IPC mock at `window.__TAURI_INTERNALS__` so Playwright drives Chromium against a real `vite preview` without a Rust process. Tree-shaken out of dev/prod builds (`import.meta.env.VITE_E2E !== "1"`). When adding a new Rust command, the matching dispatch must be added to `src/e2e/bridge/handlers/<domain>.ts` (extension guide is in `src/e2e/bridge/index.ts` header). Window hooks `__E2E_RESET__()`, `__E2E_SEED__(snapshot)` are public — specs use them.

### Design tokens

`design-tokens/tokens.json` is the **single source of truth** for colors/spacing/radii/typography. `tools/tokens-build.ts` codegens `src/app/styles/tokens.generated.css`. `tokens.foundation.css` (typography primitives) loads first, then `tokens.generated.css`, then `globals.css`. Edit JSON + run `pnpm tokens:build`.

CSS is **CSS Modules only** — no Tailwind, no styled-components. In dev, classnames are human-readable (`[name]__[local]`); in build, 5-char hashes.

### Dev/prod data isolation

`crates/infrastructure/src/paths.rs` switches the on-disk root between `catique/` (release) and `catique-dev/` (debug) via `cfg!(debug_assertions)`. This is intentional and codified in D-018 — do not collapse it. `pnpm tauri:dev` writes to `~/Library/Application Support/catique-dev/` on macOS, so a packaged release bundle installed locally won't share state with the dev session.

## Repo-specific conventions

- **Conventional Commits** — `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`. CI does not enforce, but reviewers do.
- **Production code has no `unwrap()` / `expect()` (without proven invariant) / `panic!()` / `todo!()` / `unimplemented!()`** (NFR §3.1). Startup-phase errors log and return cleanly — don't panic in `src-tauri/src/lib.rs::run`.
- **No `format!` string SQL** with user input (NFR §4.3) — parameterized queries via rusqlite only.
- **Exact-pinned crates**: `serde`, `serde_json`, `ts-rs`, `rusqlite`, `r2d2*`, `include_dir`, `nanoid`, `sha2` (anything touching IPC or storage protocol). Other deps use caret SemVer. Pins are declared in `[workspace.dependencies]` in the root `Cargo.toml`.
- **License allowlist** (NFR §6.1): MIT, Apache-2.0, BSD, ISC, MPL-2.0, Zlib, Unlicense, CC0. **AGPL and SSPL are forbidden** — the `audit` CI job greps `cargo tree` and fails on either.
- **bindings/ stays committed** — see `bindings/README.md`. CI gate that diffs bindings is in the E2 backlog; until then, regenerate by hand when changing IPC-facing structs.
- **Default board model** (D-006): every space has a 1:1 owner role, a board named "Owner" with a mandatory default column. Don't break that invariant in seeders or migrations.
- **Role ownership invariant** (D-020): there are no shared boards. A space contains roles; each role owns exactly one board; a task on a role-owned board IS that role's task implicitly. **Do not** reintroduce role chips, role pickers, or "role" columns on the task surface (`TaskCard`, `TaskDialog`, task detail) — the board context already encodes the role. `task.roleId` exists on the entity for back-end resolver use, not for UI display.
- **`tokens.generated.css`, `bindings/*.ts`, `src/shared/ui/icon/sprite.*`** are codegen artefacts. Edit the source (`tokens.json`, Rust struct, `tools/icons-build.ts`) and rerun the generator.

## ADRs & docs worth reading first

- `docs/adr/ADR-0001-*` — Rust workspace layering (referenced as §OQ-3 in code).
- `docs/adr/ADR-0002-mcp-sidecar-architecture.md` — why the MCP sidecar is bundled Node, not in-process Rust. Touches `crates/sidecar/`.
- `docs/adr/ADR-0006-prompt-inheritance-resolver.md` — write-time materialisation of resolved prompts (D-004).
- `docs/adr/ADR-0007-mcp-server-registry.md` and `ADR-0008-mcp-pass-through-proxy.md` — MCP registry + proxy design; touches `crates/mcp-server-bin/` and `crates/clients/`.
- `docs/catique-migration/nfr-rust-stack.md` — NFRs cited above (perf budgets, lint gates, license rules).
- `docs/audit/fsd-audit-2026-05.md` — current FSD violations and the planned 5-layer target model.
- `docs/decision-log.md` — one-line index of D-NN decisions.
- `docs/release-runbook.md` and `release-runbook-codesigning-checklist.md` — packaging + notarization.

## CI gates (`.github/workflows/ci.yml`)

Three jobs, all must pass:

1. **Frontend** — `pnpm exec tsc --noEmit` → `pnpm exec vitest run --passWithNoTests`.
2. **Rust** — `cargo fmt --check` → `cargo clippy --workspace --all-targets -- -D warnings` → `cargo test --workspace --all-targets`.
3. **Audit** — `pnpm audit --prod --audit-level high` + `cargo tree | grep -E -i 'AGPL|SSPL'` (fails if matched).

`build.yml` and `release.yml` handle cross-platform `.dmg`/`.msi` packaging — CI runs Linux-only by design.
