-- 014_board_column_space_skills.sql — extend skills + mcp_tools join
-- coverage to boards, columns, spaces (ctq-120).
--
-- Phase 1 cat-as-agent inheritance for skills + MCP tools currently stops
-- at role/task. This migration adds six pure join tables so the resolver
-- can later cascade onto the board/column/space scopes (mirrors how
-- prompts already inherit through `board_prompts` / `column_prompts` /
-- the `space_prompts` table from migration 011).
--
-- All six tables are idempotent (`CREATE TABLE IF NOT EXISTS`) and
-- cascade on the parent delete via `ON DELETE CASCADE`. Composite PRIMARY
-- KEY makes the pair `(parent_id, leaf_id)` unique without an extra
-- UNIQUE INDEX. `position REAL DEFAULT 0` lets the application layer
-- preserve drag-reorder order — same shape as `role_skills`.
--
-- The migration body is a sequence of `CREATE TABLE IF NOT EXISTS` +
-- supporting indexes; replaying the migration is a no-op (the runner
-- already gates on SHA, this is belt-and-suspenders for environments
-- that bypass `_migrations`).

-- ====================================================================
-- board ↔ skills / mcp_tools
-- ====================================================================
CREATE TABLE IF NOT EXISTS board_skills (
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  skill_id   TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  position   REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_board_skills_board ON board_skills(board_id, position);

CREATE TABLE IF NOT EXISTS board_mcp_tools (
  board_id     TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  mcp_tool_id  TEXT NOT NULL REFERENCES mcp_tools(id) ON DELETE CASCADE,
  position     REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, mcp_tool_id)
);

CREATE INDEX IF NOT EXISTS idx_board_mcp_tools_board ON board_mcp_tools(board_id, position);

-- ====================================================================
-- column ↔ skills / mcp_tools
-- ====================================================================
CREATE TABLE IF NOT EXISTS column_skills (
  column_id  TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  skill_id   TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  position   REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (column_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_column_skills_column ON column_skills(column_id, position);

CREATE TABLE IF NOT EXISTS column_mcp_tools (
  column_id    TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  mcp_tool_id  TEXT NOT NULL REFERENCES mcp_tools(id) ON DELETE CASCADE,
  position     REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (column_id, mcp_tool_id)
);

CREATE INDEX IF NOT EXISTS idx_column_mcp_tools_column ON column_mcp_tools(column_id, position);

-- ====================================================================
-- space ↔ skills / mcp_tools
-- ====================================================================
CREATE TABLE IF NOT EXISTS space_skills (
  space_id   TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  skill_id   TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  position   REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (space_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_space_skills_space ON space_skills(space_id, position);

CREATE TABLE IF NOT EXISTS space_mcp_tools (
  space_id     TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  mcp_tool_id  TEXT NOT NULL REFERENCES mcp_tools(id) ON DELETE CASCADE,
  position     REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (space_id, mcp_tool_id)
);

CREATE INDEX IF NOT EXISTS idx_space_mcp_tools_space ON space_mcp_tools(space_id, position);
