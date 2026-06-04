-- ====================================================================
-- 039 — attach a whole MCP server as a live unit (Phase C)
--
-- Selecting an MCP server (e.g. "Context7") in a tool picker materialises
-- ALL its tools into `task_mcp_tools` with origin `<scope>:<id>#server:<sid>`
-- (`direct#server:<sid>` for a task). Membership is DYNAMIC — "every
-- non-soft-deleted tool whose server_id = <sid>" — so re-introspection
-- (reconcile_tools) re-materialises and new/removed upstream tools sync
-- automatically. Mirrors the group attach tables (037/038) but the
-- "members" come from `mcp_tools.server_id`, not a join table.
-- ====================================================================

CREATE TABLE IF NOT EXISTS task_mcp_servers (
  task_id   TEXT NOT NULL REFERENCES tasks(id)       ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  position  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, server_id)
);

CREATE TABLE IF NOT EXISTS role_mcp_servers (
  role_id   TEXT NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  position  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, server_id)
);

CREATE TABLE IF NOT EXISTS board_mcp_servers (
  board_id  TEXT NOT NULL REFERENCES boards(id)      ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  position  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, server_id)
);

CREATE TABLE IF NOT EXISTS column_mcp_servers (
  column_id TEXT NOT NULL REFERENCES columns(id)     ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  position  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (column_id, server_id)
);

CREATE TABLE IF NOT EXISTS space_mcp_servers (
  space_id  TEXT NOT NULL REFERENCES spaces(id)      ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  position  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (space_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_task_mcp_servers_task     ON task_mcp_servers(task_id, position);
CREATE INDEX IF NOT EXISTS idx_role_mcp_servers_role     ON role_mcp_servers(role_id, position);
CREATE INDEX IF NOT EXISTS idx_board_mcp_servers_board   ON board_mcp_servers(board_id, position);
CREATE INDEX IF NOT EXISTS idx_column_mcp_servers_column ON column_mcp_servers(column_id, position);
CREATE INDEX IF NOT EXISTS idx_space_mcp_servers_space   ON space_mcp_servers(space_id, position);

CREATE INDEX IF NOT EXISTS idx_task_mcp_servers_server   ON task_mcp_servers(server_id);
CREATE INDEX IF NOT EXISTS idx_role_mcp_servers_server   ON role_mcp_servers(server_id);
CREATE INDEX IF NOT EXISTS idx_board_mcp_servers_server  ON board_mcp_servers(server_id);
CREATE INDEX IF NOT EXISTS idx_column_mcp_servers_server ON column_mcp_servers(server_id);
CREATE INDEX IF NOT EXISTS idx_space_mcp_servers_server  ON space_mcp_servers(server_id);

-- Widen the role-delete cleanup trigger to sweep ANY composite origin
-- (`role:<id>#group:*` AND `role:<id>#server:*`) — `#*` covers both. A
-- role's tasks survive role deletion (tasks.role_id ON DELETE SET NULL),
-- so inherited rows must be swept explicitly. GLOB is nanoid-safe.
-- No mcp-server-delete trigger needed: deleting a server cascades its
-- mcp_tools (023 FK), which cascades the task_mcp_tools rows.
DROP TRIGGER IF EXISTS cleanup_role_origin_on_role_delete;
CREATE TRIGGER cleanup_role_origin_on_role_delete
AFTER DELETE ON roles
BEGIN
  DELETE FROM task_prompts
    WHERE origin = 'role:' || OLD.id OR origin GLOB 'role:' || OLD.id || '#*';
  DELETE FROM task_skills
    WHERE origin = 'role:' || OLD.id OR origin GLOB 'role:' || OLD.id || '#*';
  DELETE FROM task_mcp_tools
    WHERE origin = 'role:' || OLD.id OR origin GLOB 'role:' || OLD.id || '#*';
END;
