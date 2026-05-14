# Frontend Parity & UX Audit (round 19)

**Date:** 2026-05-05
**Auditor:** frontend-engineer
**Scope commit:** `f6c40fb`
**Sister doc:** `docs/audit/kanban-frontend-audit.md` (kanban surface, do not duplicate)

Five user-flagged areas:

1. Prompt creation/attachment in role (Cat) editor.
2. Markdown editor quality vs Promptery's Milkdown.
3. Cat-board pinning UX (ctq-73 D2 + Phase 1 schema).
4. Workflow graph editor (Phase 5 placeholder).
5. Promptery feature parity (widget walk-through).

---

## Executive summary

**Findings: 16. P0 = 4, P1 = 6, P2 = 4, P3 = 2.**

Counts by area:

| Area | P0 | P1 | P2 | P3 |
|---|---:|---:|---:|---:|
| 1. Role/prompt flow | 2 | 2 | 0 | 0 |
| 2. Markdown editor | 1 | 2 | 1 | 0 |
| 3. Cat-board pinning | 1 | 1 | 1 | 1 |
| 4. Workflow graph | 0 | 0 | 1 | 0 |
| 5. Promptery parity | 0 | 1 | 1 | 1 |

**Top-3 highest-impact actions:**

1. **Wire `<AttachPromptDialog>` into the production tree and embed an attached-prompts section inside `<RoleEditor>`** (F-01, F-02, F-04). Today `AttachPromptDialog` is implemented + tested but **never instantiated** from any widget — `grep AttachPromptDialog src/widgets/` returns only the dialog's own files. A user editing a Cat has no way to add prompts to it. This is the single biggest functional regression vs Promptery.
2. **Replace the home-grown `MarkdownPreview` (~100 LOC, no GFM, no tables, no task-lists, no code-block highlighting, no images) with `react-markdown` + `remark-gfm`** (F-05). Same swap is already noted as "TODO if needed" in `MarkdownPreview.tsx:29-30`. Touches every prompt / role / task / agent-report description across the app — the highest leverage line of code in the audit.
3. **Make `<BoardCreateDialog>` require an owner Cat at creation, and add an Owner-cat field to `<BoardSettings>`** (F-08, F-09). The Phase 1 migration (`004_cat_as_agent_phase1.sql`) shipped `boards.owner_role_id NOT NULL`, but the FE still treats it as invisible — the dialog never asks for it, the settings page never shows it. Schema-UI drift; a board the user creates today gets an owner picked by the backend (probably `maintainer-system`) without any indication.

**Overall verdict.** The CRUD scaffolding is uniform and well-tested. The gaps cluster around (a) **discoverable composition** (creating + attaching prompts to roles/tasks/boards/columns) and (b) **schema follow-through** for Cat-as-Agent Phase 1 (owner-cat surfacing). Markdown is a known-and-flagged "ship-the-thin-renderer" decision now overdue for an upgrade. Workflow graph is intentionally absent (Phase 5). Promptery parity is otherwise close — kanban, prompt library, prompt groups, attachments, agent reports, MCP-tools, skills, global search, space settings, columns reorder all present.

---

## Findings

### Area 1 — Prompt creation / attachment in roles (Cats)

#### F-01 — [P0] `<AttachPromptDialog>` is implemented but never mounted in the app

**File:** `src/widgets/attach-prompt-dialog/AttachPromptDialog.tsx:1-423` — the only consumers are its own `.test.tsx` and `.stories.tsx`.
**Symptom:** `grep -r 'AttachPromptDialog' src/widgets/ src/pages/` returns no production import. There is no button, kebab item, or menu entry that opens it.
**Why it matters:** the dialog is the single concrete IPC bridge for `add_board_prompt` / `add_column_prompt` / `add_task_prompt` / `add_role_prompt`, but a user has no path to reach it. The user can only attach prompts via Promptery's MCP — never inside the Catique app.
**Fix size:** **M.** Add an "Attach prompt" entry to (a) `<RoleEditor>` footer, (b) `<TaskDialog>` "Attached prompts" section header, (c) `<KanbanColumn>` overflow menu, (d) `<BoardSettings>` "Prompts" section. Per-target controlled state.
**Promptery task:** `[M] Wire AttachPromptDialog from role/task/column/board surfaces`.

#### F-02 — [P0] `<RoleEditor>` has no attached-prompts list at all

**File:** `src/widgets/role-editor/RoleEditor.tsx:254-355` — sections render Name, Color, Content, Footer. Nothing for prompts.
**Quote:** content section ends at L309; the next block is `DialogFooter` at L312. No `useRolePrompts` hook is referenced; `entities/role/api/rolesApi.ts:117` exposes `addRolePrompt` but no `listRolePrompts` / `useRolePrompts` exists.
**Why it matters:** Promptery's role editor (per maintainer note) showed inline prompt list with reorder + inline create. In Catique HUB, opening a Cat shows zero prompts even when prompts ARE attached at the DB level. Editing a Cat is effectively half-blind.
**Fix size:** **M.** Add `useRolePrompts(roleId)` query hook (mirror `useTaskPrompts`), render a `<PromptsSection>` chip-list inside `<RoleEditor>` with three actions: Create+attach (opens `<PromptCreateDialog>` → calls `addRolePrompt` on `onCreated`), Attach existing (opens `<AttachPromptDialog>` pre-filled `kind=role`, `targetId=roleId`), Detach.
**Promptery task:** `[M] Add prompts list + create/attach actions to RoleEditor`.

#### F-03 — [P1] No drag-reorder for prompts within a role/task/board

**File:** `src/widgets/prompts-sidebar/PromptRow.tsx:42` uses `useSortable` — only library prompts (entities → groups) reorder. Per-role / per-task / per-column attached lists do not.
**Symptom:** `entities/role/api/rolesApi.ts:107-111` accepts a `position: number` on `add_role_prompt`, implying ordering matters, but the FE has no surface to set or change it. Same on `add_task_prompt`, `add_column_prompt`, `add_board_prompt` — all four IPCs accept `position`; the FE always passes `0` (`AttachPromptDialog.tsx:195`).
**Why it matters:** prompt order determines render order in the assembled XML envelope (Promptery convention). Without reorder UI, the user gets a fixed first-attached-wins ordering. Promptery had drag-reorder in the role editor.
**Fix size:** **M.** Reuse `@dnd-kit/react/sortable` (already wired in `PromptRow.tsx`). Add a `reorder_role_prompts` IPC (Rust + ts-rs) and a sortable list to `<RoleEditor>`. Same pattern can later cover task/column/board.
**Promptery task:** `[M] Drag-reorder for role-attached prompts`.

#### F-04 — [P1] `<AttachPromptDialog>` requires re-picking the target every time

**File:** `src/widgets/attach-prompt-dialog/AttachPromptDialog.tsx:54-59` — `TARGET_KINDS` always renders all 4 radios; cascading board → column / task pickers visible regardless of caller context.
**Why it matters:** when launched from inside a `<RoleEditor>`, it should default to `kind=role`, `targetId=current role`, lock both — the user only picks the prompt. Today the dialog asks "what kind?" + "which role?" again.
**Fix size:** **S.** Add `defaultKind` + `lockedTargetId` props. When both supplied, hide the kind radio + target combobox.
**Promptery task:** `[S] AttachPromptDialog accepts default+locked target props`.

---

### Area 2 — Markdown editor quality

Catique HUB ships **two** markdown components for **all** rich-text surfaces:

- **Editor:** `src/shared/ui/MarkdownField/MarkdownField.tsx:287-460` — implicit view ⇄ edit toggle, plain `<textarea>` + 14-button toolbar (B/I/S, H1/H2/H3, ul/ol/quote, inline-code, code-block, link, hr).
- **Renderer:** `src/shared/ui/MarkdownPreview/MarkdownPreview.tsx:1-31` — bespoke ~100-LOC regex parser. Supports h1/h2/h3, bold, italic, inline code, fenced code, ul, ol, links, paragraph breaks. **Explicitly NOT supported:** nested lists, blockquotes, tables, HTML passthrough, setext headings, escape chars, reference links, strikethrough, task lists, footnotes, **images**.

Used by:

- `RoleEditor.tsx:302-308` — role content.
- `PromptEditor.tsx:343-349` — prompt content.
- `PromptEditorPanel.tsx:349-355, 382-389` — prompt content + per-example body.
- `TaskDialog.tsx:612-618` — task description.
- (Agent-report markdown rendering — `AgentReportCard` uses `MarkdownPreview` directly.)

**Promptery used Milkdown** (rich WYSIWYG built on prosemirror).

#### F-05 — [P0] Bespoke ~100-LOC markdown renderer ships in production for every editor surface

**File:** `src/shared/ui/MarkdownPreview/MarkdownPreview.tsx:1-31` (header docstring is the spec).
**Quote (L29-30):** *"If a full CommonMark implementation is needed later, swap to `react-markdown` + `remark-gfm` (separate decision)."* The decision has not been made; the renderer is ~100 LOC of regex.
**Gaps vs Milkdown / Promptery:**

| Feature | Milkdown | Catique HUB |
|---|---|---|
| Live WYSIWYG (mode-less editing) | yes | no — explicit view/edit flip via `<MarkdownField>` (mode at L298) |
| Slash command menu | yes | no |
| Tables | yes | **not parsed, not rendered** |
| Task lists `- [x]` | yes | **not rendered** (regex doesn't match) |
| Strikethrough `~~x~~` | yes | toolbar inserts `~~`, **renderer drops it** to literal text |
| Image paste / embed | yes | not parsed; literal `![alt](url)` passes through unchanged |
| Code-block syntax highlight | yes | no |
| Nested lists | yes | **not parsed** (out-of-scope per docstring) |
| Blockquotes | yes | toolbar inserts `> `, renderer **does not** parse `>` |
| Keyboard: Cmd+K link | yes | yes (`MarkdownField.tsx:359`) |
| Keyboard: Cmd+B / Cmd+I | yes | yes (`MarkdownField.tsx:357-358`) |
| Drag-and-drop image upload | yes | no |
| HTML passthrough | yes | intentionally no (`MarkdownPreview.tsx:18`) |
| `prefers-reduced-motion` aware | n/a | yes — preview CSS respects it |

**Why it matters:** every prompt-content / role-content / task-description / agent-report-body field on the app ships through this renderer. A user pastes a Markdown table from Notion → the table renders as literal pipes. A user writes a blockquote → it renders as `> text`. This affects the product's primary content surface.
**Fix size:** **M.** Add `react-markdown` + `remark-gfm` (+ optionally `rehype-highlight` for code). Drop in behind the same `MarkdownPreviewProps` so call-sites do not change.
**Promptery task:** `[M] Replace bespoke MarkdownPreview with react-markdown + GFM`.

#### F-06 — [P1] Toolbar buttons exist for syntax the renderer cannot parse

**File:** `src/shared/ui/MarkdownField/MarkdownField.tsx:184-241`
**Symptom:** toolbar inserts `~~strike~~` (L186-189), `> quote` (L237-240), but `MarkdownPreview` does not render either — the user types via the toolbar, switches to view mode, sees literal punctuation.
**Why it matters:** trust-killer; the editor advertises features that don't exist.
**Fix size:** **S** if F-05 lands first (renderer absorbs the syntax). **S** standalone (remove the unsupported toolbar buttons).
**Promptery task:** `[S] Remove unsupported toolbar buttons from MarkdownField`.

#### F-07 — [P1] Edit ⇄ view mode flip on focus is hostile for keyboard users

**File:** `src/shared/ui/MarkdownField/MarkdownField.tsx:443-459`
**Quote (L447-449):** `onClick={enterEdit}`, `onFocus={enterEdit}`, `onKeyDown={handleViewKeyDown}`.
**Symptom:** the view surface is a `<button>` that flips to edit on focus. Tabbing through a form silently flips every Markdown field into edit mode. There is no way to "scan" a populated form by Tab without entering each editor.
**Why it matters:** in `<TaskDialog>`, `<PromptEditor>`, `<RoleEditor>`, the user pressing Tab to reach Save passes through one or more `MarkdownField`s, each of which auto-enters edit mode and has its own Tab → focus-trap interaction with the toolbar.
**Fix size:** **S.** Make `onFocus` a no-op; reserve mode flip for click + Enter/Space + an explicit "Edit" button. Tab from Name to Save should not change content modes.
**Promptery task:** `[S] MarkdownField: do not enter edit mode on focus alone`.

#### F-08 — [P2] No image paste, no drag-drop image upload, no attachments-in-content

**File:** `src/shared/ui/MarkdownField/MarkdownField.tsx:425-436` — plain `<textarea>`, no `onPaste`.
**Why it matters:** users pasting screenshots from clipboard (Cmd+V on a PNG) get nothing. Promptery (Milkdown) supported this. The app already has a Tauri attachments API (`useUploadAttachmentMutation` at `entities/attachment/`); it could be wired into the textarea's `onPaste` to upload-and-insert.
**Fix size:** **L.** New `MarkdownField` paste handler → `useUploadAttachmentMutation` → insert `![filename](attachment://id)`. Renderer needs an `attachment://` URL scheme handler.
**Promptery task:** `[L] Image paste + attachment upload inside MarkdownField`.

---

### Area 3 — Cat-board pinning UX

Phase 1 schema landed (`crates/infrastructure/src/db/migrations/004_cat_as_agent_phase1.sql`). The TS binding `bindings/Board.ts:24` carries `ownerRoleId: string` (NOT NULL). Frontend treatment:

#### F-09 — [P0] `<BoardCreateDialog>` does not ask for an owner Cat

**File:** `src/widgets/board-create-dialog/BoardCreateDialog.tsx:210-308` — the form renders Name, Description, Space, footer. No owner-cat picker.
**Quote (L186-193):** create payload omits `ownerRoleId` entirely:
```ts
createBoard.mutate({
  name: trimmedName,
  spaceId: resolvedSpaceId,
  ...(trimmedDescription ? { description: trimmedDescription } : {}),
  ...(color !== "" ? { color } : {}),
  ...(icon !== null ? { icon } : {}),
});
```
**Why it matters:** ctq-73 D2 says boards = cats; no standalone boards. Currently the UI lets a user create a board with no Cat in mind — the backend then assigns one (`maintainer-system` per `BoardCard.test.tsx:19`'s fixture, suggesting that's the default), invisibly. This violates the explicit product principle.
**Fix size:** **M.** Add a required Cat picker (Listbox of `useRoles()`). Disable Save until selected. Pass `ownerRoleId` to `useCreateBoardMutation`. Reflect Phase 1 schema as a hard FE requirement, not an optional field.
**Promptery task:** `[M] BoardCreateDialog: required owner-cat picker`.

#### F-10 — [P1] `<BoardSettings>` does not display or let user change owner Cat

**File:** `src/widgets/board-settings/BoardSettings.tsx:274-365` — the General card shows Name, Description, Space, Position. The danger zone is delete. There is no `ownerRoleId` field anywhere.
**Why it matters:** a board IS a Cat per D2; the only handle for "which Cat" lives in the schema. If a user wants to move a board to a different Cat (e.g. delete the cat, hand the board off), there is no UI.
**Fix size:** **M.** Add an "Owner cat" Listbox to the General card; wire to `useUpdateBoardMutation`. Mirror the existing Space picker (L300-324) pattern.
**Promptery task:** `[M] BoardSettings: editable owner-cat field`.

#### F-11 — [P2] No post-migration review modal (P1-T4 from cat-as-agent roadmap)

**File:** absent. `grep -rn 'cat_migration_reviewed' src/` returns no FE hits — the flag is only referenced in the docs and infrastructure. `src/widgets/spaces-sidebar/icons.tsx:20` mentions migration in a code comment but renders no UI.
**Why it matters:** the Phase 1 backfill silently picked an owner Cat for every existing board (per migration 004). Users who upgrade need to **review** those assignments — Promptery would have called this out via a one-time modal seeded by `cat_migration_reviewed = false`. No such modal exists.
**Fix size:** **M.** New `<CatMigrationReviewModal>` widget. On `<App>` mount, read the flag via a settings IPC (or `useLocalStorage` if backend hasn't shipped the setting yet). When false, mount a modal listing every board grouped by `ownerRoleId` with reassignment quick-actions. Set flag to `true` on dismiss.
**Promptery task:** `[M] Post-migration owner-cat review modal`.

#### F-12 — [P3] `Board.roleId` legacy field still in binding, ambiguous next to `ownerRoleId`

**File:** `bindings/Board.ts:3` — `Board` carries both `roleId: string | null` (legacy) and `ownerRoleId: string` (new). Two fields with overlapping semantics.
**Why it matters:** confusing for a new contributor; risk of writing `board.roleId` when meaning `board.ownerRoleId`. Promptery's `roleId` was the old "default role for tasks", which the Cat-as-Agent rework displaces.
**Fix size:** **S** schema-side (drop column or rename; backend task). FE-side: nothing until backend lands. Filing for traceability.
**Promptery task:** `[S] Drop legacy Board.roleId from schema + binding`.

---

### Area 4 — Workflow graph editor

#### F-13 — [P2] No placeholder UI for Phase-5 workflow graph

**File:** `src/widgets/space-settings/SpaceSettings.tsx:195-289` — the surface where a workflow graph would naturally live (per ctq-73 Phase 5: Cat × Cat orchestration). Renders only General + Danger zone.
**Search results:**
- `grep -rn 'workflow|graph|react-flow|reactflow|xyflow' src/` — 21 file hits, **none** are a Phase-5 graph stub. Hits are accidental occurrences ("workflow" in comments, "graph" in `pie-chart` icon names, etc.).
- No `react-flow` / `@xyflow/react` package in `package.json:23-41`.
- No `<WorkflowGraph>` widget directory.
**Why it matters:** Phase 5 is far off, but the maintainer asked whether ANY hint exists. None does — and since Cat-as-Agent Phase 1 schema is in, there's value in adding even a coming-soon teaser inside `<SpaceSettings>` so the long-term direction is visible.
**Fix size:** **S.** Add a disabled "Workflow" tab/card to `<SpaceSettings>` with an EmptyState ("Cat × Cat orchestration arrives in Phase 5"). No graph dep; just signposting.
**Promptery task:** `[S] SpaceSettings: workflow placeholder card with Phase-5 hint`.

---

### Area 5 — Promptery feature parity (widget walk-through)

Walked `src/widgets/`. Each row = one widget directory.

| Widget | Promptery had it? | Catique status | Notes |
|---|---|---|---|
| `agent-reports-list` | yes | implemented + tests | `AgentReportsList.tsx:39-136` — pending/error/empty/list states. |
| `attach-prompt-dialog` | yes (inline in role) | **dormant** | F-01: never mounted. |
| `board-create-dialog` | yes | implemented but missing owner-cat (F-09) | |
| `board-editor` | yes | **superseded by `board-settings`** but still on disk | `grep -l BoardEditor src/` shows only its own files + a stale ref in `SpaceRow.tsx`/`routes.ts`/`column-editor`. Worth deleting. |
| `board-home` | yes | implemented | |
| `board-settings` | yes | implemented but missing owner-cat (F-10) | |
| `boards-list` | yes | implemented + tests | |
| `client-instructions-editor` | n/a (Catique-specific) | implemented | |
| `column-create-dialog`, `column-editor` | yes | implemented | |
| `connected-agents-section` | n/a (Catique-specific) | implemented + tests | |
| `entity-list-sidebar` | yes (similar) | implemented | |
| `global-search` | yes | implemented + Cmd-K keybind hook | |
| `inline-group-settings`, `inline-group-view` | yes (prompt groups) | implemented | |
| `kanban-board` | yes | implemented + audited (`docs/audit/kanban-frontend-audit.md`) | |
| `main-sidebar` | yes | implemented | |
| `mcp-tool-create-dialog`, `mcp-tool-editor`, `mcp-tools-list`, `mcp-tools-page` | yes | implemented + tests | |
| `prompt-create-dialog` | yes | implemented + tests | F-04, F-05 caveats. |
| `prompt-editor`, `prompt-editor-panel` | yes | implemented | |
| `prompt-group-create-dialog`, `prompt-group-editor` | yes | implemented | |
| `prompt-tags-field` | yes | implemented | |
| `prompts-list`, `prompts-page`, `prompts-settings`, `prompts-sidebar` | yes | implemented; sortable in sidebar | |
| `prompts-tag-filter` | yes | implemented | |
| `role-create-dialog`, `role-editor`, `roles-list`, `roles-page` | yes | implemented BUT `RoleEditor` lacks attached-prompts list (F-02) | |
| `settings-tokens-view`, `settings-view` | yes | implemented + tests | |
| `skill-create-dialog`, `skill-editor`, `skills-list`, `skills-page` | yes | implemented + tests | |
| `space-create-dialog`, `space-settings`, `spaces-list`, `spaces-sidebar` | yes | implemented; no migration-review modal (F-11) | |
| `tag-create-dialog`, `tag-editor`, `tags-library-editor`, `tags-list` | yes | implemented | |
| `task-create-dialog`, `task-dialog`, `task-view` | yes | implemented; `TaskDialog.tsx` is **760 LOC** (F-15 below) | |
| `toaster`, `top-bar` | yes | implemented | |

Three findings from the walk-through:

#### F-14 — [P1] `board-editor` widget is dead code

**File:** `src/widgets/board-editor/BoardEditor.tsx` (+ `.module.css`, `.test.tsx`, `.stories.tsx`, `index.ts`). Per `BoardSettings.tsx` header comment (L1-9): *"replaces the BoardEditor modal that the kanban-board's 'Board options' cog used to open"*.
**Symptom:** `grep -l BoardEditor src/` shows references in `SpaceRow.tsx`, `app/routes.ts`, `column-editor/ColumnEditor.module.css` (CSS class string only). The modal is no longer the live edit surface.
**Why it matters:** dead code drifts. Tests + stories pretend it's the truth; new contributors edit the wrong file. Same problem F-12 (`board-editor` widget) describes structurally: two surfaces with the same intent.
**Fix size:** **S.** Verify routes / SpaceRow no longer reference it (CSS class is fine). Delete the widget. Remove from `widgets/` index.
**Promptery task:** `[S] Remove dead board-editor widget`.

#### F-15 — [P2] `<TaskDialog>` is a 760-LOC god-component

**File:** `src/widgets/task-dialog/TaskDialog.tsx` — 760 LOC, exceeds the project's 150-line component / 100-line hook ceiling by 5×.
**Symptom:** four embedded sub-components (`PromptsSection`, `AttachmentsSection`, `SlugChip`, `FieldSelect`), three queries, three mutations, and the form body (Title / Slug / Description / Board / Column / Cat / Prompts / Attachments / AgentReports), plus delete-confirm flow at L693-727. Pending/error/not-found branches duplicate footer markup.
**Why it matters:** F-09 from the kanban audit applies here verbatim: "hard to test, hard to refactor". With ctq-73 Phase 2 imminent (will reshape Cat-as-Agent task surface), reducing this surface beforehand de-risks the rewrite.
**Fix size:** **M.** Split into `TaskDialogShell` (modal wrapping), `TaskDialogContent` (already exported at L354), `TaskFormBody`, `TaskFooter`, `TaskDeleteRow`, plus a `useTaskEditor(taskId)` hook for the local-state + mutations.
**Promptery task:** `[M] Split TaskDialog into shell + form + hook`.

#### F-16 — [P3] `MarkdownPreview` import path duplicated across 5+ widgets via `<MarkdownField>`

**File:** every editor (`PromptEditor.tsx`, `PromptEditorPanel.tsx`, `RoleEditor.tsx`, `TaskDialog.tsx`) goes through `<MarkdownField>`. `<MarkdownField>` IS shared/ui — that's correct. But the dual existence of `<MarkdownField>` (toolbar + textarea + preview) and `<MarkdownPreview>` (preview only) creates two import paths that future contributors confuse.
**Symptom:** `AgentReportCard` likely imports `MarkdownPreview` directly (preview-only). Stories under `*.stories.tsx` for tasks/prompts also reach for `MarkdownPreview` to render mock content.
**Why it matters:** when F-05 lands (swap to `react-markdown`), both `<MarkdownPreview>` and `<MarkdownField>`'s view-mode pane need updating in lock-step. Risk of partial migration.
**Fix size:** **S.** Make `<MarkdownField>` view-mode delegate to `<MarkdownPreview>` exclusively (already does — `MarkdownField.tsx:455-457`); document the contract in `shared/ui/README.md`.
**Promptery task:** `[S] Document MarkdownField vs MarkdownPreview contract`.

---

## What works well

- **CRUD scaffolding parity is high.** Every Promptery aggregate (Space, Board, Column, Task, Role, Prompt, PromptGroup, Tag, Skill, McpTool, AgentReport, Attachment, ConnectedClient) has an entity slice with `api/`, `model/`, `ui/` and a corresponding `*-create-dialog` + editor / list widget. The walk-through table above is mostly green.
- **Tauri IPC wrapper discipline.** `entities/role/api/rolesApi.ts:41-53` — every command goes through `invokeWithAppError`, error-shape narrowed via `isAppErrorShape`. No raw `invoke()` calls in widgets (cross-checked via grep on widget tree).
- **TanStack Query + EventsProvider pattern.** Same shape audited in the kanban round; holds across all entities. No polling.
- **react-aria-components throughout.** `Listbox`, `Combobox`, `Dialog`, `Select`, `Tabs`, `Menu` all use RAC primitives in `shared/ui/`. No DIY dropdowns / custom popovers reinventing focus management.
- **Test density.** 8 of the 11 dialogs reviewed have `.test.tsx` files; `RoleEditor.test.tsx`, `BoardCreateDialog.test.tsx`, `AttachPromptDialog.test.tsx` cover happy + error + cancel paths.
- **Settings vs create UX rule is explicit and consistent.** `BoardSettings.tsx:1-9` documents it: modals for create, routed pages with `← Back` for edit/settings. `SpaceSettings`, `BoardSettings`, `TaskView`, `PromptsSettings` all conform. `PromptEditorPanel` renders the same form inline when reached from the sidebar.
- **CSS Modules + design tokens.** Every audited `.module.css` references `var(--color-*)`, `var(--space-*)`, `var(--radius-*)`. No hex literals in the audited files.
- **`prefers-reduced-motion` respected.** `RoleEditor.module.css:232-237` disables skeleton pulses; same pattern across `BoardSettings`, `SpaceSettings`, `MarkdownPreview`.
- **Phase-1 owner-cat schema reflected in tests.** `BoardCreateDialog.test.tsx:49`, `BoardCard.test.tsx:19` already include `ownerRoleId: "maintainer-system"` fixtures — the data path is wired even though the UI pickers are missing (F-09, F-10).

---

## Recommended next Promptery tasks

(All ≤80 chars. Maintainer will create via Promptery MCP.)

1. `[M] Wire AttachPromptDialog from role/task/column/board surfaces`
2. `[M] Add prompts list + create/attach actions to RoleEditor`
3. `[M] Replace bespoke MarkdownPreview with react-markdown + GFM`
4. `[M] BoardCreateDialog: required owner-cat picker`
5. `[M] BoardSettings: editable owner-cat field`
6. `[M] Post-migration owner-cat review modal`
7. `[S] AttachPromptDialog accepts default+locked target props`
8. `[S] MarkdownField: do not enter edit mode on focus alone`
9. `[S] Remove dead board-editor widget`
10. `[M] Drag-reorder for role-attached prompts`

(F-06, F-08, F-11, F-13, F-15, F-16 deferred — folded into Phase 2 rewrite or downstream of items 1-10.)

---

## Out of scope (intentionally not audited)

- Kanban surface — already at `docs/audit/kanban-frontend-audit.md`.
- Backend / Rust workspace.
- Design critique (token palettes, motion specs).
- Performance benchmarks (no infra).
- E2E (Playwright) — not in CI per `package.json`.
- Phase 5 workflow graph implementation — only signposting (F-13).
