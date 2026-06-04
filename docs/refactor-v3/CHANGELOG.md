# Refactor v3 — CHANGELOG

Branch: `refactor-v3-projectmap` (forked from `refactor`).
Driving doc: [`Project_map.md`](../../Project_map.md). Phasing: [`refactor-v3-plan.md`](../refactor-v3-plan.md).

This file lists every user-visible and architectural change that lands in v3. Group by phase. Linked PRs are TBD.

---

## Phase 0 — Decisions (no code, defines the surface)

Seven decision memos drafted under [`decisions/`](decisions/):

- **D-A** — Override semantics for skills + integrations (replace OR suppress).
- **D-B** — Denormalised effective-context counter columns on `tasks`.
- **D-C** — Version history for `role.content` / `prompt.content` (5-min debounce, 50-version retention).
- **D-D** — Activity-log scope columns + Tier-3 compaction + 90-day retention.
- **D-E** — Legacy route lookup-redirect resolver (`/boards/:id → /spaces/:spaceId/boards/:boardId`, `/roles → /agents`, `/mcp-servers → /integrations`).
- **D-F** — Pinned + Recent boards persistence (dedicated SQL tables + `settings` reuse for singletons).
- **D-G** — Audit of boards without role owner (clean locally; migration deferred unless collaborator data flags).

---

## Phase 1 — Navigation skeleton

- New `widgets/app-sidebar` consolidates the legacy `MainSidebar` + embedded `SpacesSidebar` into one rail with sections: Search → Pinned → Recent → Spaces tree → Agents / Prompts / Skills / Integrations → Settings. VSCode-style collapse + per-install persistence.
- New `widgets/status-bar` (always-visible bottom strip): MCP sidecar + connected-providers indicators, ⚙ button → drawer.
- New `widgets/system-drawer` (right-anchored slide-in): runtime controls for sidecar (start/stop/restart) and provider list. Uses react-aria `ModalOverlay` — focus trap, ESC dismiss, focus restore, `prefers-reduced-motion`-gated slide-in.
- v3 canonical routes: `/spaces/:spaceId`, `/spaces/:spaceId/boards/:boardId[/settings]`, `/agents[/...]`, `/integrations[/...]`. Legacy paths (`/boards/:id`, `/roles`, `/mcp-servers`) routable for one release; `LegacyBoardRedirect` rewrites dynamic ones via `boards.spaceId` lookup.
- `/` Home redirects to `last_active_space` when persisted, else empty-state cat.

## Phase 2 — Space day-screen

- New `pages/space-detail` (`/spaces/:spaceId`): Resume panel (last-opened board), Agents-in-space cards (boards grouped by role), Project-level config link, Activity log (collapsible).
- Activity log per-space query (`list_recent_events_by_scope`) lands in D-D.

## Phase 3 — Task surface

- New `widgets/effective-context-panel` mounted at top of `/tasks/:taskId`. Expanded by default. Sections per prompts/skills/integrations with `OriginBadge` chips.
- Preview prompt button — assembles the full prompt text from the bundle, opens read-only dialog.
- Override / Restore / Suppress UI flow (wired against D-A backend in Round 3).
- Direct attachments inline (`add_task_prompt/skill/mcp_tool`).
- Status badge on header — driven by `task:run:*` events (Round 2 J).
- RunningTaskIndicator on TaskCard.
- Effective count chip on TaskCard (D-B denorm).

## Phase 4 — Library pages

- `/agents` (rename of `/roles`) — toolkit-top → instructions → memory → working-in-spaces layout.
- `/prompts` — top tabs `Prompts | Groups | Tags`.
- `/skills` — `+ Export` button (markdown copy + share-via-git stub).
- `/integrations` (rename of `/mcp-servers`) — content unchanged; URL canonical.
- `OriginBadge` audited across role-attachments, board-settings inherited section, and `InlineGroupView` (the latter via new `group` variant — Round 4 R).

## Phase 5 — Cmd+K

- Command mode (typed `>`) — static nav, sidecar restart, per-space "Go to".
- Context-aware actions when on `/tasks/:id`: "Run agent on this task" + "Attach prompt: <name>" per known prompt.
- Search-mode prompt results merged client-side from `usePrompts()` (Round 4 S).
- Cmd+Enter on focused prompt result while on `/tasks/:id` attaches inline (does not close palette).
- Footer cheatsheet shows the active modal's keyboard contract.

## Phase 6 — Polish

- Settings trim — Profile + Connected agents sections removed; MCP sidecar section retained with drawer pointer.
- Cleanup — `__tmp_*` + Finder-duplicated `* 2` directories physically deleted; `tsconfig.json`/`vite.config.ts` exclude blocks dropped.
- a11y — focus order tests on AppSidebar, drawer ESC + focus restore, `OriginBadge` role + aria-label, StatusBar title-tooltips.

---

## Round 4 polish (in-flight at time of writing)

- Real `HistoryViewer` UI (replaces stub button — diff + revert).
- Drag-reorder Pinned + Clear Recent button.
- Activity log filter by event type chip strip.
- Sidecar Start/Stop IPCs (drawer footnote removed).
- "via group" OriginBadge variant + InlineGroupView audit.
- Cmd+Enter prompt-attach in Cmd+K search mode.
- Full Playwright e2e green pass.

---

## Backend slices (Rust)

| Migration | Description |
|---|---|
| `032_task_overrides_v2.sql` | D-A — replace-OR-suppress override surface for prompts, skills, mcp_tools |
| `033_task_effective_counts.sql` | D-B — denormalised counter columns + backfill |
| `034_content_versions.sql` | D-C — role + prompt content version history |
| `035_activity_log_scope.sql` | D-D — scope_kind/scope_id/count columns + index, 90-day retention |
| `036_pinned_recent_kv.sql` | D-F — pinned_boards + recent_boards tables |

New IPCs (selected):

- `set_task_{prompt,skill,mcp_tool}_override_v2` + `clear_*_override_v2`
- `list_role_versions` / `get_role_version` / `revert_role_to_version` (+ prompt twins)
- `list_recent_events`, `list_recent_events_by_scope`
- `list_pinned_boards`, `pin_board`, `unpin_board`, `reorder_pinned`
- `list_recent_boards`, `track_board_visit`, `clear_recent_boards` (Round 4 O)
- `run_task_agent` (emits `task:run:started`)
- `export_skill_as_markdown`
- `sidecar_start`, `sidecar_stop` (Round 4 Q)

ts-rs bindings regenerated in every applicable round.

---

## Preserved invariants

- **D-006 modal-only-on-create** — every edit/settings surface is a routed page with `← Back`; only create flows open modals.
- **D-020 role ownership** — no role chips/pickers on the task surface; `task.roleId` stays back-end-only.
- **Dev/prod data dir isolation** — `catique-dev/` vs `catique/` via `cfg!(debug_assertions)` in `paths.rs`.
- **CSS Modules only** — no Tailwind, no styled-components.
- **`bindings/` committed** — regenerated per round, no codegen at clone time.
- **No bare `window.localStorage`** outside `@shared/storage/`.

---

## Test coverage trajectory

- Pre-refactor baseline: ~973 frontend tests, full cargo green.
- Round 1: 1002 (added 16 + reconciled 11 frontend).
- Round 2: 1006 (run-lifecycle + skill export tests).
- Round 3: 1025 (override UI + a11y + D-F migration tests).
- Round 4: TBD pending agent completion.

---

## Out of scope

- FSD entity renames (`entities/role` → `entities/agent`, etc.) — tracked separately in `docs/audit/fsd-audit-2026-05.md`.
- CRDT-style realtime collaboration.
- MCP registry changes beyond URL rename.
- Skills V3 (steps generator, AI-suggested attachments).
