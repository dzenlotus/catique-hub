-- 034_content_versions.sql — refactor-v3 D-C.
--
-- Version history for the two long-form text fields the UI exposes a
-- history button on: `role.content` and `prompt.content`. Granularity
-- is debounced (one snapshot per 5-minute editing window) and
-- retention is capped (last 50 versions per source id). Full rationale
-- in `docs/refactor-v3/decisions/D-C-version-history-granularity.md`.
--
-- Shape (both tables identical save for the parent FK):
--   * `id`          — nanoid (21 chars, URL-safe). PRIMARY KEY.
--   * `<src>_id`    — FK on the parent row, ON DELETE CASCADE so the
--                     history disappears with the entity itself.
--   * `content`     — the PRE-update content of the parent at snapshot
--                     time. Reverting to a version copies this back
--                     into `<src>.content`.
--   * `created_at`  — epoch milliseconds; debounce window compares
--                     against this in the use-case layer.
--   * `author_note` — optional free-form note. Reserved for the
--                     "Reverted from <hash> at <time>" annotation the
--                     revert path writes; user-facing comments are out
--                     of scope per the decision memo's "Out of scope"
--                     section.
--
-- Indices: every read path is `WHERE <src>_id = ? ORDER BY
-- created_at DESC`, so a composite index covers list, prune and
-- "most-recent" debounce lookups without a separate stand-alone index
-- on the FK column.

CREATE TABLE IF NOT EXISTS role_content_versions (
  id          TEXT PRIMARY KEY,
  role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  author_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_role_content_versions_role_created
  ON role_content_versions(role_id, created_at DESC);

CREATE TABLE IF NOT EXISTS prompt_content_versions (
  id          TEXT PRIMARY KEY,
  prompt_id   TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  author_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_prompt_content_versions_prompt_created
  ON prompt_content_versions(prompt_id, created_at DESC);
