# Cat-as-Agent System — Phase 1 Pre-Implementation Memo

**Status:** Approved for Phase 1
**Date:** 2026-05-01
**Roadmap item:** ctq-73 (Cat-as-Agent System v1.0)
**Unblocks:** Phase 1 schema migration

---

## Q1: Migration strategy for existing boards / role assignment (R1)

**Problem.** Existing boards (Main, Roadmap, Discovery, Design, Bugs, Ideas) have no `cat_id` FK; migration must assign a Maintainer cat without touching the source Promptery DB before backup.

| Option | Fit | Cost | Ops burden | Safety | Extensibility |
|---|---|---|---|---|---|
| **(a) Auto-assign at migration time** — SQL UPDATE assigns Maintainer cat to every board in a single transaction | High | Low — one migration file | Low | Safe if VACUUM-INTO backup precedes migrate | Low — no per-board choice |
| **(b) Interactive first-launch modal** — migration leaves `cat_id = NULL`; app shows one-shot review modal at first launch | High | Medium — UI modal + deferred-state flag in `settings` | Medium — modal must fire exactly once | Safe | High — user can diverge per board |
| **(c) Hybrid: auto-assign + one-shot review modal** — migration auto-assigns Maintainer; first launch shows modal listing assignments with per-board override | High | Medium | Low — rollback is just a re-assign, not a schema change | Best — backup first, auto-assign second, review third | High |

**Choose (c) because** auto-assignment guarantees zero NULL `cat_id` rows post-migration (no deferred state, no conditional UI paths for "what if user dismissed the modal"), and the one-shot review modal (persisted by a `settings` key `cat_migration_reviewed = true`) gives the user an explicit audit moment without blocking the migration itself. The source DB is never touched: backup via `VACUUM INTO '$BACKUP_PATH'` runs in the migration preamble before any INSERT/UPDATE, satisfying the hard constraint.

**Acceptance criteria.**
- AC-M1: `VACUUM INTO` backup file exists at `$APPLOCALDATA/catique/catique.db.bak` before migration transaction commits.
- AC-M2: After migration, `SELECT COUNT(*) FROM boards WHERE cat_id IS NULL` = 0.
- AC-M3: `settings` table contains `cat_migration_reviewed = false` after migration; `true` after user dismisses the modal.
- AC-M4: Re-running migration on an already-migrated DB is a no-op (idempotent; runner's SHA gate covers this).

**Open sub-questions (deferrable to implementation).**
- OQ-M1: Should the review modal surface per-column and per-task overrides, or boards only? (boards-only is sufficient for Phase 1.)
- OQ-M2: What is the exact UX for "reassign" inside the modal — a dropdown of existing cats, or creation flow?

---

## Q2: Naming convention for cat MD files in client sync (R5)

**Problem.** Cat-as-Agent introduces a new entity `Cat` distinct from `Role`; filename conventions for synced agent files must be decided before the first sync is implemented.

ADR-0005 (Accepted, 2026-05-01) already locks this: `catique-{role_id}.md` / `catique-{role_id}.mdc`, where `role_id` is the **stable Catique UUID**, not a slug. The question for Cat-as-Agent is whether the `role_id` key (which Cats inherit or extend) remains correct when a cat has a display name like `Bruno-frontend-engineer`.

| Option | Fit | Cost | Ops burden | Rename safety | Extensibility |
|---|---|---|---|---|---|
| **(a) Filename = stable `cat_id` (same pattern as roles)** — `catique-{cat_id}.md` | Perfect — ADR-0005 already mandates stable-id filenames | Zero — no new convention | Lowest | Safe — renaming cat display name never renames the file | Best |
| **(b) Filename = slug of display name** — `catique-bruno-frontend-engineer.md` | Low — breaks ADR-0005 precedent; slug changes on rename, breaking re-sync link | Medium — rename-detection logic required | High — must reconcile old file with new filename on every rename | Unsafe | Poor |
| **(c) Filename = `role_id` of the role the cat extends** — reuse parent role's file | Low — two entities collide on one file; not representable | N/A | N/A | N/A | None |

**Choose (a) because** ADR-0005 already decided this implicitly: the stable id is the join key for re-sync; this memo restates that decision in the Cat-as-Agent context.

**Engineer note — rename safety.** `Cat.display_name` is a separate column in `cats` (or an extended `roles` row). Renaming a cat updates `display_name` and the rendered `role-name:` frontmatter field only; the filename (`catique-{cat_id}.md`) is immutable. This is byte-deterministic: same `cat_id` + same prompts = same filename always. No file-renaming logic is needed in `sync_roles_to_client`.

**Acceptance criteria.**
- AC-F1: `agent_filename(cat_id)` returns `catique-{cat_id}.md` for Claude Code regardless of `Cat.display_name` value.
- AC-F2: Renaming a cat's display name and triggering sync produces an updated frontmatter `role-name:` field but the same filesystem path.
- AC-F3: A cat file missing either the `catique-` prefix or the `managed-by: catique-hub` frontmatter appears in `RoleSyncReport.skipped`.

**Open sub-questions (deferrable).**
- OQ-F1: Do Cats get their own `ClientAdapter` method (`cat_filename`) or reuse the existing `agent_filename(role_id)` by passing `cat_id`? Both are valid; the convention is identical.

---

## Q3: Dirizher as system entity vs user-configurable (R6)

**Problem.** Pattern B Dirizher is a coordinator cat; its storage model must be decided before the `cats` table is designed.

| Option | Fit | Cost | Ops burden | Debug visibility | Extensibility |
|---|---|---|---|---|---|
| **(a) Hardcoded in app binary — invisible to user** | Medium | Low | Low | None — not queryable | Low — changes require code deploy |
| **(b) Special row in `roles` with `is_system = 1`, non-editable** | High | Low — one ALTER or migration | Low | High — visible in DB for debugging, replicates cleanly across spaces | High — can be queried, joined, referenced by FK |
| **(c) Editable by power user via settings flag** | Low — over-engineered for v1 | High | High | Medium | Medium |

**Choose (b) because** a `roles` row with `is_system = 1` survives DB migration cleanly (the migration inserts it once with a deterministic UUID), is reachable via FK from any `cat_assignments` join table, and is inspectable in DB clients when debugging coordination failures. The application layer enforces non-editability via a guard in `update_role`: `if role.is_system { return Err(AppError::Forbidden) }`.

Schema sketch:
```sql
ALTER TABLE roles ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
INSERT INTO roles (id, name, content, is_system, created_at, updated_at)
VALUES ('dirizher-system', 'Dirizher', '', 1, unixepoch()*1000, unixepoch()*1000)
ON CONFLICT(id) DO NOTHING;
```

**Acceptance criteria.**
- AC-D1: `SELECT is_system FROM roles WHERE id = 'dirizher-system'` = 1 after migration.
- AC-D2: `update_role('dirizher-system', ...)` returns `AppError::Forbidden`.
- AC-D3: `delete_role('dirizher-system')` returns `AppError::Forbidden`.
- AC-D4: Dirizher row appears in `list_roles` response (visible for debugging) but UI hides it when `is_system = 1`.

**Open sub-questions (deferrable).**
- OQ-D1: Should Dirizher be replicated per-space (one row per space) or be truly global? Phase 1 recommendation: global singleton; per-space variant is Phase 2.

---

## Q4: `task_ratings` shape (1-5 vs good/neutral/bad)

**Problem.** Tasks need a rating signal to feed two downstream uses: (1) memory weight for the cat's context window, (2) visible expertise indicator in the UI.

Framing via Pain x Leverage - Risk (product-prioritization prompt): a 5-star widget has high Pain to fill in (5 choices on every task for a solo user), medium Leverage (granularity rarely needed for memory weighting), high Risk of abandonment (users stop rating). A 3-state widget has low Pain, sufficient Leverage for binary positive/negative anchoring, low Risk.

| Option | Signal fidelity | UI cost | Completion rate (solo user) | Memory weighting | Expertise display |
|---|---|---|---|---|---|
| **(a) 1-5 stars** | High | Medium | Low — 5 choices induces friction | Good (normalise to [-1,+1]) | Good |
| **(b) good/neutral/bad (3-state)** | Sufficient | Low — 3 tap targets | High — minimal decision cost | Good (map: good=+1, neutral=0, bad=-1) | Good — colour-coded |
| **(c) thumbs up/down (2-state)** | Low — no neutral | Lowest | High | Sufficient but lossy | Poor — no neutral |
| **(d) signed int -1/0/+1** | Sufficient | N/A — storage detail | N/A | Best — no mapping step | N/A |

**Choose (b) stored as (d) because** the UI presents 3 states (good / neutral / bad) while the DB column is `INTEGER` with values `-1 / 0 / +1`, eliminating any mapping layer. The neutral state is load-bearing: it distinguishes "I evaluated this and it was unremarkable" from `NULL` which means "not yet rated." Memory weighting reads the integer directly.

Schema sketch:
```sql
-- In the new migration (004_cat_agent.sql):
CREATE TABLE task_ratings (
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  cat_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,  -- cats live in roles
  rating     INTEGER NOT NULL CHECK (rating IN (-1, 0, 1)),
  rated_at   INTEGER NOT NULL,
  PRIMARY KEY (task_id, cat_id)
);
```

**Acceptance criteria.**
- AC-R1: INSERT with `rating = 2` is rejected by the CHECK constraint.
- AC-R2: A task with no rating row returns `NULL` (not 0) from a LEFT JOIN — "unrated" is distinct from "neutral."
- AC-R3: `SELECT rating FROM task_ratings WHERE task_id = ? AND cat_id = ?` returns one of `{-1, 0, 1}` or no row.
- AC-R4: UI renders three discrete states (good / neutral / bad) and writes the corresponding integer.

**Open sub-questions (deferrable).**
- OQ-R1: Should `task_ratings` also carry a `notes TEXT` column for freeform cat commentary? Deferrable to Phase 2.
- OQ-R2: Memory weighting formula (how `-1/0/+1` scales task relevance score) is a Phase 2 algorithm question.

---

## Q5: Per-space memory schema

**Problem.** D9 defines memory scope as `(cat_id, space_id)`; the storage model must be chosen before the memory query path is implemented.

| Option | Fit | Cost | Query performance | Ops burden | Consistency |
|---|---|---|---|---|---|
| **(a) Derived view over `tasks` via FTS5** — no new table; memory = FTS5 query on `tasks` filtered by `(role_id = cat_id AND board.space_id = space_id)` | High — D4 explicitly states memory IS task search | Zero — FTS5 already exists (`tasks_fts`) | Sufficient — FTS5 P99 < 10 ms on 10k tasks (SQLite FTS5 benchmark: ~1 ms per 1k rows on commodity hardware, [SQLite docs §FTS5 performance](https://www.sqlite.org/fts5.html)) | None | Perfect — tasks table is single source of truth |
| **(b) Denormalised `task_memory` table** — materialised copy of task content indexed by `(cat_id, space_id)` | Low — contradicts D4; two sources of truth for the same data | High — new table + sync triggers | Slightly faster on large sets (indexed scan vs FTS) | High — triggers must stay in sync | Risk of drift |
| **(c) Hybrid: tasks own truth, materialised view rebuilt on cat/space change** | Medium | High — materialised view logic + invalidation | Best | High | Medium — invalidation logic is a correctness surface |

**Choose (a) because** D4 explicitly states that memory IS task search, and the FTS5 virtual table `tasks_fts` already exists in `001_initial.sql`. A separate `task_memory` table directly contradicts the no-premature-abstraction constraint. The existing index `idx_tasks_board_column` covers the board → space join path. Memory queries are additive FTS5 queries of the form:

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

Option (b) is acceptable as future work **only if** measured P99 search latency exceeds 100 ms on a real dataset of 10,000+ tasks.

**Acceptance criteria.**
- AC-S1: The query above returns results in < 100 ms on a test DB seeded with 10,000 tasks (measure with `EXPLAIN QUERY PLAN`; confirm FTS5 is used).
- AC-S2: No `task_memory` table exists in the Phase 1 migration.
- AC-S3: Inserting a task updates `tasks_fts` automatically via the existing `tasks_fts_insert` trigger (already present in `001_initial.sql`).
- AC-S4: `scope = (cat_id, space_id)` is enforced at the query layer (parameters), not a stored column.

**Open sub-questions (deferrable).**
- OQ-S1: Should `step_log` (D9) be a new column on `tasks` or reuse `description`? Deferrable; Phase 1 can use `description` as the memory body.
- OQ-S2: FTS5 tokenizer is `unicode61 remove_diacritics 1` — sufficient for mixed RU/EN content? Validate before Phase 2 memory relevance tuning.

---

## Phase 1 Acceptance Summary

The following criteria are drawn from ctq-73's "Acceptance criteria для Phase 1" block, annotated with the memo question that informs each:

1. **Backup precedes any schema mutation** — VACUUM INTO backup exists before migration transaction (Q1 / AC-M1).
2. **All existing boards have a non-NULL `cat_id` after migration** — auto-assign at migration time (Q1 / AC-M2).
3. **One-shot review modal fires on first launch and is suppressed thereafter** — `settings.cat_migration_reviewed` flag (Q1 / AC-M3).
4. **Cat agent files use stable `cat_id` as filename stem** — `catique-{cat_id}.md`; rename-safe (Q2 / AC-F1, AC-F2).
5. **Dirizher row exists in `roles` with `is_system = 1` and is not editable or deletable** — system-entity pattern (Q3 / AC-D1–AC-D4).
6. **`task_ratings` table accepts only `{-1, 0, 1}`; NULL distinguishes unrated from neutral** — 3-state stored as signed int (Q4 / AC-R1–AC-R4).
7. **Memory queries run over existing FTS5 with no new `task_memory` table** — derived view approach (Q5 / AC-S1–AC-S4).

---

## Open Questions Deferred to Phase 2+

- OQ-M1/M2: Review modal scope (per-column/task overrides) and reassign UX.
- OQ-F1: Whether `cat_filename` gets its own `ClientAdapter` method or reuses `agent_filename`.
- OQ-D1: Per-space Dirizher replication.
- OQ-R1: `task_ratings.notes` freeform column.
- OQ-R2: Memory weighting formula using rating integers.
- OQ-S1: `step_log` as a dedicated `tasks` column vs reusing `description`.
- OQ-S2: FTS5 tokenizer adequacy for mixed RU/EN memory bodies.

---

## Risks and Assumptions

| Risk | Severity | Mitigation |
|---|---|---|
| `VACUUM INTO` fails if disk has < 2x DB size free | Medium | Surface `AppError::DiskFull` before migration; abort with clear message. |
| `is_system` column added to `roles` breaks existing `Role` Rust struct (no such field) | Low | Add `is_system: bool` to `Role` domain struct; default `false` in repository row mapping. |
| FTS5 P99 degrades past 100 ms as task count grows beyond 10k | Low for Phase 1 | Threshold stated explicitly; engineer adds a P99 benchmark to the test suite (AC-S1). |
| One-shot review modal state lost if user deletes `settings` row | Low | Re-migration shows the modal again — acceptable; boards already have `cat_id` assigned. |
| ADR-0005 `catique-` prefix namespace collision with a third-party tool | Very low | Noted in ADR-0005 Consequences; recoverable via a future ADR prefix rename. |

**Assumptions.**
- `cats` are implemented as extended `roles` rows (same table, additional columns) for Phase 1. If `cats` become a separate table, Q2 filename derivation uses `cat.id` directly, with no change to the convention.
- The Promptery source DB is at `~/.promptery/db.sqlite`; the VACUUM INTO target is `$APPLOCALDATA/catique/catique.db.bak`.
- Phase 1 is single-user only; no concurrent writer safety required beyond WAL mode (already enabled via `journal_mode=WAL` PRAGMA in `pool.rs`).
