-- 002_add_tag_kind
-- Adds `kind` column to tags with CHECK constraint limiting it to the four
-- supported categories. The migration runner detects pre-existing columns
-- (legacy installs that ran an earlier ALTER with DEFAULT 'tag') and
-- normalises invalid values to 'skill' instead of re-running ALTER.
ALTER TABLE tags ADD COLUMN kind TEXT NOT NULL DEFAULT 'skill'
  CHECK (kind IN ('role', 'skill', 'prompt', 'mcp'));

CREATE INDEX IF NOT EXISTS idx_tags_kind ON tags(kind);
