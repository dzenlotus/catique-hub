# Backend Parity + Inheritance Audit (Catique HUB Rust)

**Date:** 2026-05-05
**Auditor:** rust-backend-engineer (sub-agent)
**Scope commit:** `f6c40fb` (HEAD on `main`)
**Promptery task:** TBD (maintainer to create)

**Files audited:**

- `crates/application/src/{prompts,boards,roles,tasks,spaces,columns,prompt_groups}.rs`
- `crates/infrastructure/src/db/repositories/{prompts,tasks,boards,roles,columns,spaces,prompt_groups}.rs`
- `crates/infrastructure/src/db/migrations/00{1..10}_*.sql`
- `crates/api/src/handlers/{prompts,boards,roles,tasks,spaces,columns}.rs`
- `src-tauri/src/lib.rs` (IPC registry)
- `bindings/*.ts` (ts-rs output)
- `docs/catique-migration/cat-as-agent-roadmap.md` (Phase 1 plan)

---

## Executive summary

**Findings: 14 total — P0=2, P1=6, P2=4, P3=2.**

Per audited area:

| Area | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 1. Space-level prompt inheritance | 1 | 2 | 0 | 0 |
| 2. Cat ↔ space memory scope | 0 | 1 | 1 | 0 |
| 3. One-cat-per-board enforcement | 1 | 1 | 1 | 0 |
| 4. Workflow graph schema | 0 | 1 | 0 | 1 |
| 5. Promptery feature parity | 0 | 1 | 2 | 1 |

**Top-3 highest-impact actions (ordered by ROI):**

1. **Land the prompt-inheritance resolver** (F-01, P0) — `task_prompts.origin` column already exists with `'direct'` / `'role:…'` / `'board:…'` / `'column:…'` semantics from Promptery v0.4 (`001_initial.sql:181`), but no Rust code populates it, no `get_task_bundle` IPC exists, and `column_prompts` / `board_prompts` join tables are reachable only as opaque add/remove pairs (`crates/api/src/handlers/prompts.rs:148-218`). The product's headline value (per-task assembled prompt set) does not exist on the wire.
2. **Add `space_prompts` table + 4-level resolver** (F-02, P0) — D9/ctq-73 mandates `space → board → column → task`, but the schema only has 3 levels (board / column / task). This is one migration (`011_space_prompts.sql`) plus the resolver wiring from F-01, and unblocks the workflow graph (Phase 5).
3. **Guard role deletion against owned boards + system rows** (F-04, P0) — `crates/application/src/roles.rs:123-134` does an unconditional `DELETE FROM roles`. Migration 004 makes `boards.owner_role_id NOT NULL REFERENCES roles(id)` without `ON DELETE` rule, so the SQL FK rejects the delete and surfaces as `TransactionRolledBack { reason: "FOREIGN KEY constraint failed" }` — a non-actionable error string instead of a typed `Forbidden` / `InUse`. Worse: there is no `is_system` guard, so a malicious / accidental call can delete `'maintainer-system'` if no boards yet reference it.

**Overall verdict.** The schema groundwork (Phase 1 of ctq-73) landed cleanly and migrations 004–010 are well-engineered. What is missing is the **application layer** that turns the schema into product behaviour: the resolver, the bulk setters, the typed guards, and a thin space-prompts join table. None of these are architectural rework — they are well-bounded, S/M-sized PRs that map 1:1 onto the empty seats Promptery v0.4 left behind.

---

## Findings

### F-01 — [P0] Prompt inheritance resolver does not exist; `origin` column is dead

**File:** `crates/infrastructure/src/db/migrations/001_initial.sql:178-200` (schema), `crates/infrastructure/src/db/repositories/tasks.rs:391-404` (only writer of `task_prompts`), `crates/api/src/handlers/prompts.rs:148-218` (raw join-table CRUD only).
**Category:** product gap / inheritance.
**Symptom:** `task_prompts.origin` is declared `TEXT NOT NULL DEFAULT 'direct'` (`001_initial.sql:181`); the cleanup trigger `cleanup_role_origin_on_role_delete` (`001_initial.sql:245-251`) hard-deletes rows where `origin = 'role:' || OLD.id`; the comment in `tasks.rs:407-408` says "Inherited rows (origin `role:…`, `board:…`, `column:…`) are not touched — they're managed by the resolver (E3)." But **no resolver exists**: `grep -r "resolve\|origin\s*=\s*'role:" crates/` returns zero non-comment matches. `add_task_prompt` (`tasks.rs:391`) hard-codes `origin = 'direct'` and that is the only INSERT path.
**Root cause:** wave-E3 (resolver) was deferred when E2.4 shipped; the comment in `crates/application/src/prompts.rs:3-5` literally says "the 6-source resolver are deferred to E3".
**Why it matters:** the agent-bundle that goes to the LLM is supposed to be `direct ∪ role ∪ board ∪ column` (the four origins) minus per-task overrides (`task_prompt_overrides`). Today the only thing in `task_prompts` is the manually-attached set; the role/board/column join tables are never folded in. From the frontend's perspective there is no way to ask "what prompts will this task ship with" — `list_task_prompts` (`crates/api/src/handlers/tasks.rs:157`) returns only the direct attachments.
**Suggested fix (M):**
1. Add `crates/application/src/resolver.rs` with `resolve_task_bundle(task_id) -> Vec<ResolvedPrompt>` that walks `space_prompts` → `board_prompts` → `column_prompts` → `role_prompts` (cat) → `task_prompts(origin='direct')`, deduplicates by `prompt_id`, and applies `task_prompt_overrides` (suppress / force-enable).
2. Expose `get_task_bundle(task_id)` IPC. Domain type `TaskBundle { prompts: Vec<ResolvedPrompt>, source_chain: Vec<OriginRef> }` — the frontend needs `source_chain` to render the inheritance breadcrumb.
3. Add origin-write paths to `add_role_prompt` / `add_board_prompt` / `add_column_prompt` so `task_prompts` is materialised on attach (the existing `cleanup_role_origin_on_role_delete` trigger already handles the role-delete case).
4. Criterion benchmark — Promptery's spec was P99 < 50 ms on 10k tasks (`docs/catique-migration/cat-as-agent-roadmap.md:332`).
**Promptery task title:** "Land prompt-inheritance resolver + get_task_bundle IPC"

### F-02 — [P0] No `space_prompts` table — schema is 3-level, product spec is 4-level

**File:** `crates/infrastructure/src/db/migrations/001_initial.sql:212-226` (only `board_prompts` + `column_prompts`); `bindings/Space.ts` (no `prompts` field).
**Category:** schema gap.
**Symptom:** D9 / ctq-73 mandates `space → board → column → task` inheritance. The schema has `board_prompts` and `column_prompts` (and `role_prompts` for the cat), but no `space_prompts`. Migration 008 adds `spaces.color` + `spaces.icon` but skips the prompts join. There is no `set_space_prompts` IPC, no `add_space_prompt`, and no place in `bindings/Space.ts` for it.
**Root cause:** Catique inherited the Promptery v0.4 schema verbatim (`001_initial.sql:9` "byte-identical for the data tables"), and Promptery's resolver only had 3 levels.
**Why it matters:** without space-level prompts there is no place to put cross-board organisational defaults ("every cat in this space must follow these guardrails"). Today the workaround is "attach to every board" — which fails the moment the user adds a new board, and breaks one of the few invariants this product is selling.
**Suggested fix (S):** new migration `011_space_prompts.sql`:
```sql
CREATE TABLE IF NOT EXISTS space_prompts (
  space_id  TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (space_id, prompt_id)
);
CREATE INDEX idx_space_prompts_space ON space_prompts(space_id, position);
```
Plus repo helpers `add_space_prompt` / `remove_space_prompt` and IPC `add_space_prompt` / `remove_space_prompt` mirroring the board-prompts pair (`crates/api/src/handlers/prompts.rs:147-179`). Resolver from F-01 picks it up automatically.
**Promptery task title:** "Add space_prompts join + IPC for 4-level inheritance"

### F-03 — [P1] Resolver origin write-paths missing on board/column/role attach

**File:** `crates/api/src/handlers/prompts.rs:147-156` (`add_board_prompt`); `crates/api/src/handlers/prompts.rs:186-195` (`add_column_prompt`); `crates/api/src/handlers/roles.rs:94-103` (`add_role_prompt`).
**Category:** inheritance correctness.
**Symptom:** Promptery's contract (per the cleanup trigger at `001_initial.sql:245-251`) is that attaching a prompt to a role/board/column writes one materialised row into `task_prompts` per affected task with `origin = '<scope>:<id>'`. None of the three add-handlers do that. They write into `role_prompts` / `board_prompts` / `column_prompts` and stop.
**Root cause:** same E3 deferral as F-01.
**Why it matters:** even with the resolver from F-01 implemented as a pure SELECT-time JOIN, write-time materialisation matters for (a) the cleanup trigger to do its job on role delete, (b) per-task `task_prompt_overrides` semantics (you can only override a row that exists), (c) read-path performance — a hot per-task SELECT JOIN over 4 levels on every `get_task_bundle` is wasteful.
**Suggested fix (M):** decide read-time vs write-time materialisation in an ADR, then implement consistently. Recommendation: write-time materialisation (mirrors Promptery's actual behaviour and the existing cleanup trigger). Include a small backfill step in F-01's PR that walks every task and re-materialises.
**Promptery task title:** "Materialise task_prompts.origin on role/board/column attach"

### F-04 — [P0] `delete_role` ignores `is_system` and ignores owned boards

**File:** `crates/application/src/roles.rs:123-134`.
**Category:** data integrity / guard.
**Symptom:** `RolesUseCase::delete` is a one-liner — `repo::delete(&conn, id)` — with no `is_system` check and no pre-check for owned boards. Migration 004 made `boards.owner_role_id NOT NULL REFERENCES roles(id)` without `ON DELETE CASCADE` (`004_cat_as_agent_phase1.sql:98`), so the SQL FK rejects the delete and surfaces as `TransactionRolledBack { reason: "FOREIGN KEY constraint failed" }` (`crates/application/src/error.rs` mapping). The frontend gets an opaque red error toast instead of "Cat owns N boards — reassign first."
**Root cause:** the use-case landed before migration 004; the `is_system` flag was added but never wired into the guard. The cat-roadmap doc explicitly calls this out (`cat-as-agent-roadmap.md:104-115`, AC-D2/D3) — it just hasn't been implemented.
**Why it matters:** (a) `'maintainer-system'` and `'dirizher-system'` can be deleted whenever no board references them, then the `boards_new` DEFAULT (`004_cat_as_agent_phase1.sql:98`) silently drifts; (b) typing a friendly message into a generic `TransactionRolledBack` is a UX regression vs. Promptery; (c) auto-provisioned default boards (`009_default_boards.sql`) all reference `'maintainer-system'` — one stray delete and every new space provisions against a missing FK.
**Suggested fix (S):**
1. Pre-fetch the row, return `AppError::Forbidden` if `is_system`.
2. Pre-count `SELECT COUNT(*) FROM boards WHERE owner_role_id = ?1`; return new `AppError::InUse { entity, by_count }` if > 0.
3. Add 3 unit tests mirroring `cat-as-agent-roadmap.md:113-116` (AC-D2, AC-D3, AC-D4 already partially covered).
**Promptery task title:** "Guard delete_role against is_system + owned boards"

### F-05 — [P0] No IPC to reassign a board's owner cat (`set_board_owner`)

**File:** `crates/infrastructure/src/db/repositories/boards.rs:336-343` (`set_owner` exists, repo-only); `crates/application/src/boards.rs:53-61` (`UpdateBoardArgs` has no `owner_role_id`); `src-tauri/src/lib.rs:78-83` (no IPC).
**Category:** missing IPC / D2 invariant.
**Symptom:** the Phase-1 review modal (`cat-as-agent-roadmap.md:124-154`, AC-M3) specifies a per-board cat dropdown that calls `update_board_cat(board_id, cat_id)`. The repo helper `set_owner` exists at `boards.rs:336-343`, but `BoardsUseCase::update` does not take `owner_role_id` and no Tauri command wires the helper through. The frontend has no way to reassign a cat short of dropping into raw SQL.
**Root cause:** the helper was added in migration 004's companion PR; the use-case + IPC plumbing was deferred.
**Why it matters:** the entire one-shot review modal (P1-T4) is unimplementable until this lands. Until then, every space gets `'maintainer-system'` (per `010_backfill_default_boards.sql:59`) and the user cannot change it.
**Suggested fix (S):** add `owner_role_id: Option<String>` to `UpdateBoardArgs`; thread through `BoardPatch`; add IPC `set_board_owner(board_id, role_id)` (or fold into `update_board`). Validate `role_id` exists and is non-system before assignment.
**Promptery task title:** "Expose set_board_owner IPC for cat reassignment"

### F-06 — [P1] Cat memory scope `(cat_id, space_id)` has zero IPC surface

**File:** N/A — does not exist.
**Category:** missing query / D9 invariant.
**Symptom:** `cat-as-agent-roadmap.md:187-224` (P1-T6) specifies `search_tasks_by_cat_and_space(space_id, cat_id, query)` joining `tasks` ↔ `boards` (for `space_id`) ↔ `tasks_fts` ↔ filter on `t.role_id`. It is not in `crates/api/src/handlers/search.rs`, not in the IPC registry (`src-tauri/src/lib.rs:170-173`), and not in `crates/infrastructure/src/db/repositories/search.rs`. The bench gate at `cat-as-agent-roadmap.md:213` (P99 < 100 ms on 10k tasks) is therefore not enforced.
**Root cause:** Phase 1 task P1-T6 is in the plan but not yet executed.
**Why it matters:** all of Phase 2/3 (memory weighting, context assembly) blocks on this query existing. It is also the only place in the codebase where `(cat_id, space_id)` co-scoping is enforced — D9's invariant lives in this query, not in a stored column (per AC-S4 / AC-S2).
**Suggested fix (M):** implement per `cat-as-agent-roadmap.md:194-209`; add criterion bench seeded with 10k tasks; assert `EXPLAIN QUERY PLAN` confirms FTS5 path.
**Promptery task title:** "Implement search_tasks_by_cat_and_space FTS5 query"

### F-07 — [P1] Role-delete trigger covers prompts/skills/mcp_tools but not workflow refs

**File:** `crates/infrastructure/src/db/migrations/001_initial.sql:245-251`.
**Category:** trigger completeness.
**Symptom:** the `cleanup_role_origin_on_role_delete` trigger strips `task_prompts`, `task_skills`, `task_mcp_tools` rows whose `origin = 'role:' || OLD.id`. It does not strip anything from `boards.owner_role_id` (Phase 1) or from a future `space.workflow_graph` JSON (Phase 5). The boards FK already rejects the delete (see F-04), but once F-04 introduces a typed guard, callers will rely on the trigger to keep the rest of the graph clean.
**Root cause:** trigger pre-dates migration 004.
**Why it matters:** belt-and-suspenders. Once F-04 lands, the only path to delete a cat is through the typed guard; the trigger should be updated alongside so future schema additions (workflow graph, cat profile cache) don't quietly become orphan-prone.
**Suggested fix (S):** extend the trigger to also `DELETE FROM task_ratings WHERE task_id IN (SELECT id FROM tasks WHERE role_id = OLD.id)` once Phase 2 widens task_ratings PK to `(task_id, cat_id)` (`004_cat_as_agent_phase1.sql:124-126`). Defer the workflow-graph cleanup to Phase 5.
**Promptery task title:** "Extend role-delete trigger for Phase 2 cat refs"

### F-08 — [P1] One-cat-per-board enforced only by NOT NULL — no app-level guard on update

**File:** `crates/application/src/boards.rs:144-168` (`update`); `crates/infrastructure/src/db/repositories/boards.rs:336-343` (`set_owner`).
**Category:** invariant enforcement.
**Symptom:** D2 says "each cat owns 1+ boards, no shared boards." The `boards.owner_role_id NOT NULL` constraint enforces "every board has exactly one cat" (the "owner" half), but **does not** enforce "no shared boards." That second half is intentionally permissive in the current schema (a cat can own many boards, that's fine), but there is no use-case-level check that prevents reassigning a board's owner to a `is_system` row outside the seeded Maintainer/Dirizher pair, and no check that prevents reassigning to `'dirizher-system'` (which is the coordinator, not an owner).
**Root cause:** invariant was specified at the data-model level; the use-case layer was not updated.
**Why it matters:** if F-05 lands without this guard, the frontend can assign `dirizher-system` as a board owner via the dropdown (the dropdown is supposed to filter on `is_system = false`, but a defence-in-depth check at the use-case layer is the senior-bar approach).
**Suggested fix (S):** in F-05's `set_board_owner` implementation, reject `role_id == DIRIZHER_SYSTEM_ID` with `AppError::Validation`. Document allowed system owners (currently only `MAINTAINER_SYSTEM_ID`) in a const list.
**Promptery task title:** "Reject Dirizher as board owner in set_board_owner guard"

### F-09 — [P1] No `space.workflow_graph` JSON column — Phase 5 has no cheap stub

**File:** `crates/infrastructure/src/db/migrations/008_space_board_icons_colors.sql` (last touch on spaces).
**Category:** schema future-proofing.
**Symptom:** D6/D7 specify a workflow graph (react-flow editor between cats; edges between `done.cat-A → incoming.cat-B`; auto/manual/conditional). The roadmap parks this in Phase 5 (`cat-as-agent-roadmap.md:279-291`). However, there is no schema column at all to land a no-op stub on the space row, which means every Phase 5 sub-task starts with "first add the migration."
**Root cause:** intentional deferral, but the cost of a nullable JSON column today is essentially zero (additive `ALTER TABLE`, no rewrite — see migration 008 for the pattern).
**Why it matters:** landing the JSON column now lets the frontend start prototyping the editor (`react-flow`) against a real persistence layer without forcing a migration in the same PR. This is the cheapest unlock for Phase 5 discovery.
**Suggested fix (S):** new migration `012_space_workflow_graph.sql`:
```sql
ALTER TABLE spaces ADD COLUMN workflow_graph_json TEXT NULL;
```
Domain layer treats NULL as "empty graph"; serialise as `serde_json::Value` in `Space` struct. No IPC surface yet — `update_space(workflow_graph_json: ...)` is a future addition.
**Promptery task title:** "Add nullable spaces.workflow_graph_json for Phase 5 stub"

### F-10 — [P1] No `move_task` IPC — column moves piggyback on generic `update_task`

**File:** `crates/api/src/handlers/tasks.rs:80-120`.
**Category:** Promptery feature parity.
**Symptom:** Promptery's MCP tool registry exposes `move_task(task_id, column_id, position)` as a first-class operation. Catique HUB folds this into `update_task` (the handler at `tasks.rs:80-120` checks if `column_id` changed and emits `task.moved` accordingly). Functionally equivalent for the IPC surface but the **MCP-sidecar** wire contract diverges: Promptery clients calling `move_task` against the new sidecar will fail.
**Root cause:** consolidation when E2.4 shipped a generic update-handler. Acceptable for in-app use; problematic for the MCP contract.
**Why it matters:** tools/agents written against Promptery's MCP catalogue won't find `move_task` and will error. If Catique HUB intends Promptery-compat at the MCP layer (per `docs/release-runbook-promptery-freeze.md`), this surface needs an alias.
**Suggested fix (S):** add a thin `move_task(task_id, column_id, position)` IPC that delegates to `update_task` — both names remain available.
**Promptery task title:** "Add move_task IPC alias for Promptery MCP compat"

### F-11 — [P2] No bulk `set_*_prompts` setters — only add/remove pairs

**File:** `crates/api/src/handlers/prompts.rs:147-218` (`add_*` / `remove_*` only); `crates/api/src/handlers/prompt_groups.rs:159` (only `set_prompt_group_members` — bulk — exists).
**Category:** Promptery feature parity.
**Symptom:** Promptery exposes `setBoardPrompts(boardId, promptIds)` / `setColumnPrompts` / `setRolePrompts` / `setTaskPrompts` as bulk setters that replace the entire collection in one call (matching the dnd-kit reorder UX). Catique HUB only has `add_*` / `remove_*` pairs, forcing the frontend to N+1 calls (or worse, accept a partial-update window).
**Root cause:** wave-E2.4 shipped the minimum primitive set; bulk setters were left for later.
**Why it matters:** every drag-reorder UI in the frontend is currently doing N IPC calls inside an optimistic block. Promptery's `set_prompt_group_members` (already in the codebase at `prompt_groups.rs:266`) shows the right pattern — replicate it for the four other join tables.
**Suggested fix (M):** add `set_role_prompts`, `set_board_prompts`, `set_column_prompts`, `set_space_prompts` (depends on F-02), `set_task_prompts` — each replaces the full list in one transaction. Frontend then drops the N+1 pattern.
**Promptery task title:** "Add bulk set_*_prompts setters across 4 entities"

### F-12 — [P2] `cat_id` is still spelled `role_id` everywhere — terminology drift

**File:** `crates/domain/src/board.rs` (`owner_role_id`); `crates/domain/src/task.rs` (`role_id`); `bindings/Board.ts:24` (`ownerRoleId`); `bindings/Task.ts:3` (`roleId`).
**Category:** code clarity / D-rebrand.
**Symptom:** ctq-73 D9 renames "role" to "cat" (`docs/catique-migration/cat-as-agent-roadmap.md:42` "boards has no `cat_id` FK"). Migration 004 elected to keep the column names as `role_id` / `owner_role_id` for backwards compatibility, but the domain types and TS bindings still expose `roleId`. Every frontend file that reads `task.roleId` is reading `cat_id` semantically.
**Root cause:** intentional Phase 1 trade-off (memo Q3 — "Cats live on roles table"). Phase 4 (P4-T3) flags a conditional `cats_table.sql` migration if cats become first-class.
**Why it matters:** as long as the ts-rs type says `roleId`, the frontend's mental model lags the product spec. Recommend a serde rename now (no schema change) so the wire contract reads `catId` while the SQL stays `role_id`.
**Suggested fix (S):** add `#[serde(rename = "catId")]` to `Task::role_id` and `Board::owner_role_id`. Regenerate bindings. Update frontend imports.
**Promptery task title:** "Rename role_id → cat_id at the wire layer (serde only)"

### F-13 — [P2] `task_ratings` PK is `task_id` only — D9 says `(task_id, cat_id)`

**File:** `crates/infrastructure/src/db/migrations/004_cat_as_agent_phase1.sql:127-131`.
**Category:** schema future-proofing.
**Symptom:** the migration explicitly notes (lines 122-126) "Phase 2 will widen the PK to `(task_id, cat_id)` once Cat is a separate domain entity." Phase 1 ships `task_id PRIMARY KEY` only, which means a task can only ever have one rating across all cats. This is fine while a task has at most one assigned cat — but D9 (multi-cat memory) requires per-cat ratings.
**Root cause:** intentional Phase 1 deferral.
**Why it matters:** lands in Phase 2 anyway (P2-T1, `cat-as-agent-roadmap.md:233`); calling it out here so the migration is on the radar.
**Suggested fix (M):** Phase 2 task — table rebuild dance (similar to `004` for boards) widening PK to `(task_id, cat_id)` and backfilling with the current task's `role_id` as `cat_id`.
**Promptery task title:** "Phase 2: widen task_ratings PK to (task_id, cat_id)"

### F-14 — [P3] No `agent_reports` author gating / no link to cat

**File:** `crates/infrastructure/src/db/migrations/001_initial.sql:371-380`; `bindings/AgentReport.ts`.
**Category:** Promptery parity / future-proofing.
**Symptom:** `agent_reports.author` is a free-text column (`001_initial.sql:377`). Cat-as-Agent will want to attribute reports to a specific cat (`role_id` FK), with the cat being the source-of-truth (display name comes from join). Today the author field is a string the caller types in.
**Root cause:** Promptery v0.4 contract.
**Why it matters:** low — author strings are not load-bearing today. Worth flagging so Phase 6 (cat-profile view, P6-T2) doesn't bolt on a parallel `cat_report_attribution` table.
**Suggested fix (S):** new migration `013_agent_reports_cat.sql` adding nullable `cat_id REFERENCES roles(id) ON DELETE SET NULL`. Frontend prefers `cat_id` if set, else falls back to `author` string.
**Promptery task title:** "Add agent_reports.cat_id FK for Phase 6 attribution"

---

## What works well

- **Migration runner discipline** (`004_cat_as_agent_phase1.sql:73-99`): the table-rebuild dance is the textbook idiomatic SQLite pattern (CREATE-new + INSERT-from-old + DROP + RENAME), with the `PRAGMA foreign_keys = OFF` window correctly scoped by the runner. Migrations 008–010 follow the same style. CI hash gate (`001_initial.sql:34-36`) catches schema drift against Promptery v0.4. Senior-bar.
- **Per-space slug counter under contention** (`crates/infrastructure/src/db/repositories/tasks.rs:152-216`): `IMMEDIATE` transaction + `MAX+1` is the right call (RESERVED lock at BEGIN serialises writers; defensive `UNIQUE(slug)` index is a backstop). The concurrent-insert test at lines 616-679 exercises the real WAL + `busy_timeout` path with a tempfile DB — exactly the kind of regression net a senior would build.
- **Auto-provisioning default board on space create** (`crates/application/src/spaces.rs:120-167`): single transaction, full rollback on either insert failing, and a paired test (`create_rolls_back_when_default_board_blocked`, lines 499-522) that asserts the invariant explicitly.
- **Typed `AppError` separation between domain validation and SQL violations** (`crates/application/src/error_map.rs`, error enum in `error.rs`): conflict / not-found / validation cleanly distinguished from `TransactionRolledBack`. The handlers in `boards.rs:186-213` use the typed errors well — the gap is in `roles::delete` (F-04), not in the error model itself.
- **`tasks_fts` triggers** (`001_initial.sql:313-329`): FTS5 with `unicode61 remove_diacritics 1` correctly mirrors INSERT/UPDATE/DELETE on the source table; `agent_reports_fts` (`001_initial.sql:392-408`) follows the same pattern. P1-T6's bench gate is the only thing missing — the schema is ready for it.
- **`prompt_groups::set_members`** (`crates/infrastructure/src/db/repositories/prompt_groups.rs:266`): bulk-replace pattern done right; the rollback test (`set_members_rolls_back_on_bad_fk`, line 540) is a good template for the F-11 setters.

---

## Recommended next tasks

Numbered, sized, ≤80 chars, ready for `mcp__promptery__create_task`:

1. `[M] Land prompt-inheritance resolver + get_task_bundle IPC`
2. `[S] Add space_prompts join + IPC for 4-level inheritance`
3. `[M] Materialise task_prompts.origin on role/board/column attach`
4. `[S] Guard delete_role against is_system + owned boards`
5. `[S] Expose set_board_owner IPC for cat reassignment`
6. `[M] Implement search_tasks_by_cat_and_space FTS5 query`
7. `[S] Reject Dirizher as board owner in set_board_owner guard`
8. `[S] Add nullable spaces.workflow_graph_json for Phase 5 stub`
9. `[S] Add move_task IPC alias for Promptery MCP compat`
10. `[M] Add bulk set_*_prompts setters across 4 entities`

Out of scope but noted for backlog (post-Phase-1):

- `[S] Rename role_id → cat_id at the wire layer (serde only)` (F-12)
- `[S] Extend role-delete trigger for Phase 2 cat refs` (F-07)
- `[M] Phase 2: widen task_ratings PK to (task_id, cat_id)` (F-13)
- `[S] Add agent_reports.cat_id FK for Phase 6 attribution` (F-14)
