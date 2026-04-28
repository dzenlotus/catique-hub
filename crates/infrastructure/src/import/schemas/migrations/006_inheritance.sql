-- 006_inheritance
-- Roles can now be attached at board and column level in addition to the
-- existing task level. Prompts can be attached directly at board and column
-- level. The resolver at src/db/resolvers/taskContext.ts computes the union
-- across all six origins (direct / role / column / column-role / board /
-- board-role) and deduplicates with a specificity ladder.

ALTER TABLE boards ADD COLUMN role_id TEXT REFERENCES roles(id) ON DELETE SET NULL;
ALTER TABLE columns ADD COLUMN role_id TEXT REFERENCES roles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS board_prompts (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_board_prompts_board ON board_prompts(board_id, position);

CREATE TABLE IF NOT EXISTS column_prompts (
  column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (column_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_column_prompts_column ON column_prompts(column_id, position);

CREATE INDEX IF NOT EXISTS idx_boards_role ON boards(role_id);
CREATE INDEX IF NOT EXISTS idx_columns_role ON columns(role_id);
