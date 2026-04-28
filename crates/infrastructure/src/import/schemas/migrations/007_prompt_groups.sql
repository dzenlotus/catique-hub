-- 007_prompt_groups
-- Groups are a many-to-many organisational layer for prompts. A prompt can
-- belong to zero or more groups; the prompt itself is never duplicated and
-- editing its content in one place applies everywhere. Deleting a group
-- removes the memberships (ON DELETE CASCADE on group_id) but leaves the
-- prompts themselves; deleting a prompt removes it from every group it
-- was a member of (ON DELETE CASCADE on prompt_id).

CREATE TABLE IF NOT EXISTS prompt_groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_groups_position ON prompt_groups(position);

CREATE TABLE IF NOT EXISTS prompt_group_members (
  group_id TEXT NOT NULL REFERENCES prompt_groups(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_group_members_group ON prompt_group_members(group_id, position);
CREATE INDEX IF NOT EXISTS idx_prompt_group_members_prompt ON prompt_group_members(prompt_id);
