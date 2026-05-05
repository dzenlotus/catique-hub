# Cat-as-Agent System — Phase 1–8 Decomposition Roadmap

**Status:** draft  
**Date:** 2026-05-05  
**Owner:** product-analyst  
**Parent initiative:** ctq-73 (Cat-as-Agent System v1.0)  
**Memo source:** cat-as-agent-phase1-memo.md (Approved for Phase 1)  
**Phase 1 tasks:** to be created in Promptery board `491pmde5YROQ1EFdu_oca`, column `v0.5 Core+Import`

---

## How to read this document

- Size labels: S = ~1 engineer-day, M = ~3 days, L = ~1 week, XL = multi-week
- `deps:` = tasks or ADRs that must be Done/Accepted before this can start
- `owner:` = recommended role (engineer / product-designer / product-analyst / tech-analyst / QA)
- `column:` = target Roadmap board column
- Phase 1 tasks include full Problem / Solution / DoD / AC structure (Promptery-ready)
- Phase 2–8 tasks are plan-only and will be created when the preceding phase ships

---

## Phase 1 — Schema Foundation + Migration Modal (target: v0.5 Core+Import)

All Phase 1 tasks are approved and unblocked. They can be created in Promptery immediately.

---

### P1-T1 [M] — `004_cat_agent.sql`: core schema migration

**linked-to: ctq-73**

**Problem.**
The current DB schema (`001_initial.sql`–`003_*.sql`) has no `cats` concept: `roles` has no `is_system` column, there is no `task_ratings` table, and `boards` has no `cat_id` FK. Cat-as-Agent cannot be built without these columns in place. The migration must be written as an idempotent SQL file embedded via `include_dir!` and guarded by the existing SHA gate in the migration runner.

**Solution.**
Author `crates/infrastructure/migrations/004_cat_agent.sql` containing:
1. `ALTER TABLE roles ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0` — enables Dirizher system-entity pattern (Q3 in Phase 1 memo, AC-D1).
2. `INSERT OR IGNORE INTO roles (...) VALUES ('dirizher-system', 'Dirizher', '', 1, ...)` — seeds the Dirizher row.
3. `ALTER TABLE boards ADD COLUMN cat_id TEXT REFERENCES roles(id)` — nullable initially; P1-T2 populates it.
4. `CREATE TABLE task_ratings (task_id, cat_id, rating INTEGER CHECK(rating IN (-1,0,1)), rated_at, PRIMARY KEY(task_id, cat_id))` — 3-state rating (Q4 in Phase 1 memo).
5. `CREATE INDEX idx_task_ratings_cat ON task_ratings(cat_id)` — supports per-cat memory queries.
The migration runner's `VACUUM INTO '$BACKUP_PATH'` preamble must fire before any DDL in this file (AC-M1). The migration is idempotent: re-running on an already-migrated DB is a no-op.

**Definition of Done.**
- `004_cat_agent.sql` file committed to `crates/infrastructure/migrations/`.
- Migration runner picks it up automatically via `include_dir!` (no Rust code changes required beyond `Role` struct update — see P1-T3).
- All existing integration tests (`pragmas_applied_to_new_connection`, etc.) remain green.
- `cargo test --workspace` green.

**Acceptance Criteria.**
- AC-M1: `VACUUM INTO` backup exists at `$APPLOCALDATA/catique/catique.db.bak` before migration transaction.
- AC-M4: Re-running the migration on an already-migrated DB is a no-op.
- AC-D1: `SELECT is_system FROM roles WHERE id = 'dirizher-system'` = 1 after migration.
- AC-R1: `INSERT INTO task_ratings (..., rating=2, ...)` is rejected by the CHECK constraint.
- AC-R2: A task with no `task_ratings` row returns `NULL` from a LEFT JOIN (unrated ≠ neutral).
- AC-S2: No `task_memory` table exists in this migration (FTS5 derived-view pattern is used instead — D4 locked).

**deps:** none (first migration in the chain)  
**owner:** engineer  
**column:** v0.5 Core+Import

---

### P1-T2 [S] — Board auto-assignment + `settings` migration flag

**linked-to: ctq-73**

**Problem.**
After P1-T1 adds `boards.cat_id`, all existing boards have `cat_id = NULL`. The app must assign a Maintainer cat to every board atomically during migration, and must record a `cat_migration_reviewed = false` flag in the `settings` table so the one-shot review modal (P1-T4) knows it needs to fire. Leaving `cat_id = NULL` creates conditional UI paths that multiply complexity across the codebase.

**Solution.**
Append to `004_cat_agent.sql` (or add as `004b` if runner ordering requires it):
1. `UPDATE boards SET cat_id = (SELECT id FROM roles WHERE is_system = 0 ORDER BY created_at LIMIT 1) WHERE cat_id IS NULL` — assigns the earliest non-system role as Maintainer cat to every unassigned board in one transaction. If no non-system role exists, creates a default `Maintainer` role first and assigns it.
2. `INSERT OR IGNORE INTO settings (key, value) VALUES ('cat_migration_reviewed', 'false')` — seeds the one-shot modal gate.

**Definition of Done.**
- No board with `cat_id IS NULL` exists after migration.
- `settings` table contains `cat_migration_reviewed = false`.
- Integration test `migration_leaves_no_null_cat_id` added to `crates/infrastructure/tests/`.

**Acceptance Criteria.**
- AC-M2: `SELECT COUNT(*) FROM boards WHERE cat_id IS NULL` = 0 post-migration.
- AC-M3: `settings.cat_migration_reviewed = false` after migration; `true` after user dismisses the review modal (modal sets this via `update_setting` command — modal is P1-T4).

**deps:** P1-T1  
**owner:** engineer  
**column:** v0.5 Core+Import

---

### P1-T3 [S] — Rust domain struct updates: `Role.is_system` + `Board.cat_id`

**linked-to: ctq-73**

**Problem.**
`crates/domain/src/role.rs` defines the `Role` struct without an `is_system` field. `crates/domain/src/board.rs` defines `Board` without a `cat_id` field. After P1-T1 runs the migration, the repository layer will fail to deserialize rows because `rusqlite` row mapping is positional/named and the new columns are invisible to the struct. The application layer guard `update_role` must also be able to inspect `is_system` to return `AppError::Forbidden` (AC-D2, AC-D3).

**Solution.**
1. Add `pub is_system: bool` to `Role` in `crates/domain/src/role.rs`. Default mapping: `row.get("is_system").unwrap_or(0) != 0`.
2. Add `pub cat_id: Option<String>` to `Board` in `crates/domain/src/board.rs`.
3. Update `RoleRepository::from_row` in `crates/infrastructure/src/repositories/role_repository.rs` to map the new column.
4. Update `BoardRepository::from_row` similarly.
5. In `crates/application/src/use_cases/update_role.rs`, add guard: `if role.is_system { return Err(AppError::Forbidden); }`.
6. In `delete_role.rs`, add same guard.
7. Update serialization in `crates/api/src/commands/roles.rs` to include `is_system` in the IPC response (Dirizher should be visible in `list_roles` for debugging — AC-D4 — but UI hides it via `is_system` flag).

**Definition of Done.**
- `cargo build --workspace` clean.
- `cargo clippy --workspace -- -D warnings` clean.
- Unit tests in `crates/application/tests/` cover `update_role` and `delete_role` rejection when `is_system = true`.

**Acceptance Criteria.**
- AC-D2: `update_role('dirizher-system', ...)` returns `AppError::Forbidden`.
- AC-D3: `delete_role('dirizher-system')` returns `AppError::Forbidden`.
- AC-D4: `list_roles` response includes the Dirizher row with `is_system: true`; UI uses this flag to hide it from role-picker dropdowns.

**deps:** P1-T1  
**owner:** engineer  
**column:** v0.5 Core+Import

---

### P1-T4 [M] — One-shot cat migration review modal (UI)

**linked-to: ctq-73**

**Problem.**
After migration, every board has been auto-assigned a Maintainer cat (P1-T2). The user has no awareness of these assignments and no chance to correct them before they propagate into sync outputs. The review modal provides a single, forced audit moment without blocking migration. Without it, incorrect cat assignments silently pollute agent sync files.

**Solution.**
Implement a one-shot modal (`CatMigrationReviewModal`) in the React frontend:
1. On app startup, after migration is confirmed, call `get_setting('cat_migration_reviewed')`. If `false`, render the modal.
2. The modal lists all boards with their auto-assigned cat name and a per-board dropdown (populated from `list_roles` excluding `is_system = true` entries).
3. User can change any assignment; each change calls `update_board_cat(board_id, cat_id)`.
4. "Looks good" CTA calls `update_setting('cat_migration_reviewed', 'true')` and closes the modal. Modal does not render again.
5. If user closes without dismissing (e.g. clicks outside), modal re-opens on next launch (`cat_migration_reviewed` remains `false`).
6. Design spec required from product-designer before dev starts (OQ-M2: reassign UX — dropdown of existing cats only, no creation flow in Phase 1).

**Definition of Done.**
- Modal renders only when `cat_migration_reviewed = false`.
- Each reassignment persists immediately (optimistic update with rollback on error).
- Dismissal sets `cat_migration_reviewed = true` and modal never re-renders.
- Design file linked in this task before implementation begins.

**Acceptance Criteria.**
- AC-M3: `settings.cat_migration_reviewed = true` after user dismisses the modal.
- Modal does not render if user launches the app a second time after dismissal.
- All boards shown in the modal. Dropdown excludes `is_system = true` cats.
- E2E test (Playwright or tauri-driver) verifies: fresh DB → modal shown; dismiss → modal absent on restart.

**deps:** P1-T2, P1-T3, design sign-off on modal UX  
**owner:** engineer (UI) + product-designer (modal UX spec)  
**column:** v0.5 Core+Import

---

### P1-T5 [S] — Cat filename convention: `agent_filename` updated to accept `cat_id`

**linked-to: ctq-73**

**Problem.**
ADR-0005 mandates `catique-{role_id}.md` as the filename for agent sync files. Cat-as-Agent introduces `cat_id` (which is a `roles.id` in Phase 1, since cats extend roles). The `ClientAdapter` trait method `agent_filename(role_id: &str)` must be verified to work with `cat_id` without a separate code path, and the contract must be tested explicitly to prevent a future refactor from accidentally using display names as filenames (Option B from Q2 in memo — ruled out, breaking ADR-0005).

**Solution.**
1. Add a unit test `cat_filename_uses_stable_id_not_display_name` in `crates/clients/src/adapters/` that asserts `claude_code_adapter.agent_filename("abc-123-uuid")` returns `"catique-abc-123-uuid.md"` regardless of any display name field.
2. Add a unit test `renaming_cat_does_not_change_filename` that asserts: given role id `abc-123`, change `display_name` to `new-name`, call `agent_filename("abc-123")` — still returns `catique-abc-123.md`.
3. Document in `ClientAdapter` trait doc-comment: "Pass `cat.id` (not `cat.display_name` or slug). Stable by design — see ADR-0005 and Phase 1 memo Q2."
4. Confirm `RoleSyncReport.skipped` is emitted for files missing the `catique-` prefix or `managed-by: catique-hub` frontmatter (AC-F3 — this may already pass; test it explicitly).

**Definition of Done.**
- All three tests added and green.
- Doc-comment updated.
- `cargo test --workspace` green.

**Acceptance Criteria.**
- AC-F1: `agent_filename(cat_id)` returns `catique-{cat_id}.md` regardless of `Cat.display_name`.
- AC-F2: Renaming a cat's display name and triggering sync produces updated `role-name:` frontmatter but the same filesystem path.
- AC-F3: A cat file missing the `catique-` prefix or `managed-by` frontmatter appears in `RoleSyncReport.skipped`.

**deps:** P1-T3 (cat_id is a roles.id in Phase 1; no structural blocker but logical dependency)  
**owner:** engineer  
**column:** v0.5 Core+Import

---

### P1-T6 [S] — FTS5 memory query: `search_tasks_by_cat_and_space` command

**linked-to: ctq-73**

**Problem.**
D4 (locked decision) defines cat memory as a FTS5 query over `tasks` scoped to `(cat_id, space_id)`. No IPC command currently exposes this query shape. Without it, Phase 2 memory-weighting and Phase 3 agent-context building have no data access path.

**Solution.**
1. Implement SQL query in `crates/infrastructure/src/repositories/task_repository.rs`:
   ```sql
   SELECT t.id, t.title, t.description, t.role_id
   FROM tasks t
   JOIN boards b ON t.board_id = b.id
   JOIN tasks_fts f ON f.task_id = t.id
   WHERE b.space_id = ?1
     AND t.role_id  = ?2
     AND tasks_fts  MATCH ?3
   ORDER BY rank
   LIMIT 20;
   ```
2. Expose as `search_tasks_by_cat_and_space(space_id, cat_id, query)` Tauri command in `crates/api/src/commands/tasks.rs`.
3. Add a performance test (criterion benchmark) seeded with 10,000 tasks that asserts P99 < 100 ms (`EXPLAIN QUERY PLAN` must confirm FTS5 usage).
4. No `task_memory` table. Assert `AC-S2` (table must not exist) in the integration test suite.

**Definition of Done.**
- Command implemented, documented, callable from frontend.
- Benchmark added and passing at P99 < 100 ms on 10k tasks.
- `AC-S2` assertion test added.

**Acceptance Criteria.**
- AC-S1: Query returns results in < 100 ms P99 on 10,000-task test DB.
- AC-S2: No `task_memory` table in DB after migration.
- AC-S3: Inserting a task updates `tasks_fts` automatically (existing trigger verified).
- AC-S4: Scope `(cat_id, space_id)` is enforced as query parameters, not a stored column.

**deps:** P1-T1 (schema), P1-T3 (Board has space_id via board → space join)  
**owner:** engineer  
**column:** v0.5 Core+Import

---

## Phase 2 — Rating UI + Memory Weighting (target: v0.6 Kanban)

*Plan only. Promptery tasks to be created after Phase 1 ships.*

### P2-T1 [M] — Task rating widget (good / neutral / bad)
Implement 3-state rating component on the task card and task detail view. Writes `{-1, 0, +1}` to `task_ratings` via a new `rate_task(task_id, cat_id, rating)` Tauri command. UI renders three discrete states as colour-coded tap targets (green / grey / red). `NULL` (unrated) = no highlight. Design spec required before dev. **deps:** P1-T1, P1-T3. **owner:** engineer + product-designer. **size:** M.

### P2-T2 [M] — Memory relevance weighting formula (Phase 2 algorithm)
Define and implement how `task_ratings.rating` (-1/0/+1) scales FTS5 rank in `search_tasks_by_cat_and_space`. OQ-R2 from Phase 1 memo. Candidate formula: `final_score = fts_rank * (1 + 0.5 * rating)` (good tasks rank 50% higher, bad tasks 50% lower). Requires product sign-off on formula and a criterion benchmark showing the formula adds < 2 ms overhead. **deps:** P1-T6, P2-T1. **owner:** tech-analyst + engineer. **size:** M.

### P2-T3 [S] — `task_ratings.notes` freeform column
Add optional `notes TEXT` column to `task_ratings` (OQ-R1). New migration `005_rating_notes.sql`. UI: freeform textarea below the rating widget, auto-saved on blur. **deps:** P1-T1, P2-T1. **owner:** engineer. **size:** S.

### P2-T4 [S] — FTS5 tokenizer validation for RU/EN memory bodies
OQ-S2 from Phase 1 memo: confirm `unicode61 remove_diacritics 1` tokenizer (already in `001_initial.sql`) handles mixed Russian/English task descriptions correctly for memory recall. Test: seed 1,000 Russian-language task titles; confirm FTS5 returns top-3 results for Cyrillic search terms. If inadequate, propose ADR for `unicode61 categories` or `trigram`. **deps:** P1-T6. **owner:** engineer + QA. **size:** S.

### P2-T5 [S] — Per-space Dirizher configuration (OQ-D1)
Phase 1 Dirizher is a global singleton. Phase 2 allows per-space override: a `space_dirizher_overrides` table maps `(space_id, role_id)` to a custom Dirizher. UI in Space Settings. **deps:** P1-T3, P2-T1. **owner:** engineer + product-designer. **size:** S.

---

## Phase 3 — Cat Context Window Assembly (target: v0.6 Kanban)

*Plan only.*

### P3-T1 [L] — `build_cat_context(cat_id, space_id, query)` use-case
Core orchestration: given a cat and space, assemble the context window sent to the LLM. Inputs: top-N tasks from FTS5 (P1-T6, P2-T2), cat's own prompt content (from `roles.content`), space-level prompt inheritance chain. Output: `CatContext { system_prompt: String, memory_snippets: Vec<TaskSnippet>, token_estimate: usize }`. Token estimate must stay within configurable budget (default 8,000 tokens). OQ-S1 (`step_log`) deferred to this phase: decide whether `step_log` is a dedicated `tasks` column or reuses `description`. **deps:** P1-T6, P2-T2. **owner:** engineer + product-analyst. **size:** L.

### P3-T2 [M] — Cat context preview panel (UI)
Read-only panel showing what a cat "sees" before it acts: memory snippets, inherited prompt chain, token count. Helps users debug unexpected agent behaviour. Triggers `build_cat_context` IPC call. **deps:** P3-T1. **owner:** engineer + product-designer. **size:** M.

### P3-T3 [S] — `step_log` decision: dedicated column vs `description` reuse (OQ-S1)
Author a one-page decision note (product-analyst) choosing between: (a) reuse `tasks.description` as step log body — zero migration cost; (b) add `tasks.step_log TEXT` column — clean separation but another migration. Recommend (a) for Phase 3, (b) deferred to Phase 4 if log verbosity grows. Outcome locks P3-T1 implementation detail. **deps:** P1-T1. **owner:** product-analyst. **size:** S.

---

## Phase 4 — Pattern A: Single-Cat Task Execution (target: v0.7–0.8 Vslices)

*Plan only.*

### P4-T1 [L] — `assign_cat_to_task` + task execution flow (Pattern A)
A task card can have a cat assigned. On "Run", Catique HUB sends context (`build_cat_context`) to the cat's configured agentic client via the MCP sidecar and receives a structured result. Result is written back as a task comment / step log. Pattern A (one cat, one task): no Dirizher involvement. **deps:** P3-T1, ADR-0002 (MCP sidecar). **owner:** engineer + tech-analyst. **size:** L.

### P4-T2 [M] — Cat assignment UI on task card
Dropdown or avatar-picker on the task card to assign / change a cat. Shows cat name and a status indicator (idle / running / done / failed). **deps:** P4-T1. **owner:** engineer + product-designer. **size:** M.

### P4-T3 [S] — `cat_assignments` join table (if cats become a separate table)
If Phase 4 discovery reveals that cats need to be a first-class table (not just extended `roles` rows), author `006_cats_table.sql` migration and update all FK references. This task is conditional: only execute if the Phase 1 assumption "cats = extended roles rows" proves insufficient. **deps:** P1-T1, P1-T3. **owner:** engineer + tech-analyst. **size:** S.

---

## Phase 5 — Pattern B: Dirizher Coordination (target: v0.7–0.8 Vslices)

*Plan only.*

### P5-T1 [XL] — Dirizher task-routing engine (Pattern B core)
Dirizher receives a high-level task and decomposes it into sub-tasks, assigns each to a specialist cat, and monitors completion. Token-cost concern (R2 in ctq-73): Dirizher makes one LLM call per routing decision. A board with 20 active tasks = up to 20 Dirizher calls. Mitigate by batching: Dirizher receives a list of N tasks per invocation (configurable `dirizher_batch_size`, default 5). Cost visibility sub-task required (see P7-T1). **deps:** P4-T1, P3-T1. **owner:** engineer + tech-analyst + product-analyst. **size:** XL.

### P5-T2 [M] — Sub-task spawning from Dirizher output
When Dirizher routes a task, it may spawn child sub-tasks on the board. UI must show parent–child relationship in kanban view. New `parent_task_id` FK on `tasks` table (migration `007_task_parent.sql`). **deps:** P5-T1. **owner:** engineer + product-designer. **size:** M.

### P5-T3 [M] — Dirizher dry-run mode
Before Dirizher executes, show the user a preview of proposed assignments and sub-task spawns. User must confirm or veto. Prevents runaway LLM spend on misconfigured boards. **deps:** P5-T1. **owner:** engineer + product-designer. **size:** M.

---

## Phase 6 — Cat Profile + Expertise Indicator (target: v0.7–0.8 Vslices)

*Plan only.*

### P6-T1 [M] — Cat expertise score: aggregate rating → UI badge
Compute per-cat expertise score from `task_ratings` aggregate: `score = AVG(rating) * LOG(1 + COUNT(*))`. Display as a colour-coded badge on cat avatar. Auto-updates on rating change. Benchmark: aggregate query on 10,000 ratings < 20 ms. **deps:** P2-T1. **owner:** engineer + product-designer. **size:** M.

### P6-T2 [S] — Cat profile view
Full-page view for a cat: name, prompt content, expertise score, recent task history (last 20 tasks from FTS5 memory), connected client sync status. **deps:** P6-T1, P1-T5. **owner:** engineer + product-designer. **size:** S.

### P6-T3 [S] — Review modal: per-column and per-task overrides (OQ-M1)
Extend the Phase 1 review modal (P1-T4) to allow per-column (not just per-board) cat overrides. Deferred from Phase 1 per memo OQ-M1. **deps:** P1-T4. **owner:** engineer + product-designer. **size:** S.

---

## Phase 7 — Token Cost Transparency + User Communication (target: v0.9 MCP Sidecar)

*Plan only. R2 concern (Pattern B token cost) is surfaced here as explicit user-comms work, not a hidden assumption.*

### P7-T1 [M] — Token cost estimator + spend dashboard
**Explicit response to R2 (Pattern B token-cost concern from ctq-73).** Before this ships, users have no visibility into how many LLM tokens Dirizher is consuming on their behalf. Implement: (a) token counter in `CatContext` (already has `token_estimate` from P3-T1); (b) persist cumulative spend per cat per day in `settings` (JSON blob); (c) "Agent Spend" panel in Settings showing per-cat daily token usage, estimated cost at user-configured rate ($/1k tokens), and a configurable hard cap that pauses Dirizher when reached. This is a user-comms deliverable as much as an engineering one: copy must clearly explain what triggers Dirizher calls and how to reduce them. **deps:** P5-T1, P3-T1. **owner:** engineer + product-analyst (copy) + product-designer. **size:** M.

### P7-T2 [S] — Dirizher batch size user setting
Expose `dirizher_batch_size` (default 5, range 1–20) in Settings. Each batch = one LLM call. Clear explanation of cost trade-off in UI tooltip. **deps:** P5-T1, P7-T1. **owner:** engineer + product-analyst (copy). **size:** S.

### P7-T3 [S] — `ClientAdapter` method `cat_filename` vs `agent_filename` resolution (OQ-F1)
OQ-F1 from Phase 1 memo: decide whether cats get their own `cat_filename(cat_id)` method on `ClientAdapter` or reuse `agent_filename(role_id)` with `cat_id` passed in. Both conventions are identical for Phase 1 (cats = roles rows), but if Phase 4 introduces a separate `cats` table, the API surface diverges. Author a short decision note and implement the chosen path. **deps:** P4-T3 (conditional), P1-T5. **owner:** tech-analyst + engineer. **size:** S.

---

## Phase 8 — v1.0 Distribution Readiness (target: v1.0 Distribution)

*Plan only.*

### P8-T1 [M] — Cat-as-Agent migration: onboarding guide + CHANGELOG entry
User-facing documentation for the Promptery → Catique HUB migration, covering: what changed (roles → cats), what happened to their boards (auto-assignment + review modal), how to configure Dirizher, token cost FAQ. CHANGELOG entry for v1.0 release. **deps:** all Phase 1–7 tasks Done. **owner:** product-analyst. **size:** M.

### P8-T2 [S] — v1.0 P99 latency assertions in CI (NFR gate)
Add criterion benchmark assertions enforcing P99 < 50 ms for `get_task_bundle` and P99 < 100 ms for `search_tasks` (NFR gates from nfr-rust-stack.md §1.1). These block merge to `main` from v1.0 milestone onward. **deps:** P1-T6, P3-T1. **owner:** engineer + QA. **size:** S.

### P8-T3 [S] — Code-signing decision for Cat-as-Agent binary artifacts (D-018)
`docs/release-runbook.md` references D-018 (code-signing decision, ctq-62). Confirm code-signing config covers any new sidecar binaries introduced by Cat-as-Agent (Phase 4–5 MCP calls may spawn new sub-processes). **deps:** P4-T1, ADR-0002. **owner:** tech-analyst. **size:** S.

### P8-T4 [M] — End-to-end smoke test: Promptery → Catique HUB full migration path
Automated test: (a) seed a Promptery-shaped SQLite DB with boards, roles, tasks; (b) run migration runner through `001`–`004`; (c) assert all Phase 1 ACs; (d) simulate user dismissing the review modal; (e) assert `cat_migration_reviewed = true` and all boards have valid `cat_id`. Run in CI on macOS and Windows. **deps:** all Phase 1 tasks. **owner:** QA + engineer. **size:** M.

---

## Dependency Graph — Critical Path

```
P1-T1 (schema)
  ├── P1-T2 (auto-assign + settings flag)
  │     └── P1-T4 (review modal) ← also needs design sign-off
  ├── P1-T3 (Rust structs)
  │     ├── P1-T4
  │     └── P1-T5 (filename tests)
  └── P1-T6 (FTS5 memory command)
        └── P2-T2 (weighting formula)
              └── P3-T1 (context assembly)
                    ├── P4-T1 (Pattern A execution)
                    └── P5-T1 (Dirizher / Pattern B) ← most fragile edge
                          └── P7-T1 (token cost dashboard)
```

**Most fragile dependency edge:** `P3-T1 → P5-T1` (Dirizher). P5-T1 is XL-sized, depends on context assembly being correct (P3-T1), AND on the token-cost concern (R2) being mitigated before shipping. If P3-T1 ships with an incorrect token-estimate implementation, P5-T1 will either over-run budgets silently or require a rewrite of the context assembly API. Mitigation: P7-T1 (token dashboard) should prototype alongside P5-T1, not after it.

---

## Phase task counts (plan-only phases)

| Phase | Tasks | Status |
|---|---|---|
| Phase 1 | 6 | Approved — Promptery tasks to be created |
| Phase 2 | 5 | Plan only |
| Phase 3 | 3 | Plan only |
| Phase 4 | 3 | Plan only |
| Phase 5 | 3 | Plan only |
| Phase 6 | 3 | Plan only |
| Phase 7 | 3 | Plan only |
| Phase 8 | 4 | Plan only |
| **Total** | **30** | — |

---

## Open Questions Inherited from Phase 1 Memo (still deferred)

| ID | Question | Target phase |
|---|---|---|
| OQ-M1 | Review modal: per-column and per-task overrides | Phase 6 (P6-T3) |
| OQ-M2 | Reassign UX: dropdown only vs. creation flow | Phase 1 (P1-T4 design spec) |
| OQ-F1 | `cat_filename` vs `agent_filename` API surface | Phase 7 (P7-T3) |
| OQ-D1 | Per-space Dirizher replication | Phase 2 (P2-T5) |
| OQ-R1 | `task_ratings.notes` column | Phase 2 (P2-T3) |
| OQ-R2 | Memory weighting formula | Phase 2 (P2-T2) |
| OQ-S1 | `step_log` as dedicated column vs `description` reuse | Phase 3 (P3-T3) |
| OQ-S2 | FTS5 tokenizer for RU/EN content | Phase 2 (P2-T4) |

---

*Document owner: product-analyst. Next review: after Phase 1 ships. Phase 2 Promptery tasks to be created at that point.*
