-- ====================================================================
-- 037 — prompt groups as attachable "live units" (Phase A)
--
-- Lets a PromptGroup be attached as a unit to a task / role / board /
-- column / space, mirroring how individual prompts attach today
-- (ADR-0006 write-time materialisation). Attaching a group fans its
-- CURRENT members into `task_prompts` tagged with a COMPOSITE origin
-- `"<scope>:<id>#group:<gid>"` (or `"direct#group:<gid>"` for a group
-- attached straight to a task). Changing the group's membership later
-- re-materialises every attach site (the "live" link).
--
-- Only the attach join tables are added here; `prompt_groups` /
-- `prompt_group_members` already exist (001). The MCP-tool-group mirror
-- ships in a later migration (Phase B).
-- ====================================================================

-- ── prompt-group attach join tables (one per inheritance scope) ──────
-- position REAL mirrors role_prompts; the per-scope group order maps to
-- the base position bucket the members expand into.

CREATE TABLE IF NOT EXISTS task_prompt_groups (
  task_id  TEXT NOT NULL REFERENCES tasks(id)         ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES prompt_groups(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, group_id)
);

CREATE TABLE IF NOT EXISTS role_prompt_groups (
  role_id  TEXT NOT NULL REFERENCES roles(id)         ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES prompt_groups(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, group_id)
);

CREATE TABLE IF NOT EXISTS board_prompt_groups (
  board_id TEXT NOT NULL REFERENCES boards(id)        ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES prompt_groups(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, group_id)
);

CREATE TABLE IF NOT EXISTS column_prompt_groups (
  column_id TEXT NOT NULL REFERENCES columns(id)       ON DELETE CASCADE,
  group_id  TEXT NOT NULL REFERENCES prompt_groups(id) ON DELETE CASCADE,
  position  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (column_id, group_id)
);

CREATE TABLE IF NOT EXISTS space_prompt_groups (
  space_id TEXT NOT NULL REFERENCES spaces(id)        ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES prompt_groups(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (space_id, group_id)
);

-- (parent, position) — list a scope's attached groups in order.
CREATE INDEX IF NOT EXISTS idx_task_prompt_groups_task     ON task_prompt_groups(task_id, position);
CREATE INDEX IF NOT EXISTS idx_role_prompt_groups_role     ON role_prompt_groups(role_id, position);
CREATE INDEX IF NOT EXISTS idx_board_prompt_groups_board   ON board_prompt_groups(board_id, position);
CREATE INDEX IF NOT EXISTS idx_column_prompt_groups_column ON column_prompt_groups(column_id, position);
CREATE INDEX IF NOT EXISTS idx_space_prompt_groups_space   ON space_prompt_groups(space_id, position);

-- (group_id) — rematerialize_prompt_group enumerates every attach site
-- of a group when its membership changes.
CREATE INDEX IF NOT EXISTS idx_task_prompt_groups_group   ON task_prompt_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_role_prompt_groups_group   ON role_prompt_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_board_prompt_groups_group  ON board_prompt_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_column_prompt_groups_group ON column_prompt_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_space_prompt_groups_group  ON space_prompt_groups(group_id);

-- ── trigger rewrites for composite group origins ────────────────────
-- The 001 role-cleanup trigger matched `origin = 'role:'||OLD.id` exactly
-- and would leave group-sourced rows (`role:<id>#group:<gid>`) orphaned
-- when a role is deleted (tasks survive — tasks.role_id is ON DELETE SET
-- NULL). Rewrite it to also sweep the grouped suffix. GLOB (not LIKE):
-- nanoid ids contain `_`, a LIKE wildcard; GLOB treats `_` literally and
-- only `* ? [ ]` are special (none occur in nanoid alphabets).
-- board/column/space need no equivalent: their tasks are deleted by FK
-- cascade (tasks.board_id / column_id ON DELETE CASCADE), taking the
-- task_* rows with them.
DROP TRIGGER IF EXISTS cleanup_role_origin_on_role_delete;
CREATE TRIGGER cleanup_role_origin_on_role_delete
AFTER DELETE ON roles
BEGIN
  DELETE FROM task_prompts
    WHERE origin = 'role:' || OLD.id
       OR origin GLOB 'role:' || OLD.id || '#group:*';
  DELETE FROM task_skills
    WHERE origin = 'role:' || OLD.id
       OR origin GLOB 'role:' || OLD.id || '#group:*';
  DELETE FROM task_mcp_tools
    WHERE origin = 'role:' || OLD.id
       OR origin GLOB 'role:' || OLD.id || '#group:*';
END;

-- Deleting a prompt group cascades its attach rows (FK ON DELETE CASCADE)
-- and its members, but the materialised `*#group:<gid>` rows in
-- task_prompts are NOT FK-linked to the group — sweep them here so a
-- deleted group leaves no orphaned inherited prompts. The leading `*`
-- matches any scope prefix (`role:r#group:`, `board:b#group:`,
-- `direct#group:`); OLD.id is a literal tail (GLOB, nanoid-safe).
CREATE TRIGGER IF NOT EXISTS cleanup_prompt_group_origin_on_group_delete
AFTER DELETE ON prompt_groups
BEGIN
  DELETE FROM task_prompts WHERE origin GLOB '*#group:' || OLD.id;
END;
