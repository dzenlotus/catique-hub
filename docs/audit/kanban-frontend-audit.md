# Kanban Frontend Audit (round 19)

**Date:** 2026-05-01
**Auditor:** main agent (frontend-engineer delegation stalled at 600s; audit completed directly)
**Scope commit:** `32397a2`

## Status update (2026-05-02, round 19c)

Of the 13 findings below, **10 are closed**:

| Finding | Severity | Closed in |
|---|---|---|
| F-01 keyboard reachability | P0 | `ef68aaa` |
| F-02 missing kanban tests | P0 | `60a22e2` |
| F-03 mutation rollback | P1 | `ef68aaa` |
| F-04 mid-drag WS race | P1 | `7d26f78` |
| F-05 mixed RU/EN | P1 | `c7b9ad2` (ctq-76 i18n pass) |
| F-07 KanbanColumn memo | P2 | `0aeddc0` |
| F-08 type cast on `move()` | P2 | `38b8a5c` |
| F-10 retry both queries | P2 | `ef68aaa` |
| F-11 empty-state aria-label | P2 | `38b8a5c` |
| F-12 lastBoardStore relocation | P3 | `7c4c992` |

**Deferred** (dependencies on larger work):

- F-06 [P1] is-done-column heuristic — waits for ctq-73 Phase 2 schema (`Column.kind` field).
- F-09 [P2] god-component split — folded into ctq-73 Phase 2 UI rework.
- F-13 [P3] EventsProvider snake_case — needs Rust event-payload `#[serde(rename_all = "camelCase")]`.

Full backlog of original findings preserved below for traceability.

---

**Promptery task:** ctq-75
**Files audited:**

- `src/widgets/kanban-board/KanbanBoard.tsx` (472 LOC)
- `src/widgets/kanban-board/KanbanBoard.module.css`
- `src/widgets/kanban-board/KanbanColumn.tsx` (159 LOC)
- `src/widgets/kanban-board/KanbanColumn.module.css`
- `src/entities/task/ui/TaskCard/TaskCard.tsx` (452 LOC)
- `src/entities/task/api/tasksApi.ts`
- `src/entities/column/ui/ColumnHeader/ColumnHeader.tsx` (258 LOC)
- `src/entities/column/api/columnsApi.ts`
- `src/app/providers/EventsProvider.tsx` (Tauri event → react-query bridge)
- existing tests: `TaskCard.test.tsx` (250 LOC), `ColumnHeader.test.tsx` (82 LOC)

DnD library: `@dnd-kit/react ^0.4.0` (+ `@dnd-kit/helpers`, `@dnd-kit/abstract`).

---

## Executive summary

- **13 findings**: P0=2, P1=4, P2=5, P3=2.
- **Top-3 highest-impact actions:**
  1. Remove `tabIndex={-1}` from drag handles + selection checkboxes — restores keyboard reachability for DnD and bulk-select. Currently a WCAG 2.1.1 fail across 3 sites (`KanbanColumn.tsx:96`, `TaskCard.tsx:275`, `TaskCard.tsx:297`).
  2. Add `KanbanBoard.test.tsx` + `KanbanColumn.test.tsx` covering: optimistic move success, optimistic move with mid-drag WS event, mutation rollback on error. The DnD orchestration is the single most complex piece of FE state in the app and has zero direct test coverage.
  3. Wire `onError` for `moveTask.mutate` and `reorderColumns.mutate` — currently fire-and-forget; failed mutations leave the optimistic UI state stuck until a separate WS event refetches.
- **Overall verdict:** the kanban shell is structurally sound (clean FSD boundaries, sensible TanStack Query + WS bridge, optimistic updates wired correctly on the happy path). The gaps are concentrated in **a11y on DnD/selection** and **error-path resilience** — both are local fixes, not architectural rework. The Cat-as-Agent v1.0 refactor (ctq-73 Phase 2) should land on top of these fixes, not before.

---

## Findings

### F-01 — [P0] Drag handles & selection checkbox are keyboard-unreachable

**File:** `src/widgets/kanban-board/KanbanColumn.tsx:90-100`, `src/entities/task/ui/TaskCard/TaskCard.tsx:269-279`, `src/entities/task/ui/TaskCard/TaskCard.tsx:289-298`
**Category:** a11y
**Symptom:** column drag handle, task drag handle, and task selection checkbox all set `tabIndex={-1}`. Tab key skips them; SR users with no pointer cannot grab/drop or bulk-select.
**Root cause:** likely added to suppress focus during pointer-based drag flow, but the cure is worse than the disease — `@dnd-kit/react`'s keyboard activator (`KeyboardSensor` or RAC's drag-and-drop hooks) requires focusable handles to engage.
**Why it matters:** WCAG 2.1.1 (Keyboard) failure. The product's headline feature (DnD task moves) is unusable for keyboard-only users and screen-reader users. Bulk-select (round 15) is similarly unreachable.
**Suggested fix (S):** delete `tabIndex={-1}` on all three. Verify focus ring renders correctly (existing CSS `.dragHandle:focus-visible` style — add if absent). Ensure `@dnd-kit` keyboard sensor is registered (`useDraggable({ ... })` already exposes `handleRef`; the sensor is set up at the `DragDropProvider` level — verify keyboard sensor is in the default sensor set, otherwise opt in).
**References:** WCAG 2.1.1, `@dnd-kit/react` `KeyboardSensor` docs.

### F-02 — [P0] No tests for `KanbanBoard.tsx` or `KanbanColumn.tsx`

**File:** `src/widgets/kanban-board/` (no `*.test.tsx` exists)
**Category:** tests
**Symptom:** `find … -name '*.test.*' -path '*kanban*'` returns empty. The 472-line `KanbanBoard.tsx` and 159-line `KanbanColumn.tsx` ship without unit or integration tests.
**Root cause:** test file was never written; rounds 17-18 added optimistic DnD + slimming without test coverage.
**Why it matters:** the DnD lifecycle (drag start → over → end → mutate → reconcile) is the single most subtle state machine in the FE. Regression risk on every refactor (Cat-as-Agent will refactor this surface). Test coverage for `TaskCard` (250 lines, child of column) does not exercise drag composition.
**Suggested fix (M):** at minimum:
- `KanbanBoard.test.tsx` — render with mock columns/tasks, simulate `DragEndEvent` for column reorder + task move (intra-column + cross-column), assert mutation called with correct payload.
- `KanbanColumn.test.tsx` — render, assert column header + drag handle present, empty-state button click invokes `onAddTask`.
- One integration test: optimistic update applied immediately, then settled when mutation resolves.
**References:** `vitest`, `@testing-library/react`, existing `TaskCard.test.tsx` for pattern.

### F-03 — [P1] `moveTask` and `reorderColumns` mutations have no error handling

**File:** `src/widgets/kanban-board/KanbanBoard.tsx:213-214`, `src/widgets/kanban-board/KanbanBoard.tsx:239-244`
**Category:** error handling
**Symptom:** `moveTask.mutate({...})` and `reorderColumns.mutate({...})` fire without `onError` / `onSettled`. If the IPC fails (validation rejection, sqlx FK violation, sidecar crash), the optimistic local state is never rolled back. The UI shows the wrong order until a separate WS event triggers a refetch — and no WS event fires for a failed mutation.
**Root cause:** mutations were wired for the happy path; error handling deferred but never retrofitted.
**Why it matters:** silent UI-DB drift. User drags a task; it appears moved; refresh later reveals it never moved. Trust-killer for a personal-tool ethos.
**Suggested fix (S):** add `onError` handler that:
- Calls `tasksQuery.refetch()` / `columnsQuery.refetch()` to restore truth from server.
- Pushes a toast via the existing `useToast` provider: e.g. "Не удалось переместить задачу. Попробуйте ещё раз."
**References:** existing `useToast` pattern in `ClientInstructionsEditor.tsx:139-146`.

### F-04 — [P1] WS event during active drag silently overwrites user's in-progress state

**File:** `src/widgets/kanban-board/KanbanBoard.tsx:145-149`, `src/widgets/kanban-board/KanbanBoard.tsx:160-165`
**Category:** state management
**Symptom:** the `useEffect` that syncs `serverItems` → local `items` is gated by `draggingRef.current`. While dragging, server changes are ignored. On `dragEnd`, `draggingRef = false`, the useEffect fires on the next render, and the local `items` is overwritten with whatever the server now says — potentially clobbering the user's drop.
**Root cause:** intentional latch to prevent flicker during drag, but the post-drag overwrite has no awareness of the drop the user just performed (the optimistic mutation hasn't settled yet, so `serverItems` still reflects the pre-drop state plus any concurrent change).
**Why it matters:** with two clients editing the same board (or one client with a fast WS event during a slow drag), the dropped task can "snap back" to its origin column for one frame before the optimistic update from the local mutation settles. Not a hard fail today (single-user) but will bite in multi-window scenarios planned for v0.7+.
**Suggested fix (M):** make the post-drag sync respect in-flight optimistic state. Either:
- Wait for the local mutation to resolve before letting `useEffect` overwrite (`mutate.isPending` gate).
- Switch to `react-query`'s built-in optimistic update + `onMutate` snapshot; remove local `items` state entirely.
**References:** TanStack Query optimistic-updates docs.

### F-05 — [P1] Mixed RU/EN UI text without a localization layer

**File:** `src/widgets/kanban-board/KanbanColumn.tsx:95` (`"Перетащить колонку"`), `src/widgets/kanban-board/KanbanColumn.tsx:131` (`"Задачи отсутствуют"`), `src/widgets/kanban-board/KanbanColumn.tsx:154` (`"Add task"`), `src/widgets/kanban-board/KanbanBoard.tsx:303` (`"Failed to load board"`), `src/widgets/kanban-board/KanbanBoard.tsx:320-321` (`"No columns yet"` / `"Add a column to start organizing tasks."`), `src/entities/task/ui/TaskCard/TaskCard.tsx:273` (`"Перетащить задачу"`).
**Category:** a11y / code-quality
**Symptom:** copy mixes Russian and English in the same widget with no apparent rule.
**Root cause:** historical drift; no i18n layer was set up for the migration.
**Why it matters:** SR users hear inconsistent label languages mid-flow. Marketing materials (mascots, lore bible) lean RU+EN per `landing-page-craft` prompt; the app should match.
**Suggested fix (M):** thin localization layer (no library — a `messages.ts` map per widget OR a single `t()` helper). Lock all kanban copy to one default (EN) until i18n design lands.
**References:** `migration-strategy-promptery-to-catique` prompt mentions RU+EN locale; no concrete plan in repo yet.

### F-06 — [P1] `is-done-column` is a substring heuristic that breaks easily

**File:** `src/widgets/kanban-board/KanbanColumn.tsx:86-88`
**Category:** code quality
**Symptom:** `column.name.toLowerCase().includes("done") || .includes("готово")`. A user-renamed column ("Released", "Shipped", "Закрыто") loses done-styling. A column named "Doneness QA" gets it incorrectly.
**Root cause:** no domain flag; column-name string is the only signal.
**Why it matters:** Cat-as-Agent (ctq-73 D3) makes `done` a **mandatory column** — the heuristic could be replaced with a stable id check then. Today, every renamed Promptery board breaks the styling.
**Suggested fix (S):** until ctq-73 Phase 2 lands, switch to "is the rightmost column" heuristic (last in `orderedColumns`). After Phase 2, use the column id (`done`) directly — `Column.kind: 'incoming' | 'in_progress' | 'done' | 'custom'` per ADR.
**References:** ctq-73 §D3 (mandatory columns).

### F-07 — [P2] `KanbanColumn` is not memoised; any state change re-renders every column

**File:** `src/widgets/kanban-board/KanbanColumn.tsx:60` (component definition — exported as named function, not wrapped in `React.memo`)
**Category:** performance
**Symptom:** typing in the "Add column" `<Input>` (line 425) updates `newColumnName` state on `KanbanBoard`, which re-renders the whole tree. Each `KanbanColumn` and each `TaskCard` re-renders on every keystroke.
**Root cause:** missing memoisation; callbacks `onTaskSelect` / `onAddTask` / `onRenameColumn` / `onDeleteColumn` are recreated every render, so even a memoised column would re-render anyway.
**Why it matters:** small board (3 columns × 5 tasks) is fine; large board (10 columns × 30 tasks) shows visible jank when typing in the column name field. Will be felt more once Cat-as-Agent boards have step-log subscribers.
**Suggested fix (S):** wrap `KanbanColumn` in `React.memo` AND wrap callbacks in `useCallback` at the parent — both required, neither sufficient alone.
**References:** React memoisation rule of thumb — only when reference identity is stable.

### F-08 — [P2] Type cast `move(items, event) as TaskBuckets` defeats type checking

**File:** `src/widgets/kanban-board/KanbanBoard.tsx:198`, `KanbanBoard.tsx:202`
**Category:** code quality
**Symptom:** `move()` from `@dnd-kit/helpers` returns `unknown`-ish; the code casts to `TaskBuckets` / `string[]` without runtime check.
**Root cause:** `@dnd-kit/helpers` `move()` is generic but the caller does not pass the type parameter.
**Why it matters:** wrong type drift goes unnoticed at compile time; a regression in dnd-kit's helpers signature would fail silently.
**Suggested fix (S):** call `move<TaskBuckets>(current, event)` and `move<string[]>(current, event)` with explicit generics. Verify against the `@dnd-kit/helpers` `move` signature.
**References:** `@dnd-kit/helpers` source.

### F-09 — [P2] `KanbanBoard.tsx` is a 472-line god-component

**File:** `src/widgets/kanban-board/KanbanBoard.tsx` (entire file)
**Category:** code quality / FSD
**Symptom:** state (`items`, `orderedIds`, `newColumnName`, `isAddingColumn`, `taskColumnId`), refs (`itemsRef`, `orderedIdsRef`, `draggingRef`), 5 mutations, 4 useEffect blocks, `bucketTasks` / `findTask` / `nextPosition` / `columnIds` helpers, and 3 render branches (loading / error / empty / main) all live in one component.
**Root cause:** organic growth across rounds 17–18.
**Why it matters:** hard to test (F-02), hard to refactor for Cat-as-Agent (ctq-73 will rewrite this), invites bugs on every change.
**Suggested fix (M):** extract:
- `useKanbanBoardState(boardId)` hook returning `{ items, orderedColumns, draggingRef, handleDragStart, handleDragOver, handleDragEnd, mutations }`.
- `BoardHeader`, `AddColumnForm`, `BoardLoadingSkeleton`, `BoardErrorState`, `BoardEmptyState` sub-components.
- Pure utilities (`bucketTasks`, `nextPosition`, etc.) into `src/widgets/kanban-board/utils.ts` so they're independently testable.
**References:** previous refactor of `MainSidebar` into `MainSidebar` + `NavRow` + `workspaceItems`.

### F-10 — [P2] Retry button after fetch error refetches only one of two queries

**File:** `src/widgets/kanban-board/KanbanBoard.tsx:293-310`
**Category:** error handling
**Symptom:** if both `columnsQuery` and `tasksQuery` fail, `failedQuery` resolves to whichever errored first (or `tasksQuery` as fallback at line 298). The Retry button calls `failedQuery.refetch()` — only one of two. The other stays errored.
**Root cause:** the `failedQuery` ternary picks one query; fix is straightforward.
**Why it matters:** transient network outages leave one query in error state and an unresponsive UI even after the user retries.
**Suggested fix (S):** Retry should call both `columnsQuery.refetch()` AND `tasksQuery.refetch()`. Trivial.
**References:** TanStack Query `refetch` docs.

### F-11 — [P2] Empty-state button on empty column has no semantic action label

**File:** `src/widgets/kanban-board/KanbanColumn.tsx:124-132`
**Category:** a11y
**Symptom:** `<button>Задачи отсутствуют</button>` is a clickable element that creates a task on click, but its accessible name is the empty-state hint, not the action. SR users hear "Задачи отсутствуют, button" — they cannot guess that clicking it adds a task.
**Root cause:** button doubles as both empty-state copy and action trigger.
**Why it matters:** SR users skip past it; pointer users discover it by trial.
**Suggested fix (S):** add `aria-label={`Add task to column ${column.name}`}` and keep the visible text. Or split into static `<p>` empty-state copy + a separate "Add task" button below. Same pattern as the column footer "Add task" at line 148-156.
**References:** WCAG 2.5.3 (label-in-name).

### F-12 — [P3] Cross-widget import for `lastBoardStore`

**File:** `src/widgets/kanban-board/KanbanBoard.tsx:31`
**Category:** FSD
**Symptom:** `import { lastBoardStore } from "@widgets/board-home";`. A widget importing a peer widget for a small storage helper.
**Root cause:** convenience; the helper happened to live next to its first consumer.
**Why it matters:** FSD discourages cross-widget coupling. `lastBoardStore` is a `KeyValueStore`-flavoured helper — `src/shared/storage/` is the canonical home (where `LocalStorageStore.ts`, `KeyValueStore.ts`, `useLocalStorage.ts` already live).
**Suggested fix (S):** move `lastBoardStore` to `src/shared/storage/lastBoardStore.ts`, re-export from `src/shared/storage/index.ts`, update both widgets.
**References:** `feature-sliced design` layer rules.

### F-13 — [P3] EventsProvider mixes snake_case (`board_id`) with camelCase elsewhere

**File:** `src/app/providers/EventsProvider.tsx:66-78` (and below)
**Category:** code quality
**Symptom:** Tauri events deliver payloads with snake_case field names (`board_id`); the rest of the FE uses camelCase. The provider destructures snake_case at the consumption site.
**Root cause:** ts-rs / serde defaults — events use Rust-native naming; entities use `#[serde(rename_all = "camelCase")]`.
**Why it matters:** harmless today, but inconsistent. A new contributor will guess wrong.
**Suggested fix (S):** apply `#[serde(rename_all = "camelCase")]` to the event payload structs in `crates/api/src/events.rs` so events match the rest of the API. Frontend then uses `boardId` consistently.
**References:** existing serde rename pattern across `crates/domain/src/`.

---

## Per-category coverage

| Category | Findings | Notes |
|---|---|---|
| FSD | 1 (F-12) | One cross-widget import; otherwise clean separation. |
| State management | 1 (F-04) | Mid-drag WS reconciliation gap. Otherwise TanStack Query + EventsProvider bridge is solid. |
| Accessibility | 4 (F-01, F-05, F-11; partial F-09) | Most concentrated category. DnD handles + selection are the headline issue. |
| Performance | 1 (F-07) | Memoisation gap. No virtualisation observed but no pressure today. |
| Error handling | 2 (F-03, F-10) | Mutation rollback + retry-button correctness. |
| Test coverage | 1 (F-02) | Zero tests for the kanban widgets — biggest risk for the upcoming Cat-as-Agent refactor. |
| Code quality | 4 (F-06, F-08, F-09, F-13) | God-component + heuristic + type cast + naming convention. |

All seven categories produced findings. No "no findings" claims required.

---

## What works well

- **TanStack Query + Tauri-event bridge is correctly wired.** `EventsProvider.tsx` invalidates the right keys per event; query-key naming (`tasksKeys`, `columnsKeys`, `boardsKeys`) is consistent across entities and provider.
- **FSD separation is clean for the data layer.** `entities/task/api/tasksApi.ts` wraps all `invoke` calls with `invokeWithAppError`; widgets never call `invoke` directly. Same shape mirrored across `entities/column/`, `entities/board/`, `entities/connected-client/`.
- **Optimistic DnD on the happy path works.** `draggingRef` latch prevents server-state flicker mid-drag; local `items` and `orderedIds` keep refs in sync via `setSyncedItems` / `setSyncedColumnIds` so the `dragEnd` handler reads consistent state. The state machine's pieces are right; the gaps are at the boundaries (F-03, F-04).
- **Error and empty states exist and are styled.** `KanbanBoard.tsx` handles `pending` / `error` / `empty` branches before the main render — no naked spinner. CSS Modules drive the skeleton.
- **CSS Modules + design tokens are honoured.** No hardcoded `#hex` in the audited CSS files. `var(--space-*)`, `var(--radius-*)`, `var(--color-*)` used throughout.
- **TypeScript hygiene is mostly good.** The audited code has no `any` and no unjustified `as` outside the dnd-kit `move()` cast (F-08). `Task` / `Column` / `Board` types are exported from each entity's barrel.

---

## Recommended next Promptery tasks

Three follow-ups for the P0/P1 findings. Each is independently shippable.

1. **`[S] Restore keyboard reachability for kanban DnD + bulk select`** — fixes F-01, F-11. Removes 3 `tabIndex={-1}` sites, adds `:focus-visible` styles, adds `aria-label` to empty-state button. ~30 min of work, must ship before any product demo to non-pointer users.
2. **`[M] Kanban widget test coverage`** — fixes F-02. New `KanbanBoard.test.tsx` + `KanbanColumn.test.tsx` covering drag-end happy path, mutation error → rollback, empty state. Pre-requisite for the Cat-as-Agent Phase 2 refactor (ctq-73) — guards against regression during the rewrite.
3. **`[M] Kanban error path + i18n consolidation`** — fixes F-03, F-04, F-05, F-10. `onError` handlers on all mutations, refetch-both on retry, mid-drag WS reconciliation, single-language pass on copy. Small individually, useful as one cohesive PR.

The remaining P2/P3 findings (F-06, F-07, F-08, F-09, F-12, F-13) can be folded into the Cat-as-Agent Phase 2 refactor (ctq-73 §Phase 2 — UI rework) since that phase will already touch these surfaces — no separate task needed.

---

## Out of scope (intentionally not audited)

- Backend / Rust workspace (`crates/*`) — owned by `rust-backend-engineer` (ctq-73 Phase 1 just landed in working tree).
- Design critique — covered by `docs/design-system-v1/components.md` §3 (Column), §4 (TaskCard), §10 (mascots) and `docs/lore/lore-bible.md`.
- Performance benchmarks — no infra; F-07 is a mental-model claim, not a measurement. A real benchmark requires React DevTools Profiler and a synthetic 50-task fixture.
- Visual regression — no Storybook/Chromatic in this audit; existing `*.stories.tsx` not exercised.
- E2E (Playwright/Webdriver) — not in scope; project does not currently run E2E tests in CI per `package.json` inspection.
