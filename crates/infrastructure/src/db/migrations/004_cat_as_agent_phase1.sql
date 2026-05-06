-- 004_cat_as_agent_phase1.sql — Phase 1 of Cat-as-Agent System (ctq-73).
--
-- Memo of record: docs/catique-migration/cat-as-agent-phase1-memo.md.
-- ADR-0005 (role-sync filename convention) governs Q2; this migration
-- aligns the data model with that convention by promoting the existing
-- `roles` table into the home of cat rows (Q3) and giving every board a
-- non-null owner reference (Q1, option (c) — auto-assign + later review).
--
-- Q1 (R1) — boards.owner_role_id NOT NULL with deterministic Maintainer.
--   SQLite cannot ADD COLUMN ... NOT NULL without a default that is
--   constant; "DEFAULT 'maintainer-system'" would fail under PRAGMA
--   foreign_keys=ON because the referenced row may not exist yet. We do
--   the standard table-rebuild dance (create-new + insert-from-old +
--   drop-old + rename) that 003 sidestepped because that migration only
--   added a nullable column. Pattern follows the precedent in 001's
--   layered ordering — every CREATE is IF NOT EXISTS, every seed insert
--   is INSERT OR IGNORE so re-runs after a partial-fail are safe.
--
-- Q3 (R6) — Dirizher coordinator + Maintainer migration target as
--   `is_system = 1` rows on the existing `roles` table. The
--   application layer enforces non-editability against `is_system` via a
--   guard in the use-case (deferred to its companion PR).
--
-- Q4 — task_ratings table with rating ∈ {-1, 0, 1} CHECK plus *nullable*
--   rating to distinguish unrated (NULL) from explicit-neutral (0).
--
-- Q5 — step_log on tasks for the per-task chain-of-thought line log.
--   Stored as a single TEXT column (one append-only buffer); ingestion
--   format is `[YYYY-MM-DDTHH:MM:SSZ] {summary}\n` — see
--   `repositories::tasks::append_step_log`.

-- ====================================================================
-- 1. roles.is_system + system rows (Dirizher + Maintainer).
-- ====================================================================
-- Idempotency: ALTER TABLE ADD COLUMN with NOT NULL DEFAULT 0 is safe to
-- re-run only if guarded — the migration runner's SHA gate already
-- guarantees we don't replay this body, so a plain ALTER is correct
-- here. (Re-running on a partially-applied DB would surface a
-- "duplicate column" rusqlite error.)
ALTER TABLE roles ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;

-- Maintainer (auto-assignment target for backfill below) and Dirizher
-- (Pattern B coordinator). Both deterministic ids per memo Q1/Q3.
-- 2026-05-06: maintainer renamed to "Owner" (matches the default
-- board name); dirizher renamed to "Дирижер" (Cyrillic, system).
-- Internal role ids (`maintainer-system`, `dirizher-system`) stay
-- for code-level references — only the display name changed.
INSERT OR IGNORE INTO roles (id, name, content, color, created_at, updated_at, is_system)
VALUES
  ('maintainer-system', 'Owner', '', NULL,
    (CAST(strftime('%s','now') AS INTEGER) * 1000),
    (CAST(strftime('%s','now') AS INTEGER) * 1000),
    1),
  ('dirizher-system',   'Дирижер',   '', NULL,
    (CAST(strftime('%s','now') AS INTEGER) * 1000),
    (CAST(strftime('%s','now') AS INTEGER) * 1000),
    1);

-- Belt-and-suspenders: if either id existed before this migration as a
-- user row (very unlikely — these strings collide with no plausible
-- nanoid), promote them to system rows. Idempotent re-application is
-- safe because the predicate matches the same row.
UPDATE roles SET is_system = 1
  WHERE id IN ('maintainer-system', 'dirizher-system');

-- ====================================================================
-- 2. boards.owner_role_id — add nullable, backfill, rebuild as NOT NULL.
-- ====================================================================
-- Step (a): add the column nullable so the existing rows survive.
ALTER TABLE boards ADD COLUMN owner_role_id TEXT REFERENCES roles(id);

-- Step (b): backfill every existing board to point at Maintainer.
UPDATE boards SET owner_role_id = 'maintainer-system'
  WHERE owner_role_id IS NULL;

-- Step (c): SQLite has no `ALTER TABLE ... ALTER COLUMN`. Rebuild the
-- table with the column declared NOT NULL, copy rows, swap. Keep all
-- prior columns + their defaults / FKs. The CASCADE / SET NULL clauses
-- on the original table (see 001_initial.sql, lines 65-73) are
-- preserved exactly. Indexes are recreated from 001's definitions.
--
-- The migration runner toggles `PRAGMA foreign_keys = OFF` around
-- every migration's transaction (see `runner::apply_one`), so the
-- DROP TABLE below does *not* trigger an implicit cascade-delete on
-- `columns` / `tasks`. Referential integrity is re-checked when the
-- runner re-enables FK enforcement after commit.
CREATE TABLE IF NOT EXISTS boards_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
  position REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  description TEXT,
  -- DEFAULT keeps existing INSERT statements that omit `owner_role_id`
  -- (mostly test fixtures and small repos seeding boards directly via
  -- SQL) safe — every default-inserted board still ends up referencing
  -- the seeded `maintainer-system` row, so no NULL ever leaks past the
  -- NOT NULL constraint. The application layer always supplies an
  -- explicit value via `BoardDraft::owner_role_id`.
  owner_role_id TEXT NOT NULL DEFAULT 'maintainer-system' REFERENCES roles(id)
);

INSERT INTO boards_new
  (id, name, space_id, role_id, position, created_at, updated_at, description, owner_role_id)
SELECT
  id, name, space_id, role_id, position, created_at, updated_at, description, owner_role_id
FROM boards;

DROP TABLE boards;
ALTER TABLE boards_new RENAME TO boards;

-- Recreate the indexes from 001_initial.sql so query plans don't
-- regress after the rebuild.
CREATE INDEX IF NOT EXISTS idx_boards_space ON boards(space_id);
CREATE INDEX IF NOT EXISTS idx_boards_space_position ON boards(space_id, position);

-- ====================================================================
-- 3. tasks.step_log — append-only timestamped buffer.
-- ====================================================================
ALTER TABLE tasks ADD COLUMN step_log TEXT NOT NULL DEFAULT '';

-- ====================================================================
-- 4. task_ratings — three-state with nullable distinction (Q4).
-- ====================================================================
-- The memo's R3 schema sketch (cat_id + composite PK) is for Phase 2
-- multi-cat ratings; Phase 1 lands the single-rating shape per the task
-- spec. Phase 2 will widen the PK to (task_id, cat_id) once Cat is a
-- separate domain entity (currently cats live in `roles`).
CREATE TABLE IF NOT EXISTS task_ratings (
  task_id  TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  rating   INTEGER CHECK (rating IS NULL OR rating IN (-1, 0, 1)),
  rated_at INTEGER NOT NULL  -- unix-ms
);

-- ====================================================================
-- 5. settings.cat_migration_reviewed — review-modal dismissal flag.
-- ====================================================================
-- The `settings` table exists in 001_initial.sql (KV shape: key TEXT PK,
-- value TEXT, updated_at INTEGER). Q1 / AC-M3 mandates this row exists
-- as `false` post-migration; the UI flips it to `true` once the user
-- dismisses the one-shot review modal.
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('cat_migration_reviewed', 'false',
  (CAST(strftime('%s','now') AS INTEGER) * 1000));
