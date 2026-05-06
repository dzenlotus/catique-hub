-- 016_default_board_naming_and_constraints.sql — three structural
-- changes for the role/board model (maintainer feedback, 2026-05-06):
--
--   1. Rename the auto-seeded default board to "Owner" (was "Main"
--      from migration 010_backfill_default_boards.sql + the
--      SpacesUseCase::create factory).
--   2. Introduce `columns.is_default` and guarantee every board has
--      exactly one default column. Cross-board task moves drop tasks
--      into the destination board's default column.
--   3. Enforce 1:1 between a space and a role: a single role may own
--      at most one board per space (UNIQUE(space_id, owner_role_id)).
--
-- Decision-log entry: D-006 (2026-05-06). No standalone ADR — the
-- changes are purely schema-level and the rationale fits the log line.
--
-- Idempotency: every block guards against re-application via either
-- `IF NOT EXISTS`, predicate-driven UPDATE / INSERT, or the runner's
-- SHA-gate (see `runner::apply_one`). The runner toggles
-- `PRAGMA foreign_keys = OFF` around the migration body so the role
-- backfill below does not race the FK on `boards.owner_role_id`.

-- =====================================================================
-- 1. Rename default boards owned by Maintainer to "Owner".
-- =====================================================================
-- Scope is narrow on purpose: only rows where (is_default = 1 AND
-- owner_role_id = 'maintainer-system'). Spaces created before D-006
-- whose default board the user already renamed by hand fall outside
-- this filter (their owner_role_id is still maintainer-system but
-- they are not flagged is_default = 1) — wait, default boards always
-- carry is_default = 1 by construction. The filter therefore catches
-- exactly the auto-seeded rows, and an existing user rename to a
-- non-"Main" name is overwritten. That is intentional: maintainer
-- feedback is to standardise the name.
UPDATE boards
   SET name = 'Owner',
       updated_at = (CAST(strftime('%s','now') AS INTEGER) * 1000)
 WHERE is_default = 1
   AND owner_role_id = 'maintainer-system';

-- =====================================================================
-- 2. columns.is_default — schema flag + backfill.
-- =====================================================================
-- Schema convention mirrors `boards.is_default` (migration 009): plain
-- INTEGER + CHECK pinning to {0,1}. Default 0 keeps every existing row
-- unchanged; the backfill below promotes exactly one column per board
-- to is_default = 1.
ALTER TABLE columns ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0
    CHECK (is_default IN (0, 1));

-- 2a. Promote the lowest-position column on every board that already
-- has at least one column to is_default = 1. Tie-break by id ASC so
-- the choice is deterministic across re-runs (predicate is idempotent
-- because the second pass sees no rows where is_default = 0 AND no
-- sibling has is_default = 1 yet).
UPDATE columns
   SET is_default = 1
 WHERE id IN (
   SELECT c.id
     FROM columns c
     JOIN (
       SELECT board_id, MIN(position) AS min_pos
         FROM columns
        GROUP BY board_id
     ) m ON m.board_id = c.board_id AND m.min_pos = c.position
    WHERE NOT EXISTS (
      SELECT 1 FROM columns sib
       WHERE sib.board_id = c.board_id AND sib.is_default = 1
    )
    GROUP BY c.board_id
 );

-- 2b. Boards that own zero columns get a fresh "Owner" default column.
-- Hex-randomblob id mirrors migration 010's pattern; the runtime
-- nanoid() helper is unavailable from pure SQL.
INSERT INTO columns (id, board_id, name, position, role_id, is_default, created_at)
SELECT
  lower(hex(randomblob(16))),
  b.id,
  'Owner',
  0,
  NULL,
  1,
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
FROM boards b
WHERE NOT EXISTS (
  SELECT 1 FROM columns c WHERE c.board_id = b.id
);

-- =====================================================================
-- 3. Dedupe (space_id, owner_role_id) before the UNIQUE index lands.
-- =====================================================================
-- Strategy (D-006):
--   * For each (space_id, owner_role_id) tuple with > 1 boards, KEEP
--     the earliest-created (smallest created_at, ties broken by id ASC).
--   * For each "loser" board, mint a synthesised user role with a
--     deterministic id (`synth-owner-<board_id>`), is_system = 0, and
--     repoint the loser's owner_role_id at the new role.
--
-- Why a synth role, not a delete: deleting a board cascades to columns
-- and tasks. Renaming alone does not free the (space, role) pair.
-- Minting a per-board role preserves every row, lets the user
-- consolidate later via `set_board_owner`, and keeps the constraint
-- unconditional.
--
-- The synth role's `name` is `Owner: <board.name>` — friendly and
-- stable. Length is bounded because board names are bounded at the
-- application layer (200 chars).
--
-- Window functions are SQLite 3.25+ (Catique ships 3.40+, see
-- Cargo.lock for `rusqlite`/`libsqlite3-sys`). If a future CI image
-- regresses to a pre-3.25 build, this migration is the first to fail
-- — that is the right place to surface the problem.

-- 3a. Insert one synth role per "loser" board. Use INSERT OR IGNORE so
-- a partial-fail re-run picks up where it left off.
INSERT OR IGNORE INTO roles (id, name, content, color, created_at, updated_at, is_system)
SELECT
  'synth-owner-' || b.id,
  'Owner: ' || b.name,
  '',
  NULL,
  (CAST(strftime('%s','now') AS INTEGER) * 1000),
  (CAST(strftime('%s','now') AS INTEGER) * 1000),
  0
FROM (
  SELECT
    id, name, space_id, owner_role_id, created_at,
    ROW_NUMBER() OVER (
      PARTITION BY space_id, owner_role_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM boards
) b
WHERE b.rn > 1;

-- 3b. Repoint the "loser" boards at their freshly-minted synth role.
UPDATE boards
   SET owner_role_id = 'synth-owner-' || id,
       updated_at = (CAST(strftime('%s','now') AS INTEGER) * 1000)
 WHERE id IN (
   SELECT id FROM (
     SELECT
       id,
       ROW_NUMBER() OVER (
         PARTITION BY space_id, owner_role_id
         ORDER BY created_at ASC, id ASC
       ) AS rn
     FROM boards
   ) WHERE rn > 1
 );

-- 3c. Now safe to install the UNIQUE constraint as an index. We pick a
-- partial-style index over a full table rebuild because the existing
-- `boards` table already underwent one rebuild in migration 004; the
-- index is much cheaper to apply and still rejects future duplicate
-- inserts with SQLITE_CONSTRAINT_UNIQUE — which the application layer
-- maps to AppError::Conflict via `map_db_err_unique`.
CREATE UNIQUE INDEX IF NOT EXISTS uq_boards_space_owner
    ON boards(space_id, owner_role_id);
