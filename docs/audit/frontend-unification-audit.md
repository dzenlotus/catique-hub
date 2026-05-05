# Frontend Unification Audit — Catique HUB

**Auditor:** frontend-engineer (sr.) **Date:** 2026-05-05 **Scope:** `src/`
+ Rust IPC contract checked at boundary. **Source:** the 14 maintainer
complaints + product invariants in `project_catique_product_model.md`.

---

## 1. Executive summary — top 5 highest-impact actions

1. **Skills/MCP create flows are broken end-to-end** because TS omits the
   non-optional `position: f64` arg the Rust handler requires
   (`createSkill`, `createMcpTool` vs `crates/api/src/handlers/skills.rs:41`,
   `mcp_tools.rs:41`). Single-line fix per slice unblocks two whole pages.
2. **`useAddTaskPromptMutation` does not invalidate `tasksKeys.prompts`**
   (`src/entities/task/model/store.ts:212-220`). Prompt attaches succeed
   server-side but the chip row never refreshes — exactly the symptom
   the maintainer described as "prompts-attach is broken".
3. **Boards still creatable as a top-level action** (`BoardsList.tsx:66-74`,
   `BoardCreateDialog.tsx`) — violates the head invariant. Add-role
   inside a space is the only entry point that should materialise a
   board. `BoardCreateDialog` must be removed from user-reachable menus.
4. **Every editor (Role/Skill/McpTool/Tag/Prompt/PromptGroup/Column) is a
   modal** (`<Dialog>` wrapper). Modal = creation only — these have to
   become routed pages mirroring the existing `BoardSettings` /
   `SpaceSettings` / `TaskView` pattern.
5. **No canonical `<EditorShell>` and no canonical "form-row" Select.**
   Native `<select>` + bespoke CSS in `BoardCreateDialog` and
   `BoardSettings`; `type="color"` reinvented in 11 widgets; sticky
   footers solved per-dialog and broken on every routed editor page.
   Lands as one shared primitive each.

---

## 2. Product invariants the audit enforces

Restated from `~/.claude/projects/.../memory/project_catique_product_model.md`:

- **spaces → roles → boards.** No standalone board creation. Adding a
  role inside a space materialises the board.
- **Modal = creation only. Page = editing/viewing existing entity.** Always.
- **Attach via multiselect, never a dedicated dialog.** Promptery convention.
- **No "cat" in user-facing strings.** Use "role" or "agent". Cat lore
  lives in marketing/docs only.
- **All form controls come from `src/shared/ui/`.** No bespoke
  select/input/button/chip styling per surface.
- **Sticky footers on editor surfaces.** Single `EditorShell` primitive.
- **`description` / `position` / `space` fields stay out of forms unless
  consumed by a visible surface.**

---

## 3. Findings — the 14 maintainer complaints

### F-01 — Skills cannot be created [P0 / S]

- **Where:** TS `src/entities/skill/api/skillsApi.ts:65-77` — `CreateSkillArgs`
  has `name`, optional `description` + `color`, no `position`.
  Rust `crates/api/src/handlers/skills.rs:41-51` — `create_skill(name,
  description, color, position: f64)` requires `position` non-optional.
  Tauri's serde rejects the call before reaching the handler body.
- **Gap:** TS payload omits `position`; deserialization fails silently
  (Tauri's serde error path returns a non-`AppError` shape, so
  `SkillCreateDialog.tsx:94-97` shows a generic "Failed to create"
  message and the user is stuck.
- **Target:** Either (a) extend `CreateSkillArgs` with `position: number`
  and pass `0` from the dialog, OR (b) make the Rust arg `Option<f64>`
  and default to a "next position" inside the use case. Option (b) is
  cleaner — the FE never owns ordering.
- **Fix size:** S (TS slice + Rust handler signature, no DB change).

### F-02 — MCP tools cannot be created [P0 / S]

- **Where:** TS `src/entities/mcp-tool/api/mcpToolsApi.ts:65-81` and
  Rust `crates/api/src/handlers/mcp_tools.rs:41-58` — same shape as F-01:
  Rust requires `position: f64`, TS omits it.
- **Target:** Same as F-01 — make `position` optional server-side OR add
  the field to the JS payload.
- **Fix size:** S.

### F-03 — Sub-agents not honouring Promptery conventions [P1 / process]

- **Routinely violated:**
  - **Direct `invoke()` in widget components** (FSD violation): production
    callers `widgets/board-create-dialog/BoardCreateDialog.tsx:22+169`,
    `widgets/board-settings/BoardSettings.tsx:27+195`,
    `widgets/cat-migration-review-modal/CatMigrationReviewModal.tsx:41`,
    `widgets/global-search/GlobalSearch.tsx:16`,
    `widgets/settings-view/SettingsView.tsx:16`. Convention: every IPC
    call lives in `entities/<slice>/api/`, exposed through a hook in
    `entities/<slice>/model/`. Widgets only consume hooks.
  - **Missing barrel re-exports** — the prompts-sidebar `PromptRow`,
    `GroupRow`, `PromptsSettingsButton`, `TagsFilterButton` are not in
    the slice `index.ts`. Imports therefore reach into folder internals.
    `src/widgets/prompts-sidebar/` exposes only `PromptsSidebar`-relevant
    types; consumers shouldn't reach in.
  - **`data-testid` formats inconsistent** — most are
    `<scope>-<purpose>` but several lack the entity-id suffix
    (`task-card-attachments`, `task-card-done-check`). Required format:
    `<scope>-<component>-<purpose>[-<entityId>]`.
  - **`position` exposed in surfaces the user shouldn't touch** —
    `ColumnEditor.tsx:314`, `PromptGroupEditor.tsx:295`. Drag-reorder is
    already wired, the numeric field is a footgun.
- **Target shape:** ESLint `eslint-plugin-boundaries` (or
  `@feature-sliced/eslint-config`) with a CI gate that blocks new
  `invoke(` outside `shared/api` and `entities/*/api/`. Add a docs entry
  documenting `data-testid` schema.
- **Fix size:** M (config + code-mod).

### F-04 — Feature parity with Promptery far short [P1 / L]

Concrete regressions noted by walking the surfaces:

- **Prompt multiselect attach** (Promptery's chip-input pattern). Catique
  has only the modal `AttachPromptDialog`. The primitive
  `MultiTagInput` already exists in `shared/ui/MultiTagInput/` —
  unused for role/task prompt attachment.
- **Agent-reports browsing.** `widgets/agent-reports-list` exists but
  `routes.reports` is not in the sidebar (`workspaceItems.tsx`); the
  route only resolves through `App.tsx:118-120`. Reports are functionally
  unreachable for the user.
- **Tags page** — same: `routes.tags` orphaned (`viewForPath` does not
  cover `/tags` either).
- **Bulk task selection** present (`useTaskSelection`), but the
  multi-select flow stops at delete; no "move to status", "set role",
  "set board" — Promptery had those.
- **Task quick-actions** (slug copy, paste markdown image, drag-drop
  files into description) — all absent.
- **Per-board archive view, "show done"** — missing.
- **Connected-clients panel** exists as a widget (`connected-agents-section`),
  but it's only rendered in `SettingsView` not prominently.

### F-05 — Spaces own ROLES, not boards (head invariant) [P0 / L]

- **Where standalone board creation is reachable:**
  - `BoardsList.tsx:66-74` — top-of-page "Create board" CTA.
  - `BoardsList.tsx:124-131` — empty-state CTA "Create board".
  - `BoardCreateDialog` is mounted as a top-level dialog at
    `BoardsList.tsx:168-171`.
  - `BoardCreateDialog.tsx:312-374` exposes a `<select>` Space picker
    *and* an Owner-cat picker — both should disappear under the new
    flow because the user enters the create path from a space context
    (so `spaceId` is implicit) and the role IS the create trigger.
- **Where role addition currently lives:** `RoleCreateDialog.tsx` — does
  NOT mention Space. There is no UI for "add role to space" at all.
  The sidebar (`SpacesSidebar.tsx:118-124`) has only `Add space`.
- **Target shape:**
  1. Add a per-space `Add role` affordance to `SpaceRow` (sibling of
     the chevron / kebab).
  2. The handler opens a single `<Dialog>` ("Create role") that on save
     fires both `create_role` (or links existing) AND
     `create_board(role_id, space_id)`. Backend must expose a single
     `create_role_in_space` use case to keep this atomic — until then
     orchestrate sequentially with an undo path on partial failure.
  3. Remove the top-level `Create board` CTA, the `BoardCreateDialog`
     top-level mount, and the empty-state board CTA. The "no boards
     yet" empty state should point to "Add a role to a space".
  4. `BoardSettings` keeps its place (existing boards remain editable).
  5. The "Main board" rendered as a default placeholder per space —
     created server-side when a space is created (already wired:
     `BoardsList.tsx` filter + the per-space default-board guard).
- **Fix size:** L. Touches BoardsList, SpacesSidebar/SpaceRow,
  RoleCreate flow, BoardCreateDialog (delete from user paths), routes,
  tests, and the use-case in Rust.

### F-06 — Selects styling-broken (count + unify) [P1 / M]

- **Distinct Select implementations in `widgets/`:**
  - **Canonical `<Select>`** (`shared/ui/Select/`) — used by
    `TaskDialog.tsx:328-369` (FieldSelect wrapper).
  - **Native `<select>`** with bespoke CSS:
    - `BoardCreateDialog.tsx:316-334` (Owner-cat) — class
      `styles.select`, label-wrap pattern.
    - `BoardCreateDialog.tsx:358-371` (Space).
    - `BoardSettings.tsx:373-396` (Owner-cat) — different class
      `styles.fieldSelect`.
  - **`<Listbox>` from `shared/ui`** used as a "select" in
    `BoardSettings.tsx:419` for Space.
  - **Combobox** used as a Select-equivalent in `AttachPromptDialog`,
    `prompt-tags-field` (legitimate combobox use).
  - **`<select>` for color** — `type="color"` reinvented 11 times
    (`role-editor`, `prompt-group-create-dialog`, `skill-create-dialog`,
    `mcp-tool-create-dialog`, `tag-create-dialog`, `tag-editor`,
    `prompt-group-editor`, `mcp-tool-editor`, `skill-editor`,
    `role-create-dialog` — `IconColorPicker` already exists in
    `shared/ui/IconColorPicker/IconColorPicker.tsx:121` and renders a
    consistent picker).
- **Distinct stylings:** at least 4 (Select, native fieldSelect,
  bespoke `BoardCreateDialog.module.css` `.select`, bespoke
  `BoardSettings.module.css` `.fieldSelect`).
- **Target:** all Select-like fields render `<Select>` from
  `shared/ui/Select`. Per-site differences come from variant props
  (size, label position) NOT class overrides. Migration list under §4.
- **Fix size:** M (mechanical migration).

### F-07 — `Position` / `Space` fields shouldn't be on column / prompt-group surfaces, inputs inconsistent [P1 / M]

- **Position fields exposed:**
  - `ColumnEditor.tsx:314` — `data-testid="column-editor-position-input"`.
  - `PromptGroupEditor.tsx:295` — `data-testid="prompt-group-editor-position-input"`.
  - Both should be removed from the form. Drag-reorder via dnd-kit is
    already wired in the widget that owns the list.
- **Space fields exposed where they shouldn't be:**
  - `BoardCreateDialog.tsx:358-371` — Space picker on a board create.
    Once F-05 lands, the create flow inherits `spaceId` from the entry
    point; field disappears.
- **Inputs inconsistent across surfaces:**
  - Most dialogs use `<Input>` (canonical). But raw `<textarea>`
    appears in `prompt-create-dialog/PromptCreateDialog.tsx:237`,
    `mcp-tool-create-dialog/McpToolCreateDialog.tsx:190`,
    `prompts-settings/PromptsSettings.tsx:129`,
    `task-create-dialog/TaskCreateDialog.tsx:227`,
    `board-create-dialog/BoardCreateDialog.tsx:301`,
    `board-settings/BoardSettings.tsx:401`,
    `mcp-tool-editor/McpToolEditor.tsx:319`,
    `role-create-dialog/RoleCreateDialog.tsx:155`. They each define
    their own border/padding/focus styles in CSS Modules. No shared
    `<TextArea>` primitive in `shared/ui/`.
  - `MarkdownField` is used by `RoleEditor` and `TaskDialog` — the right
    pattern. Should be the default for any "long form text".
- **Target:** add `<TextArea>` primitive to `shared/ui/` matching
  `<Input>`'s API; deprecate raw `<textarea>` in widgets; keep
  `MarkdownField` for markdown-aware fields only.
- **Fix size:** M.

### F-08 — `AttachPromptDialog` flow is wrong UX [P1 / L]

- **Callsites of `AttachPromptDialog`:**
  - `widgets/role-editor/RoleAttachmentsSections.tsx:176`
    (locked target: role).
  - `widgets/task-dialog/TaskDialog.tsx:109` (locked target: task).
  - `widgets/board-settings/BoardSettings.tsx:505` (locked target: board).
- **Target shape:** every callsite renders a `<MultiSelect>` chip-input
  fed by `usePrompts()` plus the appropriate add/remove mutation. The
  chip-input handles "search → tap → chip appears → save" in one
  surface — no modal hop. Promptery shipped exactly this UX.
- **`MultiTagInput` in `shared/ui/`** can be lifted into a generic
  `MultiSelect` (or aliased) and wired to the four mutation hooks.
  The dialog file can be deleted after migration.
- **Fix size:** L (3 callsites × surface migration + tests).

### F-09 — `description` field on Space dead [P2 / S]

- **Where it's set:** `SpaceCreateDialog.tsx:204-213`,
  `SpaceSettings.tsx:235-241`.
- **Where it's read:** `entities/space/ui/SpaceCard/SpaceCard.tsx:74-75`
  — but `SpaceCard` is only used by `widgets/spaces-list/SpacesList.tsx`,
  and `SpacesList` is no longer routed (`routes.spaces` redirects to
  `boards` per `App.tsx` + `viewForPath` at `routes.ts:108`). So the
  field is set but never visible.
- **Target:** either (a) drop the field from create + settings + the
  Rust column, OR (b) wire it into `SpaceRow` (tooltip on the space
  name) and into the `SpaceSettings` page header. The maintainer's
  product model says fields stay out of forms unless consumed by a
  visible surface — recommend dropping for now.
- **Fix size:** S (drop in form + settings; keep DB column nullable to
  avoid migration churn).

### F-10 — Task card vocabulary wrong [P1 / S]

- **`TaskCard.tsx`** (`src/entities/task/ui/TaskCard/TaskCard.tsx`):
  - Already calls the field "role" (no `cat` label on the card itself).
  - Already does NOT show Board / Status — they're rendered by the
    kanban context above the card. **No regression here.**
- **`TaskDialog.tsx:680`** (the editor): `<FieldSelect label="Cat">`
  — should be `label="Role"` or `label="Assignee"`. Maintainer wants
  "assignee" semantics — recommend `label="Assignee"`.
- **Other "Cat" labels in user-facing surfaces:**
  - `MainSidebar workspaceItems.tsx:32` — sidebar entry "Cats" (the
    NavView is `agent-roles`); should read "Roles" or "Agents".
  - `RolesPage.tsx:37` — `title="CATS"`.
  - `RolesPage.tsx:38` — `ariaLabel="Cats navigation"`.
  - `RolesList.tsx:51` — heading "Cats".
  - `BoardCreateDialog.tsx:248` — submit error "Pick an owner cat."
  - `BoardCreateDialog.tsx:315` — label "Owner cat".
  - `BoardCreateDialog.tsx:320` — `aria-label="Owner cat"`.
  - `BoardSettings.tsx:223` — toast `Failed to update owner cat: …`.
  - `BoardSettings.tsx:372,384` — label / aria-label "Owner cat".
  - `CatMigrationReviewModal.*` — wholesale module name + every UI
    string. The migration is one-shot user-facing — rename to
    "Board ownership review" or similar.
- **Target shape:** every user-facing string says "role" or "agent".
  Internal identifiers (`agent-roles` NavView, `roleId` in TS types,
  etc.) can keep their current names — that's a separate ticket if at
  all.
- **Fix size:** S (string changes + test fixture renames).

### F-11 — Prompts-attach broken end-to-end [P0 / S]

- **Root cause #1 — missing cache invalidation:**
  `src/entities/task/model/store.ts:209-220` — `useAddTaskPromptMutation`
  hook returns:
  ```
  return useMutation({ mutationFn: addTaskPrompt });
  ```
  No `onSuccess`, no `invalidateQueries`. The task-dialog "Attached
  prompts" section reads from `useTaskPrompts(taskId)` (key
  `tasksKeys.prompts(taskId)`); after attach, the chip row never
  refreshes. The same hook also doesn't invalidate the `["tasks", "byBoard"]`
  list, which would also need a touch if `prompts-count` ever lands on
  the kanban card (currently suppressed when the count source isn't
  loaded — `TaskCard.tsx:380-389`).
- **Root cause #2 — board / column add hooks need a parallel review:**
  `useAddRolePromptMutation` and `useAddBoardPromptMutation` DO
  invalidate (`role/model/store.ts:215-222`,
  `board/model/store.ts` similarly). But `useRemoveRolePromptMutation`
  invalidates only `rolesKeys.prompts(roleId)` — fine for the role
  editor surface, but if any prompt list ever displays "attached to N
  roles", that key won't update.
- **Target:**
  ```
  // entities/task/model/store.ts
  return useMutation({
    mutationFn: addTaskPrompt,
    onSuccess: (_void, vars) => {
      void queryClient.invalidateQueries({
        queryKey: tasksKeys.prompts(vars.taskId),
      });
    },
  });
  ```
  And restore the symmetric `useRemoveTaskPromptMutation` invalidation
  if/when it ships.
- **Note:** F-08 (kill the dialog) supersedes this fix UX-wise, but
  this is a **P0 functional bug** as long as `AttachPromptDialog`
  still ships. Two-line fix.
- **Fix size:** S.

### F-12 — Editor footers not sticky [P1 / M]

- **Modals (footers OK):** `<Dialog>` body uses
  `display: flex; flex-direction: column` with the body as
  `flex: 1 1 auto; min-height: 0; overflow-y: auto;`
  (`shared/ui/Dialog/Dialog.module.css:137-152`) and `<DialogFooter>`
  as a flex sibling — the footer pins automatically. Confirmed in
  `RoleEditor.tsx`, `TaskDialog.tsx` (modal mode).
- **Routed pages (footers BLEED):**
  - `SpaceSettings.tsx` + `SpaceSettings.module.css:153-158` —
    `.actions` lives inside the scrollable card body.
  - `BoardSettings.tsx` + `BoardSettings.module.css:153-158` — same.
  - `TaskView.tsx` — wraps `<TaskDialogContent>` in `<Scrollable>`
    (`task-view/TaskView.module.css`). The `<DialogFooter>` element is
    rendered, but its sticky behaviour relied on `<Dialog>`'s flex
    sibling layout, NOT on a sticky CSS — inside `<Scrollable>` it
    scrolls with content.
  - `PromptsSettings.tsx` — same pattern.
- **Target shape:** new `shared/ui/EditorShell/` primitive. API:
  ```
  <EditorShell
    header={<EditorHeader …/>}
    footer={<EditorFooter><Button>Save</Button>…</EditorFooter>}
    data-testid="space-settings-shell"
  >
    {body}
  </EditorShell>
  ```
  Internals: CSS-grid `auto / 1fr / auto`, body wraps a `<Scrollable>`,
  footer is the third grid row. Reuses `--space-*` tokens. Replaces
  the per-page `Scrollable + .actions-inside-card` pattern.
- **Migration list:** `SpaceSettings`, `BoardSettings`, `TaskView`,
  `PromptsSettings`, every editor that becomes a page under F-14
  (Role/Skill/McpTool/Tag/Prompt/PromptGroup/Column).
- **Fix size:** M.

### F-13 — File attachments don't work [P0 / S–M]

- **Walk:** `widgets/task-dialog/TaskDialog.tsx:232-255`. The handler:
  ```
  const result = await open({
    multiple: false,
    filters: [{ name: "Any file", extensions: ["*"] }],
  });
  ```
- **Bug 1:** `extensions: ["*"]` is NOT a wildcard for the Tauri v2
  dialog plugin. On macOS the picker filters by literal extension
  `*` and ends up showing nothing selectable. Drop the `filters` key
  for "any file" or list real extensions.
- **Bug 2:** No drag-drop target. The `<TaskDialog>` doesn't subscribe
  to Tauri's webview drop events (`tauri://drag-drop` in v2). For
  drag-drop into the browser-view, the recipe is:
  - Listen via `listen("tauri://drag-drop", …)` in a hook stored in
    `entities/attachment` (e.g. `useAttachmentDropZone(taskId)`).
  - Track an HTMLElement bounding-box; when the event lands inside it,
    fire `uploadAttachment` for each path.
  - Save `unlisten` and call it on unmount per the `EventsProvider`
    convention (`app/providers/EventsProvider.tsx`).
- **Bug 3:** No paste handler for clipboard images / md files. The
  description field is a `MarkdownField` — extending it with
  `onPaste` would let users paste images directly into description
  while authoring.
- **Target:** new `entities/attachment` hook
  `useAttachmentDropZone({ taskId, ref })` returning `{ isDragging }`.
  TaskDialog/TaskView wraps the body with this. The picker filter is
  fixed in the same change.
- **Fix size:** M (drop-zone hook + tests + dialog filter fix).

### F-14 — Modals only for creation; pages for view/edit [P1 / L]

- **Audit by widget:**

| Widget | Type | Should be |
| --- | --- | --- |
| `RoleEditor.tsx:35-56` | `<Dialog>` modal | Page `/roles/:roleId` |
| `SkillEditor.tsx:30+` | `<Dialog>` modal | Page `/skills/:skillId` |
| `McpToolEditor.tsx:33+` | `<Dialog>` modal | Page `/mcp-tools/:toolId` |
| `TagEditor` | `<Dialog>` modal | Page `/tags/:tagId` |
| `PromptEditor` | `<Dialog>` modal | Page `/prompts/:promptId` |
| `PromptGroupEditor` | `<Dialog>` modal | Page `/prompts/groups/:groupId` |
| `ColumnEditor` | `<Dialog>` modal | Inline (or per-board page) |
| `ClientInstructionsEditor` | `<Dialog>` modal | Page in Settings |
| `BoardSettings` | Page (OK) | — |
| `SpaceSettings` | Page (OK) | — |
| `TaskView` | Page (OK; reuses `TaskDialogContent`) | — |
| `RoleCreateDialog`, `SkillCreateDialog`, etc. (every `*CreateDialog`) | Modal (creator) | OK — keep |
| `BoardCreateDialog` | Modal (creator) | Remove from user paths per F-05 |
- **Routing pattern proposal:** add to `routes.ts`:
  ```
  role:        "/roles/:roleId",
  skill:       "/skills/:skillId",
  mcpTool:     "/mcp-tools/:toolId",
  tag:         "/tags/:tagId",
  prompt:      "/prompts/:promptId",
  promptGroup: "/prompts/groups/:groupId",
  column:      "/boards/:boardId/columns/:columnId",
  ```
  Convert every "open in modal" handler (`onSelect={setSelectedId}`)
  to `setLocation(rolePath(id))`. The page wraps an `<EditorShell>`
  (per F-12). Existing list pages (`RolesPage`, `SkillsPage`,
  `McpToolsPage`) gain a master-detail layout where the right pane is
  the editor page (or remain side-by-side via the existing
  `EntityListSidebar` shell).
- **Fix size:** L. ~7 widget rewrites + routes + tests.

---

## 4. Findings — audit areas

### A-01 — `src/shared/ui/` inventory

Present primitives (per `src/shared/ui/index.ts:1-106`):
`Button`, `Dialog`, `ConfirmDialog`, `Input`, `Tabs`, `Listbox`, `Menu`,
`Combobox`, `MultiTagInput`, `Tooltip`, `MarkdownPreview`,
`MarkdownField`, `IconPicker`, `IconColorPicker`, `KebabIcon`,
`MarqueeText`, `EmptyState`, `Scrollable`, `SidebarShell`,
`PortalProvider`, `Select`.

**Gaps:**
- **`EditorShell`** — missing. Pattern duplicated across SpaceSettings,
  BoardSettings, TaskView, PromptsSettings.
- **`MultiSelect`** (chip-input multi-select) — missing as a *named*
  primitive. `MultiTagInput` is the de-facto implementation but its
  name implies tag-only semantics. Either alias or rename.
- **`TextArea`** — missing. Eight widgets reinvent borders/padding
  (see F-07).
- **`Color` field** — missing as a primitive. `IconColorPicker` covers
  icon + color combo but not standalone color. 11 widgets reinvent
  `<input type="color">` styling (see F-06).
- **`PageHeader` / `BackRow`** — currently bespoke in TaskView /
  SpaceSettings / BoardSettings. Could ride along with `EditorShell`.
- **`SectionHeading`** — repeated CSS pattern (`.sectionLabel`,
  `.cardHeading`).

### A-02 — `src/widgets/` audit (modal vs page, FSD, shared/ui reuse)

53 widget folders. Key violations:

- **Editors as modals** (should be pages, see F-14): `RoleEditor`,
  `SkillEditor`, `McpToolEditor`, `TagEditor`, `PromptEditor`,
  `PromptGroupEditor`, `ColumnEditor`, `ClientInstructionsEditor` —
  8 widgets.
- **Direct `invoke()` in the widget** (FSD violation): `BoardCreateDialog`,
  `BoardSettings`, `CatMigrationReviewModal`, `GlobalSearch`,
  `SettingsView` — 5 widgets.
- **Bespoke select styling** (see F-06): `BoardCreateDialog`,
  `BoardSettings` — 2 widgets, 3 fields.
- **Bespoke color input** (see F-06): 11 widgets.
- **Bespoke textarea** (see F-07): 8 widgets.
- **`position` field exposed**: `ColumnEditor`, `PromptGroupEditor`.
- **"Cat" naming in user-facing strings** (see F-10): `MainSidebar`,
  `RolesPage`, `RolesList`, `BoardCreateDialog`, `BoardSettings`,
  `CatMigrationReviewModal`, `TaskDialog`.

### A-03 — `src/entities/` audit (IPC centralisation)

13 entity slices: `agent-report`, `attachment`, `board`, `column`,
`connected-client`, `mcp-tool`, `prompt`, `prompt-group`, `role`,
`skill`, `space`, `tag`, `task`. **Each has its own
`api/<slice>Api.ts` + `model/store.ts`** — the convention is
honoured. The 5 widgets calling `invoke()` directly (A-02) bypass
this layer.

**Issue:** every API file repeats `isAppErrorShape` +
`invokeWithAppError` (12 copies). Should live once in
`shared/api/` (`shared/api/invokeWithAppError.ts`).

### A-04 — Routing layer

- Uses `wouter` (`App.tsx:3`, `app/routes.ts`).
- Pages reachable: `/`, `/boards/:id`, `/boards/:id/settings`,
  `/tasks/:id`, `/prompts`, `/roles`, `/tags` (orphaned),
  `/reports` (orphaned), `/skills`, `/mcp-tools`, `/spaces` (redirect),
  `/spaces/:id/settings`, `/settings`.
- **Per-entity edit pages missing** (see F-14): no `/roles/:id`,
  `/skills/:id`, etc. All currently open as modals.
- `viewForPath` (`routes.ts:95-120`) does not handle `/tags` or
  `/reports` — they fall through to `"boards"`. Those nav items were
  removed from sidebar in Round 16.

### A-05 — CSS / styling

- **Hardcoded colors outside `var(--token, fallback)`** —
  `BulkActionsBar.module.css:90,106` (`color: #fff;` no token),
  `MarqueeText.module.css:31-38` (`#000` for gradient stops in a
  mask — arguably structural; could become a token if needed).
- **Hardcoded color fallbacks** in `ConnectedClientCard`,
  `AgentReportCard`, `ConnectedAgentsSection`, `BulkActionsBar`,
  `TopBar` — all inside `var(--token, #fallback)` form which is OK
  per convention.
- **`<Select>` callsites:** 1 canonical (`TaskDialog`), 3 native
  bespoke (`BoardCreateDialog` ×2, `BoardSettings` ×1), 1 Listbox-as-select
  (`BoardSettings` Space). Target: 1 canonical, 0 bespoke.
- **`<Input>` callsites:** mostly canonical. No counterexamples found
  for single-line text fields.
- **`<Button>` callsites:** all canonical RAC-wrapped — good. The
  only deviation: `BoardsList.tsx:150-160` uses a raw `<button>` for
  "edit board". Should be `<Button variant="ghost" size="sm">`.

### A-06 — Form patterns (sticky-footer audit)

| Form | Sticky footer? | Notes |
| --- | --- | --- |
| `RoleEditor` (modal) | Yes (DialogFooter sibling) | OK |
| `SkillEditor` (modal) | Yes | OK |
| `McpToolEditor` (modal) | Yes | OK |
| `PromptEditor` (modal) | Yes | OK |
| `TaskDialog` (modal) | Yes | OK |
| `TaskView` (page) | **NO** | Wraps `TaskDialogContent` in `<Scrollable>`; footer scrolls. |
| `BoardSettings` (page) | **NO** | `.actions` is inside the card, scrolls with content. |
| `SpaceSettings` (page) | **NO** | Same. |
| `PromptsSettings` (page) | **NO** | Same pattern. |
| `RoleCreateDialog` (modal) | Yes | OK |
| `BoardCreateDialog` (modal) | Yes | OK |
| `TaskCreateDialog` (modal) | Yes | OK |
| `SpaceCreateDialog` (modal) | Yes | OK |
| `SkillCreateDialog`, `McpToolCreateDialog`, `TagCreateDialog`, `PromptCreateDialog`, `ColumnCreateDialog`, `PromptGroupCreateDialog` | Yes | OK |

### A-07 — "cat" / "role" naming drift

User-facing "cat" strings (full grep, .tsx production files only —
test fixtures excluded but should be renamed in lockstep):

- `widgets/main-sidebar/workspaceItems.tsx:32` — `label: "Cats"`.
- `widgets/roles-page/RolesPage.tsx:37` — `title="CATS"`,
  `:38` `ariaLabel="Cats navigation"`.
- `widgets/roles-list/RolesList.tsx:51` — heading "Cats".
- `widgets/board-create-dialog/BoardCreateDialog.tsx:248` —
  "Pick an owner cat.", `:312` "Owner cat picker", `:315` label
  "Owner cat", `:320` `aria-label="Owner cat"`.
- `widgets/board-settings/BoardSettings.tsx:223` — toast text
  "Failed to update owner cat", `:372` label "Owner cat",
  `:384` `aria-label`.
- `widgets/cat-migration-review-modal/CatMigrationReviewModal.tsx:263`
  — toast "Failed to update owner cat".
- `widgets/task-dialog/TaskDialog.tsx:680` — `label="Cat"`.

Internal identifiers that **should remain** (they are not user-visible):
the `cat-migration-review-modal` folder name + `CAT_MIGRATION_REVIEWED_KEY`
constant — this is a one-shot post-migration artifact that can stay
internally named while the user-facing strings flip.

---

## 5. Unification proposals — concrete primitives

### 5.1 `<EditorShell>` (new in `src/shared/ui/EditorShell/`)

```ts
interface EditorShellProps {
  header?: ReactNode;     // breadcrumbs, title, back-row
  footer?: ReactNode;     // Cancel / Save sticky bar
  children: ReactNode;    // body (auto-wrapped in Scrollable)
  "data-testid"?: string;
}
```

Layout: CSS-grid `grid-template-rows: auto 1fr auto`. Body cell
includes `min-height: 0; overflow: hidden;` and renders a
`<Scrollable axis="y">`. Footer cell stays at the bottom of the
viewport regardless of content height.

**Migration list (call sites swap to `<EditorShell>`):**
- `widgets/space-settings/SpaceSettings.tsx`
- `widgets/board-settings/BoardSettings.tsx`
- `widgets/task-view/TaskView.tsx` (replace the inline
  Scrollable+backRow pattern)
- `widgets/prompts-settings/PromptsSettings.tsx`
- Every editor that becomes a page under F-14.

### 5.2 `<MultiSelect>` (alias / rename of `MultiTagInput`)

Either rename `MultiTagInput → MultiSelect` (keep a re-export shim
during migration) or expose `MultiSelect` as a thin re-typed wrapper
that emphasises "select N from a list" over "tag input".

API stays:
```ts
interface MultiSelectProps {
  label: string;
  items: ReadonlyArray<{ id: string; label: string; color?: string | null }>;
  selectedIds: ReadonlyArray<string>;
  onChange: (ids: ReadonlyArray<string>) => void;
  onCreate?: (query: string) => void;   // null → no inline create
  placeholder?: string;
}
```

**Replaces:**
- `widgets/role-editor/RoleAttachmentsSections.tsx` — Prompts /
  Skills / MCP-tools sections become a `<MultiSelect>` per kind.
- `widgets/task-dialog/TaskDialog.tsx` — the prompts section
  becomes a `<MultiSelect>` over `usePrompts()`.
- `widgets/board-settings/BoardSettings.tsx` — board-prompt
  attach section becomes a `<MultiSelect>`.
- After: `widgets/attach-prompt-dialog/` directory deleted.

### 5.3 Canonical `<Select>` migration list

Every site below switches to `shared/ui/Select`:
- `widgets/board-create-dialog/BoardCreateDialog.tsx:316-334`
  (Owner role).
- `widgets/board-create-dialog/BoardCreateDialog.tsx:358-371`
  (Space) — and then deleted entirely under F-05.
- `widgets/board-settings/BoardSettings.tsx:373-396` (Owner role).
- `widgets/board-settings/BoardSettings.tsx:419-…` (Space — currently
  Listbox; rendering the canonical Select with a single-select keeps
  consistency).

### 5.4 New `<TextArea>` primitive in `src/shared/ui/TextArea/`

API parallel to `<Input>`. Migrate:
- `prompt-create-dialog`, `mcp-tool-create-dialog`, `prompts-settings`,
  `task-create-dialog`, `board-create-dialog`, `board-settings`,
  `mcp-tool-editor`, `role-create-dialog`. (8 widgets.)

### 5.5 New `<ColorField>` primitive in `src/shared/ui/ColorField/`

Wraps `<input type="color">` + reset affordance + swatch + label,
re-using tokens. Migrate the 11 hand-rolled instances listed in F-06.

### 5.6 Routing layer expansion

Add to `app/routes.ts`:

```ts
role:        "/roles/:roleId",
skill:       "/skills/:skillId",
mcpTool:     "/mcp-tools/:toolId",
tag:         "/tags/:tagId",
prompt:      "/prompts/:promptId",
promptGroup: "/prompts/groups/:groupId",
column:      "/boards/:boardId/columns/:columnId",

export function rolePath(id: string): string { return `/roles/${id}`; }
// … per route
```

Mount each in `App.tsx` `<Switch>`. Replace every
`onSelect={setSelectedId}` callsite with
`onSelect={(id) => setLocation(rolePath(id))}`. Modal mounts under
`*Page` widgets are deleted; the create dialogs stay.

### 5.7 Centralise `invokeWithAppError`

Move from each `entities/<slice>/api/` to `shared/api/invokeWithAppError.ts`.
Each entity api re-imports. Delete the 12 duplicates.

---

## 6. Process recommendation

`feedback_no_throwaway_agent_dispatches.md` already exists in the user's
auto-memory. Restated here for discoverability:

**Before every frontend dispatch the main agent MUST:**

1. **Read the product invariants** in
   `~/.claude/projects/.../memory/project_catique_product_model.md`
   — copy the relevant ones into the dispatch prompt.
2. **Embed the `frontend-engineer` role contract** as the
   `<role_definition>` block — fixed text, kept verbatim from this
   audit's §3 of the original prompt. Sub-agents without that block
   ship code that violates FSD, modal/page split, naming.
3. **Quote the offending file:line ranges** so the sub-agent does not
   re-explore the codebase from scratch.
4. **Specify scope:** "ONE complaint per dispatch", and reference the
   F-NN id from this audit. The maintainer's frustration with "wrong
   product abstractions" came from agents that touched too much.
5. **Run dispatches serially**, not in parallel — F-05 / F-08 / F-14
   touch overlapping files (`RoleAttachmentsSections.tsx`,
   `TaskDialog.tsx`, `BoardSettings.tsx`). Parallel would conflict.
6. **Require the sub-agent to update tests** in the same PR — most of
   the legacy tests assert the wrong shape (e.g. `BoardCreateDialog`
   tests assert the standalone-create flow) and will silently lock in
   the violations they test.

---

## 7. Prioritised fix-plan (ordered by ROI)

Each entry is a Promptery task title, ≤80 chars, ordered top-down.

1. `[S] fix create_skill IPC: pass position to unblock SkillCreate`
2. `[S] fix create_mcp_tool IPC: pass position to unblock McpCreate`
3. `[S] task-prompt mutation: invalidate tasksKeys.prompts on success`
4. `[S] rename "Cat" → "Role" / "Agent" in every user-facing string`
5. `[S] fix TaskDialog file picker: drop extensions:["*"] filter`
6. `[L] head invariant: kill standalone Board create, route via Role`
7. `[M] add EditorShell primitive; convert 4 routed pages`
8. `[L] migrate AttachPromptDialog → MultiSelect on 3 callsites`
9. `[L] convert 7 entity editors from <Dialog> modal to routed pages`
10. `[M] task drag-drop attachments: useAttachmentDropZone hook`
11. `[M] ban native <select>; migrate Board* surfaces to <Select>`
12. `[S] drop position field from ColumnEditor + PromptGroupEditor`
13. `[S] drop description field from Space create + settings`
14. `[M] add <TextArea> primitive; migrate 8 widgets off raw textarea`
15. `[M] add <ColorField> primitive; migrate 11 widgets off raw color`
16. `[M] move 5 raw invoke() callsites into entities/* hooks`
17. `[S] move invokeWithAppError to shared/api; dedupe 12 copies`
18. `[S] paste-image handler in MarkdownField for task description`
19. `[M] add ESLint boundaries plugin; CI gate FSD violations`
20. `[S] sidebar: show Reports + Tags or remove orphan routes`
21. `[M] bulk-task: add set-status / set-role / set-board actions`
22. `[S] BoardsList: replace raw <button> with <Button variant=ghost>`
23. `[S] data-testid linter: enforce <scope>-<component>-<purpose>`
24. `[S] CatMigrationReviewModal: rename to BoardOwnershipReviewModal`
25. `[M] master-detail RolesPage / SkillsPage on routed editor pages`

---

## 8. What works well

Honest list — these are intact and should not be touched:

- **The Rust workspace + IPC boundary** — schemas, the `AppError`
  discriminated union, `bindings/*` ts-rs export pipeline.
- **The migration runner** (Round 1-19+ migrations land cleanly).
- **The DnD-kit kanban migration** — drag-reorder works.
- **`shared/ui/Dialog`** — flex-sibling sticky-footer pattern is right;
  the `EditorShell` (F-12) should mirror it.
- **`shared/ui/MarkdownField`** — view ⇄ edit toggle is the right UX
  for description/content fields.
- **`MultiTagInput`** — already implements the pattern that should
  replace `AttachPromptDialog`; just needs aliasing + adoption.
- **Resolver / spaces seed flow** — auto-create default space + default
  board on first run is correct.
- **TanStack Query wiring** — `EventsProvider` invalidates on Tauri
  events without polling; the broken cases (F-11) are local outliers,
  not a structural issue.
- **wouter routing** — minimal, predictable; the missing entity-page
  routes (F-14) just slot in cleanly.
- **The `entities/<slice>/api/` + `model/store.ts` convention** — the 8
  slices that follow it are clean; the 5 widgets bypassing it (F-03)
  are easy to hoist.

---

*End of audit.*
