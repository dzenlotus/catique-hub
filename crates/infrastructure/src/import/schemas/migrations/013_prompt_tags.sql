-- 013_prompt_tags
-- Tags are a flat, globally-unique label space for prompts. A prompt can
-- carry zero or more tags; a tag can apply to zero or more prompts. Tags do
-- NOT participate in inheritance and only attach to prompts (not roles,
-- skills, mcp_tools, tasks, boards) — that scope keeps the join tables
-- small and the resolver untouched.
--
-- Cascade rules:
--   * Deleting a tag drops every prompt_tags row that references it.
--   * Deleting a prompt drops every prompt_tags row that references it.
-- The prompts and tags tables are otherwise independent — tag deletion
-- never removes a prompt, and prompt deletion never removes a tag.

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
