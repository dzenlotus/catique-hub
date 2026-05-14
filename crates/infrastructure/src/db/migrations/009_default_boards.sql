-- 009_default_boards.sql — flag boards as the auto-created "default"
-- board for their owning space.
--
-- Mirrors the existing `spaces.is_default` flag (migration
-- `001_initial.sql`). The application layer auto-creates exactly one
-- default board whenever a space is created (see
-- `SpacesUseCase::create`); the IPC `delete_board` refuses to remove a
-- default board so the kanban view always has somewhere to land — the
-- only way to drop it is to delete the owning space, which cascades.
--
-- SQLite has no native bool, so we follow the existing schema's
-- convention (`spaces.is_default`, `roles.is_system`): plain INTEGER
-- with a CHECK constraint pinning it to {0,1}. Default 0 keeps existing
-- rows intact — historic spaces stay without a default board, the user
-- explicitly opted out of a backfill.
--
-- The migration is purely additive — `ADD COLUMN` does not rewrite
-- existing rows, so SQLite handles it without a table rebuild.
ALTER TABLE boards ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0
    CHECK (is_default IN (0, 1));
