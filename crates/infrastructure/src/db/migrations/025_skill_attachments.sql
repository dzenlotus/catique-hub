-- SKILL-S10: per-skill on-disk + git attachments.
--
-- Two-kind discriminator (`kind IN ('file','git')`) keeps both shapes
-- in one table so the renderer can iterate over a single ordered list.
-- The CHECK clause enforces the mutually-exclusive column populations:
--
--   * kind='file' → filename + storage_path NOT NULL; git columns NULL.
--   * kind='git'  → git_url NOT NULL; filename + storage_path NULL.
--
-- Blobs live at `<app_data_dir>/skills/<skill_id>/<storage_path>`,
-- mirroring `task_attachments` (001_initial.sql lines 290-301).
-- ON DELETE CASCADE wipes rows when the parent skill is removed; the
-- on-disk blobs are cleaned up by `SkillsUseCase::delete`.

CREATE TABLE IF NOT EXISTS skill_attachments (
  id            TEXT NOT NULL PRIMARY KEY,
  skill_id      TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK(kind IN ('file','git')),
  filename      TEXT,
  mime_type     TEXT,
  size_bytes    INTEGER,
  storage_path  TEXT,
  git_url       TEXT,
  git_ref       TEXT,
  git_path      TEXT,
  created_at    INTEGER NOT NULL,
  CHECK (
    (kind = 'file' AND filename IS NOT NULL AND storage_path IS NOT NULL
       AND git_url IS NULL AND git_ref IS NULL AND git_path IS NULL)
    OR
    (kind = 'git' AND git_url IS NOT NULL
       AND filename IS NULL AND storage_path IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_skill_attachments_skill
  ON skill_attachments(skill_id);
