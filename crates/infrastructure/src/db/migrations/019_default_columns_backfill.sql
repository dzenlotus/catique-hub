-- 019_default_columns_backfill.sql — empty-board backfill + rename the
-- default column to a kanban-idiomatic "To Do".
--
-- Two changes, both idempotent:
--
--   1. Rename existing default columns named "Owner" to "To Do".
--      Migration 016 minted them with the placeholder name "Owner";
--      maintainer feedback (round-21, 2026-05-06) split the semantics —
--      the *board* reads as the owning role, the *column* is the
--      bucket of incoming work. Filter on `is_default = 1 AND
--      name = 'Owner'` so any column the user already renamed by hand
--      stays untouched.
--
--   2. Boards that own zero columns get a fresh "To Do" default
--      column. Migration 016 ran the same backfill once at the time
--      it landed; this re-application catches any board minted *after*
--      016 but *before* the use-case learned to plant the default
--      column itself (`BoardsUseCase::create`, round-21). New boards
--      get their default column synchronously from the use-case from
--      now on.
--
-- Re-running this migration on a healthy DB is a no-op: the WHERE
-- clauses short-circuit when there is nothing to do.

-- 1. Rename pre-existing default columns from "Owner" to "To Do".
UPDATE columns
   SET name = 'To Do'
 WHERE is_default = 1
   AND name = 'Owner';

-- 2. Plant a default column on any board that still owns zero columns.
INSERT INTO columns (id, board_id, name, position, role_id, is_default, created_at)
SELECT
  lower(hex(randomblob(16))),
  b.id,
  'To Do',
  0,
  NULL,
  1,
  (CAST(strftime('%s','now') AS INTEGER) * 1000)
FROM boards b
WHERE NOT EXISTS (
  SELECT 1 FROM columns c WHERE c.board_id = b.id
);
