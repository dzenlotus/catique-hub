-- 010_backfill_default_boards.sql — retroactively guarantee every space
-- owns at least one `is_default = 1` board.
--
-- Migration `009_default_boards.sql` added the `boards.is_default` flag
-- and the application layer (`SpacesUseCase::create`) auto-provisions
-- one such board for every newly-created space. Pre-existing spaces —
-- whether seeded by Promptery v0.4 import (E2.5) or created before
-- migration 009 landed — were left without one. The use-case path that
-- depends on the invariant ("every space has a default board landing
-- pad") therefore has to special-case legacy rows.
--
-- This migration closes the gap by inserting one default board for
-- every space that currently has zero boards with `is_default = 1`.
-- The shape mirrors `SpacesUseCase::create` exactly:
--   * name             = 'Main'
--   * icon             = 'PixelInterfaceEssentialList'
--   * is_default       = 1
--   * position         = 0
--   * description      = NULL
--   * color            = NULL
--   * role_id          = NULL  (boards.role_id is nullable; the use-case
--                                also passes NULL)
--   * owner_role_id    = 'maintainer-system' (NOT NULL — same default
--                                the use-case picks; seeded by
--                                migration 004_cat_as_agent_phase1.sql)
--
-- Idempotency: the predicate `NOT EXISTS (... is_default = 1 ...)`
-- means a re-run after manual fix-ups (or a partial-fail) does not
-- duplicate rows. Migrations run inside the runner's `_migrations`
-- SHA gate (see `runner::apply_one`), so the body is normally executed
-- exactly once anyway — the predicate is belt-and-suspenders.
--
-- Id generation: SQLite has no native UUID. The codebase uses 21-char
-- nanoid via `repositories::util::new_id` for runtime inserts; for
-- pure-SQL migrations the standard idiom is
-- `lower(hex(randomblob(16)))` — 32-char hex, ample collision margin
-- against the existing nanoid space, and supported by every SQLite
-- build we ship. The column is `TEXT PRIMARY KEY` with no shape
-- constraint, so a hex string works as well as a nanoid.
--
-- Timestamps: existing migrations stamp epoch milliseconds via
-- `(CAST(strftime('%s','now') AS INTEGER) * 1000)` (see
-- `004_cat_as_agent_phase1.sql`); we follow the same convention.
INSERT INTO boards
  (id, name, space_id, role_id, position, description, color, icon,
   is_default, created_at, updated_at, owner_role_id)
SELECT
  lower(hex(randomblob(16))),
  'Main',
  s.id,
  NULL,
  0,
  NULL,
  NULL,
  'PixelInterfaceEssentialList',
  1,
  (CAST(strftime('%s','now') AS INTEGER) * 1000),
  (CAST(strftime('%s','now') AS INTEGER) * 1000),
  'maintainer-system'
FROM spaces s
WHERE NOT EXISTS (
  SELECT 1 FROM boards b
  WHERE b.space_id = s.id AND b.is_default = 1
);
