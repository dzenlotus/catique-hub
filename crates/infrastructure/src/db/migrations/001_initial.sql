-- 001_initial.sql — Catique HUB initial schema.
--
-- Wave-E2.4 (Olga, 2026-04-28): collapsed Promptery v0.4 16-migration
-- evolution into a single bootstrap migration. Catique starts fresh; we
-- never need to replay Promptery's internal step ladder. See decision
-- log entry **D-028** for the trade-off (paired-update gate when
-- Promptery v0.4 schema changes — D-019 hash gate catches it).
--
-- Source of truth (byte-identical for the data tables):
--   docs/catique-migration/schemas/promptery-v0.4-schema.sql
--
-- Provenance: every block below cites the corresponding line range in
-- the source file. Schema changes inside Catique going forward go in
-- 002_*.sql, 003_*.sql, etc. — this file is frozen on the v0.4 contract.
--
-- Top-level layering (matches the source file's order, not the FK
-- topology — SQLite tolerates forward references in CREATE TABLE because
-- FK enforcement runs at INSERT time, not at table-definition time):
--   1.  spaces, space_counters
--   2.  boards   (forward FK → roles)
--   3.  columns  (forward FK → roles)
--   4.  prompts, skills, mcp_tools, roles
--   5.  tasks
--   6.  link tables (role_*, task_*, board_prompts, column_prompts)
--   7.  settings
--   8.  prompt_groups + members
--   9.  task_prompt_overrides, task_attachments
--  10.  tasks_fts (FTS5) + triggers
--  11.  task_events
--  12.  tags + prompt_tags
--  13.  agent_reports + agent_reports_fts (FTS5) + triggers
--  14.  cleanup_role_origin_on_role_delete trigger
--
-- D-019 ground-truth contract: this file's SHA-256 is the canonical
-- v0.4 hash. Promptery's schema changes → CI hash gate fires → paired
-- Catique migration must converge.

-- ====================================================================
-- 1. spaces (Promptery v0.4 schema, lines 1-15)
-- ====================================================================
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_is_default
  ON spaces(is_default) WHERE is_default = 1;
CREATE INDEX IF NOT EXISTS idx_spaces_position ON spaces(position);

CREATE TABLE IF NOT EXISTS space_counters (
  space_id    TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 1
);

-- ====================================================================
-- 2. boards (Promptery v0.4 schema, lines 22-33)
-- ====================================================================
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
  position REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_boards_space ON boards(space_id);
CREATE INDEX IF NOT EXISTS idx_boards_space_position ON boards(space_id, position);

-- ====================================================================
-- 3. columns (Promptery v0.4 schema, lines 35-42)
-- ====================================================================
CREATE TABLE IF NOT EXISTS columns (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

-- ====================================================================
-- 4. prompts, skills, mcp_tools, roles (Promptery v0.4 lines 44-84)
-- ====================================================================
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  color TEXT DEFAULT '#888',
  short_description TEXT,
  -- Cached cl100k_base token count for `content`. Re-computed on every
  -- create/update inside the same transaction (see Promptery
  -- queries/prompts.ts) and backfilled by Promptery migration 014 on
  -- existing rows. NULL only on legacy DBs between schema-first init
  -- and migration apply — Catique always sets it on insert.
  token_count INTEGER,
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

-- ====================================================================
-- 5. tasks (Promptery v0.4 schema, lines 86-99)
-- ====================================================================
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  position REAL NOT NULL,
  role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_slug ON tasks(slug);

-- ====================================================================
-- 6. link tables (Promptery v0.4 schema, lines 101-144)
-- ====================================================================
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

-- ====================================================================
-- 7. settings (Promptery v0.4 schema, lines 146-150)
-- ====================================================================
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ====================================================================
-- 8. board_prompts + column_prompts (Promptery v0.4 lines 152-184)
-- ====================================================================
CREATE TABLE IF NOT EXISTS board_prompts (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, prompt_id)
);

CREATE TABLE IF NOT EXISTS column_prompts (
  column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (column_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_board_prompts_board ON board_prompts(board_id, position);
CREATE INDEX IF NOT EXISTS idx_column_prompts_column ON column_prompts(column_id, position);
CREATE INDEX IF NOT EXISTS idx_tasks_board_column ON tasks(board_id, column_id, position);
CREATE INDEX IF NOT EXISTS idx_role_prompts_role ON role_prompts(role_id);
CREATE INDEX IF NOT EXISTS idx_role_skills_role ON role_skills(role_id);
CREATE INDEX IF NOT EXISTS idx_role_mcp_tools_role ON role_mcp_tools(role_id);
CREATE INDEX IF NOT EXISTS idx_task_prompts_task ON task_prompts(task_id);
CREATE INDEX IF NOT EXISTS idx_task_prompts_origin ON task_prompts(task_id, origin);
CREATE INDEX IF NOT EXISTS idx_task_skills_task ON task_skills(task_id);
CREATE INDEX IF NOT EXISTS idx_task_skills_origin ON task_skills(task_id, origin);
CREATE INDEX IF NOT EXISTS idx_task_mcp_tools_task ON task_mcp_tools(task_id);
CREATE INDEX IF NOT EXISTS idx_task_mcp_tools_origin ON task_mcp_tools(task_id, origin);

-- Promptery v0.4 schema, lines 189-195. Defensive net for direct SQL
-- DELETE on roles: strips any task_* rows that were inherited from the
-- role. The TS deleteRole() does the same thing before removing the row,
-- so this trigger is belt-and-suspenders.
CREATE TRIGGER IF NOT EXISTS cleanup_role_origin_on_role_delete
AFTER DELETE ON roles
BEGIN
  DELETE FROM task_prompts WHERE origin = 'role:' || OLD.id;
  DELETE FROM task_skills WHERE origin = 'role:' || OLD.id;
  DELETE FROM task_mcp_tools WHERE origin = 'role:' || OLD.id;
END;

-- ====================================================================
-- 9. prompt_groups + members (Promptery v0.4 lines 200-219)
-- ====================================================================
CREATE TABLE IF NOT EXISTS prompt_groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_group_members (
  group_id TEXT NOT NULL REFERENCES prompt_groups(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_groups_position ON prompt_groups(position);
CREATE INDEX IF NOT EXISTS idx_prompt_group_members_group ON prompt_group_members(group_id, position);
CREATE INDEX IF NOT EXISTS idx_prompt_group_members_prompt ON prompt_group_members(prompt_id);

-- ====================================================================
-- 10. task_prompt_overrides + task_attachments (v0.4 lines 225-250)
-- ====================================================================
CREATE TABLE IF NOT EXISTS task_prompt_overrides (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_task_prompt_overrides_task ON task_prompt_overrides(task_id);

CREATE TABLE IF NOT EXISTS task_attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  uploaded_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);

-- ====================================================================
-- 11. tasks_fts (FTS5) + triggers (Promptery v0.4 lines 255-278)
-- ====================================================================
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
  task_id UNINDEXED,
  title,
  description,
  tokenize='unicode61 remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS tasks_fts_insert
AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(task_id, title, description)
  VALUES (new.id, new.title, new.description);
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_update
AFTER UPDATE OF title, description ON tasks BEGIN
  UPDATE tasks_fts
  SET title = new.title, description = new.description
  WHERE task_id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_delete
AFTER DELETE ON tasks BEGIN
  DELETE FROM tasks_fts WHERE task_id = old.id;
END;

-- ====================================================================
-- 12. task_events (Promptery v0.4 lines 283-293)
-- ====================================================================
CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor TEXT,
  details_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_created
  ON task_events(task_id, created_at DESC);

-- ====================================================================
-- 13. tags + prompt_tags (Promptery v0.4 lines 298-315)
-- ====================================================================
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_tags (
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (prompt_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_tags_tag ON prompt_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_prompt_tags_prompt ON prompt_tags(prompt_id);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

-- ====================================================================
-- 14. agent_reports + agent_reports_fts (v0.4 lines 322-359)
-- ====================================================================
CREATE TABLE IF NOT EXISTS agent_reports (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_reports_task ON agent_reports(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_reports_kind ON agent_reports(kind);

CREATE VIRTUAL TABLE IF NOT EXISTS agent_reports_fts USING fts5(
  report_id UNINDEXED,
  title,
  content,
  tokenize='unicode61 remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS agent_reports_fts_insert
AFTER INSERT ON agent_reports BEGIN
  INSERT INTO agent_reports_fts(report_id, title, content)
  VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS agent_reports_fts_update
AFTER UPDATE OF title, content ON agent_reports BEGIN
  UPDATE agent_reports_fts
  SET title = new.title, content = new.content
  WHERE report_id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS agent_reports_fts_delete
AFTER DELETE ON agent_reports BEGIN
  DELETE FROM agent_reports_fts WHERE report_id = old.id;
END;
