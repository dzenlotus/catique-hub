# Refactor v3 — post-migration notes

Maintainer-facing notes that aren't captured in [`CHANGELOG.md`](CHANGELOG.md) or the
Phase-0 decision memos. Things that bit me, patterns I'd lift to other refactors,
and pointers to non-obvious file relationships.

---

## Patterns worth lifting

### 1. UI stub → backend → real UI sequencing

When a feature requires backend storage that takes a while to design (D-C version
history, D-A overrides v2), we shipped the UI button as a disabled placeholder
that opened a dialog reading "Ships with D-C" / "Ships with D-A". This gave us:

- A mount point in the right header slot that we could review for placement.
- A way to dogfood the affordance — "yes the button belongs on the role editor
  header, not on a side panel".
- A trivial swap once the backend landed — replace `HistoryStubButton`'s body
  with the real `HistoryViewerButton` and the integration site is unchanged.

Cost: the stub button has to be replaced before release; lying placeholders ("Ships
with D-C") are anti-features after the backend ships. Track these in CHANGELOG
explicitly.

### 2. localStorage → SQL migration helper

D-F shipped `pinned_boards` + `recent_boards` SQL tables. The frontend used to
read localStorage. To migrate safely we ship a one-shot
`MigrateLegacyPrefsProvider` (`src/app/providers/MigrateLegacyPrefsProvider.tsx`)
that runs on first boot, reads the old keys, pushes via IPC, clears them. Wrapped
in try/catch per board so one FK failure doesn't abort the batch.

Pattern: keep the **old reader** functions exported under `*Legacy.ts` names so the
migration helper has a clean import surface that doesn't collide with the new
hook names.

### 3. Lookup-redirect resolver for renamed routes

`/boards/:id → /spaces/:spaceId/boards/:boardId` doesn't have spaceId in the URL
— so a static alias map can't redirect. The `LegacyBoardRedirect` component
mounts the page body normally while fetching the board, then `setLocation` with
`replace: true` once the spaceId resolves. Users see real content during the
fetch (not a "redirecting…" flash).

Static renames (`/roles → /agents`, `/mcp-servers → /integrations`) get the same
treatment without the lookup — both routes are registered in the TanStack
Router tree pointing at the same component, and `pathForView` emits only the
canonical path.

### 4. useSyncExternalStore + stable snapshots

`src/shared/storage/pinnedBoards.ts` shows the trap: `readPinnedBoards()` used
to call `.filter(...)` inline, returning a new array every read. React's
`useSyncExternalStore` saw "snapshot changed every render" → infinite loop →
`Maximum update depth exceeded` → ErrorBoundary swallowed the whole tree →
**blank screen at startup**.

Fix: cache the result tuple `(rawState, derivedArray)` at module level. As long
as `rawState === lastSeenRaw`, return the same `derivedArray` reference.
`Object.freeze(EMPTY)` for empty cases.

If you ever wire a new `useSyncExternalStore` reader for shared state, **always**
cache. Tests pass without it; the regression surfaces only in the browser.

### 5. Parallel agent dispatch with file-scope guards

We ran 4 (Round 1), 4 (Round 2), 3 (Round 3), 7 (Round 4) parallel agents
without merge conflicts. The key was every brief's **"Scope guard — do NOT
touch"** section listing the other streams' files. Each agent stayed in its lane.
The only collision happened in Round 1: Stream D's clippy gate caught
pre-existing lints in two files Stream A and B never touched — Stream D
documented them and the orchestrator (this assistant) fixed them after the
agents finished.

Workflow: orchestrator picks the streams, writes the brief with file paths +
existing patterns, dispatches with `run_in_background: true`, then runs the
full CI gate when every notification has landed.

---

## Files with non-obvious relationships

### `tsconfig.json` exclude block

Pre-refactor the repo had stale `src/pages/__tmp_*/` and Finder-duplicated
`src/features/* 2/` directories (from a prior aborted refactor). They contained
dead imports of `wouter` (long-retired router). The fix was a two-step:

1. Wave-6 / Round-1 Stream C added an `exclude` block to `tsconfig.json` + a
   matching exclude in `vite.config.ts` test config so `tsc`/`vitest` would skip
   them.
2. Stream C then physically deleted the directories once `git ls-files` confirmed
   none of them were tracked.
3. After deletion the `exclude` blocks were removed.

If you ever add a temporary tsconfig exclude, add a TODO with a removal target.

### `src/widgets/spaces-sidebar/SpacesSidebar.tsx` `embedded` prop

`SpacesSidebar` was originally a standalone widget mounted on every page that
needed a spaces tree. v3 consolidated it into `AppSidebar`. Round-3 Stream L
added an `embedded?: boolean` prop:

- `embedded={false}` (default): renders the full `SidebarShell` with the SPACES
  section header. This branch isn't actually used by any page right now, but
  Storybook stories rely on it.
- `embedded={true}`: drops the outer chrome — `AppSidebar` provides its own
  section header in the unified visual style.

If you delete the standalone variant, also delete the relevant stories.

### `EventsProvider` is the realtime bridge AND the v3 status flipper

`src/app/providers/EventsProvider.tsx` historically just listened to
`task:created` / `board:updated` etc. and called `queryClient.invalidateQueries`.
After Round 2 / Stream J it ALSO subscribes to `task:run:started` /
`:finished` / `:failed` and calls `setTaskStatus(taskId, status)` from
`@entities/task`. Same provider, two responsibilities.

Don't refactor it into two providers — they share the same Tauri event
subscription lifecycle.

---

## What we deliberately did NOT do (and why)

- **No FSD entity renames** (`entities/role` → `entities/agent`,
  `entities/mcp-server` → `entities/integration`). The URL rename is the v3
  surface; the FSD slice can rename independently in a follow-up. Tracked in
  `docs/audit/fsd-audit-2026-05.md`.
- **No `add_role_prompt` resolver change** for D-B (denorm counters). The
  scope-cascade hooks fire per-task after the existing materialisation pass —
  we did NOT change the resolver itself. ADR-0006's write-time materialisation
  is the layer below; D-B is the counter on top.
- **No new search backend for prompts.** Cmd+Enter prompt-attach in search-mode
  works by client-side filtering `usePrompts()` data. `search_all` Rust IPC is
  unchanged. If prompt search becomes load-bearing, extend `search_all` and
  remove the client filter.

---

## When to extend each Phase-0 decision

| Decision | When to revisit |
|---|---|
| D-A | Add a fourth override kind (e.g. attachments, files). Surface stays the same — just another `_v2` table. |
| D-B | If kanban renders 1000+ tasks (unlikely for a personal-tool product). Current denorm is O(1) per card. |
| D-C | Change retention or debounce window. Both are constants in `roles.rs` / `prompts.rs::snapshot_*_if_due`. |
| D-D | Add per-scope subscriptions (e.g. WebSocket per space). Today the bus is global; the frontend filters client-side. |
| D-E | Removal date for legacy routes. After one release of co-existence (telemetry shows < 1% hits), delete the aliases. |
| D-F | Sync across devices. SQLite is single-machine; CRDT or sync provider would go here. |

---

## Open questions left for the next refactor

1. **Multi-window state**. The v3 sidebar carries per-install collapse +
   pinned/recent state. If the user opens a second Tauri window (cmd+N in the
   future), both windows share the same SQLite state — good for pinned/recent
   but the AppSidebar `useSidebarCollapsed()` may toggle in both windows
   simultaneously (which is what users expect anyway). Verify with the
   eventual multi-window patch.
2. **Run lifecycle correctness**. `run_task_agent` IPC currently emits
   `task:run:started` and returns Ok. The real agent run pipeline (Cat-as-agent
   Phase 5) needs to wire `:finished` and `:failed` from its own
   completion/error paths. Until then, every "run" gets stuck on `running` until
   page reload — known stub.
3. **HistoryViewer line-diff scale**. The viewer renders the full content of
   both versions in a single `<pre>`. Prompts with 100k+ chars (unlikely but
   possible for long instructions) will hang. Add lazy diff or virtualization
   if it becomes an issue.

---

## Smoke-test cheatsheet for the next person

```bash
# Fast unit suite + typecheck
pnpm exec tsc --noEmit
pnpm exec vitest run

# Rust gates
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets

# Pure-vite smoke (no Tauri shell)
pnpm dev &
node smoke.mjs   # see docs/refactor-v3/smoke.mjs — Playwright headless boot

# Full Tauri-shell smoke
pnpm tauri:dev
# Click through: / → spaces tree → board → task → Effective Context Panel.
# Open Cmd+K, type ">", confirm command-mode actions.
# Open status bar drawer; click Restart, confirm toast.
```
