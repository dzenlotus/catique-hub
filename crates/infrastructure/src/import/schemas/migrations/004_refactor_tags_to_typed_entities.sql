-- 004_refactor_tags_to_typed_entities
-- Replaces the single polymorphic `tags` table with four typed primitives
-- (prompts, skills, mcp_tools, roles) plus their relation tables.
-- The runtime counterpart in src/db/migrations.ts also migrates data from
-- the legacy `tags` / `task_tags` tables and drops them afterwards.

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  color TEXT DEFAULT '#888',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  color TEXT DEFAULT '#888',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  color TEXT DEFAULT '#888',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  color TEXT DEFAULT '#888',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS role_prompts (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, prompt_id)
);

CREATE TABLE IF NOT EXISTS role_skills (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, skill_id)
);

CREATE TABLE IF NOT EXISTS role_mcp_tools (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  mcp_tool_id TEXT NOT NULL REFERENCES mcp_tools(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, mcp_tool_id)
);

CREATE TABLE IF NOT EXISTS task_prompts (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  origin TEXT NOT NULL DEFAULT 'direct',
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, prompt_id)
);

CREATE TABLE IF NOT EXISTS task_skills (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  origin TEXT NOT NULL DEFAULT 'direct',
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, skill_id)
);

CREATE TABLE IF NOT EXISTS task_mcp_tools (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  mcp_tool_id TEXT NOT NULL REFERENCES mcp_tools(id) ON DELETE CASCADE,
  origin TEXT NOT NULL DEFAULT 'direct',
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, mcp_tool_id)
);

-- role_id and idx_tasks_role are added in migrations.ts after the ALTER so
-- legacy databases (no role_id yet) don't fail on the index here.
CREATE INDEX IF NOT EXISTS idx_role_prompts_role ON role_prompts(role_id);
CREATE INDEX IF NOT EXISTS idx_role_skills_role ON role_skills(role_id);
CREATE INDEX IF NOT EXISTS idx_role_mcp_tools_role ON role_mcp_tools(role_id);
CREATE INDEX IF NOT EXISTS idx_task_prompts_task ON task_prompts(task_id);
CREATE INDEX IF NOT EXISTS idx_task_prompts_origin ON task_prompts(task_id, origin);
CREATE INDEX IF NOT EXISTS idx_task_skills_task ON task_skills(task_id);
CREATE INDEX IF NOT EXISTS idx_task_skills_origin ON task_skills(task_id, origin);
CREATE INDEX IF NOT EXISTS idx_task_mcp_tools_task ON task_mcp_tools(task_id);
CREATE INDEX IF NOT EXISTS idx_task_mcp_tools_origin ON task_mcp_tools(task_id, origin);

CREATE TRIGGER IF NOT EXISTS cleanup_role_origin_on_role_delete
AFTER DELETE ON roles
BEGIN
  DELETE FROM task_prompts WHERE origin = 'role:' || OLD.id;
  DELETE FROM task_skills WHERE origin = 'role:' || OLD.id;
  DELETE FROM task_mcp_tools WHERE origin = 'role:' || OLD.id;
END;
