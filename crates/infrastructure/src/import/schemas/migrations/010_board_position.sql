-- 010_board_position
-- Boards previously sorted by created_at; the sidebar now allows drag-and-drop
-- reordering both within a space and across spaces, so the order needs to be
-- explicit and persisted.
--
-- The actual JS apply step backfills `position` in created_at order so the
-- existing sort is preserved on first run.

ALTER TABLE boards ADD COLUMN position REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_boards_space_position
  ON boards(space_id, position);
