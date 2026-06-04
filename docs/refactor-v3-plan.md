# Refactor plan — Project Map v3

Source: [`Project_map.md`](../Project_map.md). Tracking branch: `refactor-v3-projectmap` (forked from `refactor`).

## Goal

Move the app from its current FSD-in-progress shell to the v3 target: a unified Spaces-first sidebar with Pinned/Recent, an opinionated Space-detail "day-screen", and a Task-detail page centred on the Effective Context Panel.

## Method

Phased — each phase ships an observable improvement and leaves the app shippable. Open issues from the map that need a product or backend decision are grouped at the top (Phase 0) so they unblock the later phases.

---

## Snapshot — gap analysis (today vs. v3)

| Area | Today | v3 target | Gap |
|---|---|---|---|
| Sidebar | Flat 6-row nav (`boards / agent-roles / prompts / skills / mcp-servers / settings`), no Spaces tree, no Pinned/Recent, no collapse, no search | Unified sidebar w/ Spaces tree (Pinned + Recent + list), Agents/Prompts/Skills/Integrations top-level, VSCode-style collapse, search field | Tree integration; pinning persistence; recent tracker; collapse mode; search filter |
| Status bar | Not present | Always-visible bottom bar w/ sidecar + providers indicators, right-click actions | New widget; lifts state from current Settings page |
| System drawer | Not present | Opens from status bar — runtime concerns | New widget; lifts sidecar + provider mgmt out of `/settings` |
| `/` route | Renders board list / first board | Redirect to `last_active_space` OR empty state w/ space picker | New behaviour; persistence key |
| `/spaces/:spaceId` (Space detail) | Doesn't exist — only `/spaces/:spaceId/settings` | Day-screen: Resume panel, Agents-in-space, Project-level config, Activity log | New page slice |
| `/spaces/:spaceId/boards/:boardId` | Canonical path is `/boards/:boardId`; space-scoped variant absent | Space-scoped canonical path | New canonical; old path becomes lookup-redirect (open issue #7) |
| `/tasks/:taskId` | Generic task detail | Effective Context Panel **expanded by default**, Preview prompt (dry-run), override/suppress/restore, live status badges | Heavy redesign of the page; needs `get_task_bundle` already exists ✅ |
| `/agents` (rename of `/roles`) | `/roles` exists | `/agents` canonical w/ legacy redirect; toolkit on top, instructions middle, spaces bottom; history/diff/revert | URL rename + page restructure + version history (open issue #5) |
| `/prompts` | List + groups + tags via single page | Same surface, but explicit tabs `Prompts / Groups / Tags`; **history per prompt** | Tabs UI; version history |
| `/skills` | List + detail + import-from-URL | + **export** (markdown / git URL) | Backend + UI |
| `/integrations` (rename of `/mcp-servers`) | `/mcp-servers` canonical | `/integrations` canonical w/ legacy redirect; runtime status moves to drawer | Rename + cull runtime widgets from settings |
| Cmd+K | `global-search` widget exists (search-only?) | Search **+ quick actions** registry | Action registry + per-context handlers |
| Effective context | `get_task_bundle` resolver exists in API | Used everywhere (kanban count, task detail, preview modal) w/ origin badges | Denormalized counter for kanban (open issue #3); `OriginBadge` reuse; `EffectiveContextPanel` widget |
| Overrides | `set_task_prompt_override` only | Override for skills + integrations too | Backend extension (open issue #1) |
| Live indicators | None | Spinner + colored bar in kanban; status badge on task detail | Event wiring + animation primitives |
| Pinned / Recent boards | None | Persisted in sidebar | New storage + UI |
| Origin badges | Present in some places | Everywhere attached items render | Lift `OriginBadge` to `shared/ui`, audit usages |

---

## Phase 0 — Decisions and backend unblockers

These need to land first because phases 4–6 wait on them. Each gets a short ADR/RFC under `docs/adr/`.

| # | Decision | Owner surface | Outcome |
|---|---|---|---|
| D-A | Override semantics for **skills + integrations** | `crates/application` + `crates/api` + ts-rs bindings | `set_task_skill_override` + `set_task_integration_override` (replace OR suppress); resolver in `get_task_bundle` honours them |
| D-B | Effective-context **counter denormalization** | SQLite schema migration + invalidation triggers | `task_row.effective_prompt_count` etc., refreshed by triggers OR application-layer recompute on source mutation |
| D-C | Version history granularity | `application` + new `*_versions` tables | Decision: debounce window, retention cap; applies to `role.content`, `prompt.content` |
| D-D | Activity log scope + retention | New `event_log` consumer or read model | Decision: which IPC events persist, query API, retention policy |
| D-E | Legacy route **lookup-redirect** semantics | `src/app/routes.ts` + a small resolver in `src/app/router/` | `/boards/:id` → `/spaces/:spaceId/boards/:boardId`; `/roles → /agents`; `/mcp-servers → /integrations` |
| D-F | Pinned + Recent **persistence** | Likely `kv_settings` table or user-prefs | Per-install (not per-space) — survives reboots |
| D-G | Data audit — boards without role owner | One-shot diagnostic script | Confirms D-020 invariant holds across all dev/test DBs; defines migration if not |

**Exit criteria for Phase 0:** seven short decision memos merged; backend tickets cut for D-A/D-B/D-C/D-D so they can run in parallel with Phase 1–3.

---

## Phase 1 — Navigation skeleton

Goal: the shell looks like v3 even if inner pages still re-export legacy widgets.

1. **Sidebar consolidation**
   - Merge `widgets/spaces-sidebar` + `widgets/main-sidebar` into a single `widgets/app-sidebar` with sections: Search · Spaces (Pinned / Recent / List) · Agents · Prompts · Skills · Integrations · Settings.
   - VSCode-style collapse (icons-only). Persist collapsed state in `kv_settings`.
   - Sidebar search field — local filter over space + board names; debounced.
   - Pinned + Recent: implement with the decision from D-F. Recent = LRU 5 boards.
   - Remove `widgets/prompts-sidebar` if its concerns fit inside the new unified sidebar; otherwise mark as panel-internal.

2. **Route map**
   - Add new routes in `src/app/routes.ts`:
     - `home: "/"` (empty / redirect)
     - `space: "/spaces/:spaceId"`
     - `spaceBoard: "/spaces/:spaceId/boards/:boardId"`
     - `spaceBoardSettings: "/spaces/:spaceId/boards/:boardId/settings"`
     - `agents: "/agents"` (alias of `/roles` until cutover)
     - `agent: "/agents/:agentId"`
     - `integrations: "/integrations"` (alias of `/mcp-servers`)
     - `integration: "/integrations/:serverId"`
     - `integrationTool: "/integrations/:serverId/tools/:toolId"`
   - Wire **lookup-redirect** resolvers per D-E. Legacy paths stay routable for one release, but issue a 302-like redirect inside `App.tsx` route table.
   - `pathForView` / `viewForPath` updated for the new nav rows.

3. **Status bar (`widgets/status-bar`)**
   - Two `StatusDot`s (sidecar, providers) + ⚙ button that opens system drawer.
   - Drawer (`widgets/system-drawer`) shows sidecar controls + connected providers. Lifts the runtime block out of `src/pages/settings`.

4. **`/` home behaviour**
   - Read `last_active_space` from `kv_settings`. If present → redirect. Else → empty state w/ Spaces picker.
   - Track `last_active_space` on space navigation.

**Phase 1 exit:** screenshots match the v3 navigation chrome. Inner page bodies can still be legacy.

---

## Phase 2 — Space detail (day-screen)

Goal: opening a space lands on the Resume panel, not a boards list.

1. **New page `pages/space-detail`** (route `/spaces/:spaceId`)
   - **Header** — name, icon, project folder shortcut, settings cog.
   - **Resume panel** (top, primary) — last task, last agent run, last edited prompt in this space. Persistence per-space (per D-F).
   - **Agents in this space** — cards w/ their boards underneath; "Add agent" CTA → reuses existing `connected-agents` feature. Per D-020 + Project Map: 1 agent → N boards allowed.
   - **Project-level configuration** — multiselects for prompts / skills / integrations attached to the space, with `OriginBadge` rendering on inherited items.
   - **Activity log** (collapsible) — last 20 events with type filter (per D-D).

2. **`/spaces/:spaceId/settings`** stays where it is; add "project folder" path picker (Tauri dialog) if missing.

3. **`/spaces/:spaceId/boards/:boardId`** — switch to the canonical space-scoped URL. Old `/boards/:id` redirects via D-E resolver.

**Phase 2 exit:** clicking a space in the new sidebar shows the day-screen; existing kanban still reachable via redirect.

---

## Phase 3 — Task detail = Effective Context Panel

This is "the centre of the product" per the map.

1. **`pages/task-detail` overhaul**
   - Header — title + slug + status badge (idle / queued / running / completed / failed). Status comes from event-bus state.
   - **EffectiveContextPanel** (new shared widget) **expanded by default**:
     - **Preview prompt button** — opens modal with the assembled text from `get_task_bundle`. Dry-run.
     - Prompts / Skills / Integrations lists w/ `OriginBadge` and overflow/strikethrough states (suppressed / replaced).
     - `[restore]` action on suppressed; `[override]` action on inherited.
   - **Direct task attachments** section — add buttons reuse `MultiSelect` (per the multiselect invariant — never an "attach dialog").
   - Description collapsed if > N lines.
   - Files + Reports unchanged in concept, but reports get the global Cmd+K search (Phase 5).

2. **Overrides UI** uses backend from Phase 0 D-A.

3. **Live indicators**
   - Kanban card: `RunningTaskIndicator` (spinner + colored stripe). Driven by an event channel out of `crates/api/src/events.rs` — events already exist for create/move/delete; add run lifecycle events if missing (`task.run.started`, `task.run.finished`, `task.run.failed`).
   - Task detail: status badge wired to same channel.

4. **Effective count on kanban** — uses denormalized counter per D-B. Avoid N×5 joins.

**Phase 3 exit:** opening a task lands on the Effective Context, Preview prompt works without launching a run, override / suppress / restore round-trip via UI.

---

## Phase 4 — Agents, Prompts, Skills, Integrations

Library pages get the v3 treatment in parallel — they're independent.

1. **`/agents` (renamed from `/roles`)**
   - URL rename per D-E. Internally still uses `entities/role` until the FSD rename phase F2–F4 catches up — that's documented in `docs/audit/fsd-audit-2026-05.md`.
   - Layout: toolkit (top) · instructions (middle) · spaces (bottom).
   - **History / diff / revert** for `role.content` per D-C.
   - Live working-in-spaces list.

2. **`/prompts`**
   - Tabs `Prompts / Groups / Tags`.
   - **History** per prompt per D-C.
   - Existing token-count auto-backfill stays.

3. **`/skills`**
   - **Export** (markdown / git URL) — new backend method `export_skill_as_markdown` + `export_skill_share_url` (TBD by `tech-analyst`).
   - Import-from-URL already exists.

4. **`/integrations`**
   - Rename `/mcp-servers` → `/integrations` per D-E.
   - Move sidecar + provider runtime widgets out — they live in the system drawer now.
   - Server/tool detail page bodies unchanged.

5. **OriginBadge audit** — promote to `shared/ui/origin-badge`; use everywhere attached items render (board settings, agent detail, prompt-in-group, etc.). Not only the Effective Context Panel.

**Phase 4 exit:** all four library surfaces match v3 specs; old URLs redirect; OriginBadge appears in every multiselect that renders attached items.

---

## Phase 5 — Cmd+K palette = search + actions

1. **Search side** — existing `global-search` widget extended:
   - Groups by entity type in the dropdown.
   - Includes reports (FTS5 hit on the agent-reports table).

2. **Action registry** — new `shared/lib/cmdk-actions`:
   - `> New task in <space>`
   - `> Go to space <name>`
   - `> Restart sidecar`
   - `> Run agent on current task`
   - `Find prompt X → Cmd+Enter` — attach to current task (context-aware: only enabled on `/tasks/:id`).

3. Keybindings — Cmd+K from anywhere; ESC dismiss; arrow nav; Enter / Cmd+Enter split actions per entity.

**Phase 5 exit:** Cmd+K from kanban opens an action-aware palette; "find prompt and attach to this task" works in one keystroke.

---

## Phase 6 — Settings + polish

1. **`/settings`** cleaned down to: Appearance · Shortcuts · Tokens · Data · About. Sidecar + providers fully relocated to drawer.

2. **Pinned + Recent** UI polish (drag-to-reorder pinned; clear-recent action).

3. **Live indicators** polish — debounce flicker; respect prefers-reduced-motion.

4. **Lookup-redirect cleanup** — legacy `/boards/:id`, `/roles`, `/mcp-servers` aliases removed once analytics show < 1% traffic. Until then, keep one release of overlap (per Project Map open issue #7).

5. **A11y + keyboard** audit on the new pages — drawer focus trap, status bar dot tooltips, sidebar collapse keyboard support.

**Phase 6 exit:** v3 navigation is canonical; legacy redirects scheduled for removal.

---

## Dependency graph

```
Phase 0 ──┬─► Phase 1 (D-E, D-F)
          ├─► Phase 2 (D-D, D-F)
          ├─► Phase 3 (D-A, D-B)
          └─► Phase 4 (D-C)
Phase 1 ──┬─► Phase 2 (sidebar + routes feed space-detail)
          └─► Phase 5 (Cmd+K context-aware actions)
Phase 2 ─► Phase 3 (URLs become space-scoped before task detail rework)
Phase 4 runs in parallel with Phase 2–3 once Phase 0 lands.
Phase 5 + 6 run after Phase 2–4.
```

---

## Status — what shipped in this pass

| Phase | Shipped | Deferred to backend |
|---|---|---|
| **0** | All 7 decisions drafted under `docs/refactor-v3/decisions/`. D-G audit ran locally — clean (no migration needed). | Backend tickets for D-A (override _v2 tables), D-B (denormalised counters), D-C (version-history tables), D-D (activity-log extension) — UI consumers are wired to land on these as soon as they arrive. |
| **1** | v3 routes (`/spaces/:id`, `/spaces/:id/boards/:id`, `/agents`, `/integrations`, legacy redirects). `LegacyBoardRedirect` rewrites `/boards/:id`. `StatusBar` widget (sidecar + provider dots → drawer). `SystemDrawer` widget. `SpaceDetailPage` stub (syncs ActiveSpace from URL). Tests updated to canonical paths. | Unified sidebar with Spaces tree + Pinned/Recent + collapse — requires D-F. |
| **2** | Full `SpaceDetailPage` day-screen — Resume panel (last board via `lastBoardStore`), Agents-in-space cards (boards grouped by role), Project-config link to settings, collapsible Activity log stub. Canonical `spaceBoardPath` helper. | Activity-log persistence + filters → D-D. |
| **3** | `EffectiveContextPanel` widget on task detail (expanded by default), `Preview prompt` modal (dry-run), shared `OriginBadge` in `shared/ui` consumed by the panel. `useTaskBundle` hook in `entities/task`. | Override buttons present but disabled — UI hook waits on D-A backend. Denormalised effective-count → D-B. Running-task indicator + status badge → wait on D-B + run-lifecycle events. |
| **4** | `RoleEditor` reorganised toolkit-top → instructions middle → memory → working-in-spaces. New `RoleSpacesSection` (boards owned by agent grouped by space). `/agents` + `/integrations` canonical URLs alias the existing pages. `OriginBadge` lifted to `shared/ui`. | History / diff / revert → D-C. Skill export → new backend. Full layout restructure → after backend hooks land. |
| **5** | Action registry + filter (`actions.ts`). `>`-prefix command mode in `GlobalSearch`. Static nav + dynamic per-space go-to + sidecar restart. Safe `useOptionalToast` / `useOptionalSpaces` shims so the palette survives Storybook + test harnesses. 8 new unit tests. | Per-task `Cmd+Enter` "attach prompt to current task" — depends on Phase 4 prompt-attach affordance reaching task detail. |
| **6** | `SystemDrawer` rewired through react-aria `ModalOverlay` — focus trap, focus restore, ESC + scrim dismiss, `prefers-reduced-motion`-guarded slide-in. `tsconfig` + `vite.config.ts` exclude refactor scratch directories so CI signal is clean. | Settings trim (sidecar/providers removal) — tests cover that section; safer to remove after the drawer is exercised in real use. Pinned/Recent UI → D-F. Legacy redirect removal → one release later per plan. |

## Out of scope for this refactor

- FSD renames `entities/role` → `entities/agent` and similar lexical renames (tracked separately in `docs/audit/fsd-audit-2026-05.md`).
- New CRDT-style realtime collaboration.
- MCP registry changes beyond URL rename.
- Skills V3 (steps generator, AI-suggested attachments).

## What this plan deliberately preserves

- Modal-only creation invariant (D-006).
- Role ownership invariant D-020 — no role chips on the task surface, no role pickers; `task.roleId` stays back-end-only.
- Dev/prod data dir isolation (`catique/` vs. `catique-dev/`).
- CSS Modules only — no Tailwind regression.
- `bindings/` stays committed; regenerate via `cargo test -p catique-domain -p catique-api`.
