# ADR-0006 — Prompt-Inheritance Resolver Design (ctq-98)

**Status:** Accepted
**Date:** 2026-05-05
**Author:** tech-analyst
**Blocks:** ctq-98 (resolver implementation) → Phase 4/5 cat-as-agent execution, Pattern A, Dirizher routing

---

## Context

The `task_prompts`, `task_skills`, and `task_mcp_tools` tables all carry an `origin` column (`001_initial.sql:181,189,196`) defined as `TEXT NOT NULL DEFAULT 'direct'`. The cleanup trigger `cleanup_role_origin_on_role_delete` (`001_initial.sql:245-251`) already assumes materialised rows exist with `origin = 'role:<id>'` — it deletes them on role removal. The comment at `tasks.rs:407-408` explicitly defers the resolver to wave E3. Today that wave has not shipped: `add_task_prompt` (`tasks.rs:391-404`) hard-codes `origin = 'direct'` and that is the only INSERT path on `task_prompts`. The `role_prompts`, `board_prompts`, `column_prompts` join tables are populated but never folded into what a task actually ships to the LLM.

The product's 4-level inheritance spec (`space → board → column → role/cat → task direct`) requires an assembly step that resolves the effective prompt union before every `get_task_bundle` call. D-001 through D-003 lock the delivery transport (MCP sidecar, Node stdio, bundled Node 20). The resolver sits one layer below the sidecar: it is the Rust function that answers "what prompts, skills, and mcp_tools are active for task T right now?" The MCP surface returns that answer in the existing `<role>/<prompts>` XML envelope from Promptery. Skills and mcp_tools extend the same envelope per findings F-10 in `skills-mcp-proxy-ideas-audit.md`.

The `space_prompts` table does not exist yet (`backend-parity-and-inheritance-audit.md` F-02). Migration `011_space_prompts.sql` is a prerequisite for the full 4-level chain but is out of scope for this ADR. The resolver is designed to tolerate its absence: if `space_prompts` does not exist the space level simply contributes zero rows.

---

## Decision

**Chosen option: Write-time materialisation (Option 2).**

When a prompt (or skill, or mcp_tool) is attached at any scope above task-direct — via `add_role_prompt`, `add_board_prompt`, `add_column_prompt`, or the future `add_space_prompt` — the application layer immediately INSERTs a corresponding row into `task_prompts` (respectively `task_skills`, `task_mcp_tools`) for every task in scope, tagged with `origin = '<scope>:<scope_id>'`. Reads become a single-table `SELECT … FROM task_prompts WHERE task_id = ?1 ORDER BY position` with no JOIN overhead. The existing trigger already handles the delete side for the role scope; the PR extends analogous cleanup to board and column scopes.

The decisive trade-off axis is **read-path performance against the P99 < 50 ms gate** (`cat-as-agent-roadmap.md:332`, P8-T2). A read-time JOIN over 8 sources — `space_prompts`, `board_prompts`, `column_prompts`, `role_prompts` (cat), `task_prompts(direct)`, plus the same three for the future task-level skills/mcp_tools — amounts to a 5–8-table UNION on every `get_task_bundle` call. SQLite's query planner cannot materialise a UNION across multiple index scans more cheaply than a prepared single-table SELECT; the Promptery benchmark suite (`nfr-rust-stack.md §1.1`) measured P99 at 31 ms for the single-table path and 78 ms for the equivalent 5-table JOIN path on a 10k-task WAL database, breaching the gate. Write-time materialisation passes the gate by design: the hot path is one index seek on `idx_task_prompts_task`.

The write-path blast radius is the primary cost. Attaching a prompt to a board that owns 500 tasks is a 500-row INSERT batch — a one-time cost paid at configuration time, not at agent-invocation time. A board with 500 tasks is a plausible maximum for this personal-tool product; a criterion bench of that scenario must confirm the write completes in under 500 ms (10× tolerance over the read gate) to qualify as acceptable. Cleanup on detach is the symmetric DELETE batch; the existing role-delete trigger pattern (`001_initial.sql:245-251`) proves this is the established convention in the codebase and not a novel pattern.

SQLite views (Option 3) are not materialised and therefore offer identical read performance to Option 1. The hybrid (Option 4) splits the read into two code paths that must be kept in sync, adding maintenance surface without changing the asymptotic behaviour. Option 1 is the correct fallback if write latency ever exceeds tolerance, but the personal-tool ethos prioritises read latency (the agent hot path) over write latency (the human configuration path).

---

## Trade-off Matrix

| Axis | Option 1: Read-time JOIN | Option 2: Write-time materialisation (chosen) | Option 3: SQL view | Option 4: Hybrid |
|---|---|---|---|---|
| **Fit to problem** | Correct semantics; single truth | Correct semantics; mirrors existing trigger convention | Correct; no write-path change | Correct but two read paths |
| **New dependency weight** | None | None | None | None |
| **Ops burden — partial failures** | No write state; trivially recoverable | Batch INSERT/DELETE failure leaves stale rows; backfill step required on first deploy | Same as Option 1 | Highest — must handle both failure modes |
| **Ops burden — schema migrations** | Clean; add `space_prompts`, resolver picks it up | Requires backfill walker on every new join table | Clean | Partial |
| **Maintenance cost** | Complex SQL query to debug; no row-level evidence | Origin column makes inheritance chain auditable per row; `SELECT * FROM task_prompts WHERE task_id=?` tells the full story | Same as Option 1 | Two debuggable read paths but must prove they agree |
| **Read P99 on 10k tasks** | ~78 ms (5-table UNION, estimated from Promptery bench) — **fails gate** | ~31 ms (single index scan) — **passes gate** | ~78 ms — **fails gate** | ~31 ms on common path — passes gate |
| **Write latency at 500-task board** | No write cost | ~500-row INSERT batch; estimated < 300 ms in WAL mode — acceptable | No write cost | Mixed |
| **Team familiarity** | Standard SQL | Consistent with existing trigger pattern; no new Rust crates | Standard SQL | Requires understanding both strategies |
| **Extensibility (ctq-119 board/column/space skills)** | Add source tables; query grows | Add backfill helper per new scope; pattern is uniform | Add to UNION view | Inconsistent extension path |
| **License** | N/A | N/A | N/A | N/A |

---

## Acceptance Criteria

The engineer may merge ctq-98 only when all of the following pass in CI:

**AC-1 — Single-table read path.** `get_task_bundle(task_id)` issues exactly one SQL statement against `task_prompts` (verified via `EXPLAIN QUERY PLAN` in the criterion harness; no JOIN or UNION keyword may appear in the plan output).

**AC-2 — Origin materialisation on role attach.** After `add_role_prompt(role_id, prompt_id)` is called, every task whose `role_id = role_id` has a row in `task_prompts` with `origin = 'role:<role_id>'` and `prompt_id = prompt_id`. Assert with a test seeded with 50 tasks on a role.

**AC-3 — Origin materialisation on board and column attach.** Same assertion as AC-2 for `add_board_prompt` (origin `'board:<board_id>'`) and `add_column_prompt` (origin `'column:<column_id>'`). Each with 50-task seed.

**AC-4 — Cleanup on detach.** After `remove_role_prompt(role_id, prompt_id)`, no `task_prompts` row with `origin = 'role:<role_id>'` and `prompt_id = prompt_id` exists. Direct rows (`origin = 'direct'`) for the same `prompt_id` on any task in scope are NOT removed.

**AC-5 — Override semantics.** A task-direct row (`origin = 'direct'`) for a given `prompt_id` wins over any inherited row for the same `prompt_id`. `get_task_bundle` returns that prompt_id exactly once, with origin `'direct'`. Assert with a task that has both a direct attachment and an inherited one from its role.

**AC-6 — P99 performance gate.** A criterion benchmark seeded with 10,000 tasks (each having 3 direct prompts + 2 role-inherited prompts + 1 board-inherited prompt) asserts `get_task_bundle` P99 < 50 ms. Benchmark must run in CI via `cargo bench --bench resolver_bench -- --output-format bencher` and its output must be asserted by the CI job. (Reference: `cat-as-agent-roadmap.md:332`, P8-T2.)

---

## Open Questions for the Engineer

**OQ-1 — Backfill ordering on first deploy.** The backfill walker must materialise rows for all existing role/board/column attachments. What transaction strategy guarantees consistency if the walker is interrupted mid-run? Options: (a) single mega-transaction (simple but blocks writes for large DBs), (b) chunked transactions with a resumable cursor row in `settings`. Decide before writing the backfill; commit the choice as a comment in the backfill function.

**OQ-2 — Position value for inherited rows.** `task_prompts.position` is `REAL NOT NULL DEFAULT 0`. When a role-inherited prompt is materialised, what position does it receive? The Promptery convention was `<scope_position>` (the position the prompt has within the role's list). Confirm whether the frontend's rendering order relies on `position` within `task_prompts` or re-orders by origin prefix first. This decides whether the INSERT copies `role_prompts.position` verbatim or assigns a scope-offset.

**OQ-3 — `space_prompts` dependency.** Migration `011_space_prompts.sql` is a prerequisite for the space inheritance level. Should ctq-98 land with the space level stubbed (no-op if `space_prompts` absent) or should ctq-98 be blocked on that migration landing first? The resolver code path for space must be written regardless; the question is whether the PR ships with a TODO guard or a hard dependency.

**OQ-4 — Skills and mcp_tools scope.** `task_skills` and `task_mcp_tools` share the same `origin` column and cleanup trigger. The resolver must include them per `skills-mcp-proxy-ideas-audit.md` F-10. However, `board_skills` and `column_skills` do not yet exist (F-01 in that audit). Decide whether ctq-98 handles role-level skills/mcp_tools only (unblocking the bundle today) and defers board/column skills to a follow-on PR, or blocks until all scope tables exist.

**OQ-5 — Concurrent write contention.** SQLite WAL mode serialises writers. If a user attaches a prompt to a board while an agent is calling `get_task_bundle` concurrently, the read will see either the pre- or post-attach snapshot (MVCC snapshot isolation). Confirm this is acceptable and document it in the resolver's doc-comment; do not introduce advisory locks.

---

## Implementation Outline

Steps are ordered; each must be reviewed before the next begins.

1. **`crates/application/src/resolver.rs` — new module.** Define `pub struct TaskBundle { prompts: Vec<ResolvedPrompt>, skills: Vec<ResolvedSkill>, mcp_tools: Vec<ResolvedMcpTool>, source_chain: Vec<OriginRef> }` and `pub enum OriginRef { Direct, Role(String), Board(String), Column(String), Space(String) }`. No DB access in this module — pure domain types.

2. **`crates/infrastructure/src/db/repositories/tasks.rs` — materialise helpers.** Add `materialise_role_prompts(conn, role_id, prompt_id, position)`, `materialise_board_prompts(conn, board_id, prompt_id, position)`, `materialise_column_prompts(conn, column_id, prompt_id, position)`. Each issues:
   ```sql
   INSERT INTO task_prompts (task_id, prompt_id, origin, position)
   SELECT t.id, ?2, ?3, ?4
   FROM tasks t
   WHERE t.<scope_fk> = ?1
   ON CONFLICT(task_id, prompt_id) DO NOTHING
   ```
   Symmetric `dematerialise_*` helpers issue the DELETE. Add analogous helpers for `task_skills` and `task_mcp_tools` (role scope only, pending OQ-4 resolution).

3. **`crates/api/src/handlers/prompts.rs:147-218` — wire materialise on attach/detach.** The three `add_*_prompt` handlers call the new materialise helpers inside the same transaction. The three `remove_*_prompt` handlers call dematerialise. No change to the handler signatures or IPC command names.

4. **`crates/infrastructure/src/db/repositories/tasks.rs` — `get_task_bundle` read path.** Add:
   ```sql
   SELECT tp.prompt_id, tp.origin, tp.position,
          p.name, p.content, p.color, p.token_count
   FROM task_prompts tp
   JOIN prompts p ON p.id = tp.prompt_id
   WHERE tp.task_id = ?1
   ORDER BY tp.position
   ```
   Deduplication: if two rows share `prompt_id`, keep the one with `origin = 'direct'` (lower precedence wins by the override rule). Implement dedup in Rust after the fetch, not in SQL, to keep the query plan simple and the index seek hot.

5. **`crates/application/src/tasks.rs` (or new `get_task_bundle.rs` use-case).** Assemble `TaskBundle` from the repo result. Populate `source_chain` by grouping rows by origin prefix. Return `TaskBundle`.

6. **`src-tauri/src/lib.rs` — register `get_task_bundle` IPC command.** Expose as `get_task_bundle(task_id: String) -> Result<TaskBundle, AppError>`. Regenerate `bindings/TaskBundle.ts` via ts-rs.

7. **Backfill function.** Add `crates/application/src/resolver_backfill.rs` with `backfill_all(conn) -> Result<usize, AppError>` that walks `role_prompts`, `board_prompts`, `column_prompts` and calls the materialise helpers. Called once at startup if `settings.resolver_backfill_done != 'true'`; sets the flag on completion. See OQ-1 for transaction strategy.

8. **Criterion benchmark.** Add `crates/infrastructure/benches/resolver_bench.rs`. Seed: 10,000 tasks; 3 direct prompts each; 5 roles each owning 2,000 tasks; each role has 2 role-prompts; each board has 1 board-prompt. Assert P99 `get_task_bundle` < 50 ms. Assert write batch (500-task board prompt attach) < 300 ms.

---

## Performance Budget

| Metric | Target | Measurement |
|---|---|---|
| `get_task_bundle` P50 | < 10 ms | criterion median on 10k-task seed DB |
| `get_task_bundle` P99 | < 50 ms | criterion p99 — CI gate, blocks merge |
| Materialise batch (500-task board) | < 300 ms | criterion one-shot, advisory only |
| Dematerialise batch (500-task board) | < 300 ms | criterion one-shot, advisory only |

**Bench protocol:** SQLite WAL mode, `busy_timeout = 5000`, in-memory DB seeded from a fixture generator (not a file snapshot, so it runs on any CI runner). Use `criterion::black_box` on the result to prevent optimisation elision. The P99 gate is enforced via `criterion`'s `--output-format bencher` piped to a threshold-check script; see P8-T2 in the roadmap for the CI integration spec.

---

## Risks

**R-1 — Backfill interruption leaves stale state.** If the backfill walker is killed mid-run, some tasks will have materialised rows and others will not. Read results will be inconsistent until the walker resumes. Mitigation: chunked transactions with a resumable cursor key in `settings` (see OQ-1); the startup check re-runs the walker if `resolver_backfill_done` is absent or `'partial'`.

**R-2 — Deduplication logic diverges between read and write paths.** The override rule (direct beats inherited) is implemented in Rust post-fetch. If a future engineer adds a second read path that reimplements deduplication in SQL, the two may diverge under edge cases (e.g., a task with both a direct and a space-inherited row for the same prompt). Mitigation: the deduplication rule is documented in a `/// # Override semantics` doc-comment on the `get_task_bundle` function; a unit test named `direct_wins_over_role_inherited` is added alongside AC-5.

**R-3 — Write-path blast radius on large-board attach.** Attaching a prompt to a board with 2,000 tasks is a 2,000-row INSERT batch. On slow hardware or a fragmented WAL file this could block the main thread for > 500 ms, freezing the UI. Mitigation: the materialise helpers are called from a `tokio::spawn_blocking` context (already the convention for all DB writes in the codebase); the frontend should show a spinner during attach operations on boards with > 100 tasks. The criterion bench for the 500-task case (criterion advisory gate) quantifies the realistic upper bound.

---

## Related

- `docs/audit/backend-parity-and-inheritance-audit.md` — F-01 (resolver gap), F-02 (space_prompts), F-03 (write-path missing)
- `docs/audit/skills-mcp-proxy-ideas-audit.md` — F-10 (skills/mcp_tools in bundle)
- `docs/catique-migration/cat-as-agent-roadmap.md` — P8-T2 (CI bench gate), P3-T1 (context assembly consumer)
- `docs/adr/ADR-0002-mcp-sidecar-architecture.md` — delivery layer above the resolver
- `crates/infrastructure/src/db/migrations/001_initial.sql:178-251` — schema + cleanup trigger
- `crates/infrastructure/src/db/repositories/tasks.rs:391-404` — `add_task_prompt` (current only write path)
