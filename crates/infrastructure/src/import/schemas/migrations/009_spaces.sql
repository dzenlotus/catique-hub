-- 009_spaces
-- Workspace organisation layer. Boards now live inside a `space` (an
-- explicit container with shared settings — for v0.3.0 the only shared
-- setting is `prefix`, used to mint per-space sequential slugs for tasks).
--
-- Slug semantics — IMPORTANT:
-- - On task creation, slug = '<space.prefix>-<space_counters.next_number>'
--   and the counter increments inside the same transaction.
-- - On board move between spaces, ALL tasks on that board are re-slugged
--   to the destination space's prefix; the destination counter advances
--   by the number of tasks moved. The internal `tasks.id` (CUID) is the
--   stable identifier; the slug is a friendly handle that may change.
--
-- This SQL file is the declarative reference. The actual migration logic
-- lives in `apply009Spaces` in migrations.ts: it conditionally rebuilds
-- `boards` and `tasks` to add `space_id NOT NULL` and replace `number`
-- with `slug NOT NULL UNIQUE`, then backfills slugs in created_at order.

CREATE TABLE IF NOT EXISTS spaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  prefix      TEXT NOT NULL UNIQUE,
  description TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0,
  position    REAL NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK (prefix GLOB '[a-z0-9-]*' AND length(prefix) BETWEEN 1 AND 10)
);

-- At most one row may carry `is_default = 1`. Combined with the bootstrap
-- INSERT in apply009Spaces ("exactly one"), the default space is unique
-- and can never be deleted (handled in app code).
CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_is_default
  ON spaces(is_default) WHERE is_default = 1;

CREATE INDEX IF NOT EXISTS idx_spaces_position ON spaces(position);

-- Per-space monotonic counter for slug generation. Incrementing the
-- counter and inserting the task happen inside the same transaction
-- so two concurrent inserts can never collide on a slug.
CREATE TABLE IF NOT EXISTS space_counters (
  space_id    TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 1
);
