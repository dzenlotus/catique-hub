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

CREATE TABLE IF NOT EXISTS columns (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  color TEXT DEFAULT '#888',
  short_description TEXT,
  -- Cached cl100k_base token count for `content`. Re-computed on every
  -- create/update inside the same transaction (see queries/prompts.ts) and
  -- backfilled by migration 014 on existing rows. NULL only on legacy DBs
  -- between schema-first init and migration apply.
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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Board-level and column-level prompt attachments. Resolver unions these
-- with task-level direct prompts and with role prompts from each layer.
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
-- idx_boards_role and idx_columns_role reference role_id columns added by
-- migration 006; on existing DBs schema.sql runs before migrations, so
-- those indexes are created inside apply006Inheritance instead.

CREATE INDEX IF NOT EXISTS idx_tasks_board_column ON tasks(board_id, column_id, position);
-- idx_tasks_role is created in migrations.ts after the role_id ALTER on legacy DBs
CREATE INDEX IF NOT EXISTS idx_role_prompts_role ON role_prompts(role_id);
CREATE INDEX IF NOT EXISTS idx_role_skills_role ON role_skills(role_id);
CREATE INDEX IF NOT EXISTS idx_role_mcp_tools_role ON role_mcp_tools(role_id);
CREATE INDEX IF NOT EXISTS idx_task_prompts_task ON task_prompts(task_id);
CREATE INDEX IF NOT EXISTS idx_task_prompts_origin ON task_prompts(task_id, origin);
CREATE INDEX IF NOT EXISTS idx_task_skills_task ON task_skills(task_id);
CREATE INDEX IF NOT EXISTS idx_task_skills_origin ON task_skills(task_id, origin);
CREATE INDEX IF NOT EXISTS idx_task_mcp_tools_task ON task_mcp_tools(task_id);
CREATE INDEX IF NOT EXISTS idx_task_mcp_tools_origin ON task_mcp_tools(task_id, origin);

-- Defensive net for direct SQL DELETE on roles: strips any task_* rows that
-- were inherited from the role. deleteRole() in TS does the same thing
-- before removing the row, so this trigger is belt-and-suspenders.
CREATE TRIGGER IF NOT EXISTS cleanup_role_origin_on_role_delete
AFTER DELETE ON roles
BEGIN
  DELETE FROM task_prompts WHERE origin = 'role:' || OLD.id;
  DELETE FROM task_skills WHERE origin = 'role:' || OLD.id;
  DELETE FROM task_mcp_tools WHERE origin = 'role:' || OLD.id;
END;

-- Prompt groups — many-to-many organisational layer for prompts.
-- Deleting a group cascades to prompt_group_members but not prompts;
-- deleting a prompt cascades to prompt_group_members automatically.
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

-- Per-task overrides on inherited prompts. enabled=0 suppresses the prompt for
-- this one task only; enabled=1 is reserved for future force-enable semantics.
-- Stale rows (prompt no longer inherited) are silently ignored by the
-- resolver — no auto-cleanup, see migration 015 for the rationale.
CREATE TABLE IF NOT EXISTS task_prompt_overrides (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_task_prompt_overrides_task ON task_prompt_overrides(task_id);

-- Per-task file attachments (images + arbitrary files). Metadata only —
-- the binary blob lives under ~/.promptery/attachments/<task_id>/<storage_path>.
-- The application layer removes the on-disk directory after deleting the task;
-- the FK CASCADE strips metadata rows automatically.
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

-- Full-text search index for tasks. Triggers keep tasks_fts synced with the
-- `tasks` table on insert/update/delete; on existing DBs migration 008 runs
-- the same statements (idempotently) and backfills pre-existing rows.
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

-- Task activity log: append-only timeline of mutations per task. Each row
-- captures the mutation type, optional actor (e.g. bridge agent_hint), and
-- a JSON blob with type-specific details. Cascades with the task.
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

-- Tags — flat, globally-unique label layer for prompts. Many-to-many: a
-- prompt has zero or more tags, a tag applies to zero or more prompts.
-- Tags don't participate in inheritance and only attach to prompts.
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

-- Typed, persistent, searchable artefacts attached to a task. Reports are
-- the canonical place for an agent to save investigation results / analyses
-- / plans / summaries / reviews / memos — they keep that material out of
-- task.description so the task stays compact, and they're searchable across
-- the whole workspace via the FTS sibling table below.
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
