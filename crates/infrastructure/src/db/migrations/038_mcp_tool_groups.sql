-- ====================================================================
-- 038 — MCP tool groups + attach-as-live-unit (Phase B)
--
-- The MCP mirror of prompt groups (001 `prompt_groups` + 037 attach
-- tables). An `mcp_tool_group` bundles arbitrary `mcp_tools` ids; it can
-- be attached as a unit to a task / role / board / column / space, fanning
-- its CURRENT members into `task_mcp_tools` tagged with the same composite
-- origin grammar `"<scope>:<id>#group:<gid>"` (`"direct#group:<gid>"` for a
-- task). Membership changes re-materialise every attach site.
-- ====================================================================

-- ── group entity + members (mirror prompt_groups / prompt_group_members) ──
CREATE TABLE IF NOT EXISTS mcp_tool_groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_tool_group_members (
  group_id TEXT NOT NULL REFERENCES mcp_tool_groups(id) ON DELETE CASCADE,
  mcp_tool_id TEXT NOT NULL REFERENCES mcp_tools(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, mcp_tool_id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_groups_position ON mcp_tool_groups(position);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_group_members_group ON mcp_tool_group_members(group_id, position);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_group_members_tool ON mcp_tool_group_members(mcp_tool_id);

-- ── attach join tables (one per inheritance scope) ───────────────────
CREATE TABLE IF NOT EXISTS task_mcp_tool_groups (
  task_id  TEXT NOT NULL REFERENCES tasks(id)           ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES mcp_tool_groups(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, group_id)
);

CREATE TABLE IF NOT EXISTS role_mcp_tool_groups (
  role_id  TEXT NOT NULL REFERENCES roles(id)           ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES mcp_tool_groups(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, group_id)
);

CREATE TABLE IF NOT EXISTS board_mcp_tool_groups (
  board_id TEXT NOT NULL REFERENCES boards(id)          ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES mcp_tool_groups(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, group_id)
);

CREATE TABLE IF NOT EXISTS column_mcp_tool_groups (
  column_id TEXT NOT NULL REFERENCES columns(id)         ON DELETE CASCADE,
  group_id  TEXT NOT NULL REFERENCES mcp_tool_groups(id) ON DELETE CASCADE,
  position  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (column_id, group_id)
);

CREATE TABLE IF NOT EXISTS space_mcp_tool_groups (
  space_id TEXT NOT NULL REFERENCES spaces(id)          ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES mcp_tool_groups(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (space_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_task_mcp_tool_groups_task     ON task_mcp_tool_groups(task_id, position);
CREATE INDEX IF NOT EXISTS idx_role_mcp_tool_groups_role     ON role_mcp_tool_groups(role_id, position);
CREATE INDEX IF NOT EXISTS idx_board_mcp_tool_groups_board   ON board_mcp_tool_groups(board_id, position);
CREATE INDEX IF NOT EXISTS idx_column_mcp_tool_groups_column ON column_mcp_tool_groups(column_id, position);
CREATE INDEX IF NOT EXISTS idx_space_mcp_tool_groups_space   ON space_mcp_tool_groups(space_id, position);

CREATE INDEX IF NOT EXISTS idx_task_mcp_tool_groups_group   ON task_mcp_tool_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_role_mcp_tool_groups_group   ON role_mcp_tool_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_board_mcp_tool_groups_group  ON board_mcp_tool_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_column_mcp_tool_groups_group ON column_mcp_tool_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_space_mcp_tool_groups_group  ON space_mcp_tool_groups(group_id);

-- ── group-delete sweep (mirror 037's prompt-group sweep) ─────────────
-- Role/board/column/space-delete cleanup of task_mcp_tools group origins
-- is already handled: the 037 role trigger sweeps task_mcp_tools, and
-- board/column/space tasks are FK-cascaded. Only the group-delete sweep
-- needs an MCP variant — materialised `*#group:<gid>` rows in
-- task_mcp_tools are not FK-linked to the group. GLOB is nanoid-safe.
CREATE TRIGGER IF NOT EXISTS cleanup_mcp_tool_group_origin_on_group_delete
AFTER DELETE ON mcp_tool_groups
BEGIN
  DELETE FROM task_mcp_tools WHERE origin GLOB '*#group:' || OLD.id;
END;
