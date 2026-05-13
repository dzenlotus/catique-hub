-- 027_skill_steps.sql — SKILL-V2-A.
--
-- Graduate Skills from a flat markdown body into structured steps.
-- The existing `skills.description` (UI "content") stays as the
-- overview / TL;DR; `skill_steps` carries the ordered execution
-- sequence the agent walks during work.
--
-- Position semantics mirror columns/tasks (REAL so insert-between is
-- cheap; the use-case resequences on collision). `expected_outcome`
-- is nullable — many steps are simple actions whose "did it work"
-- check is obvious from context.
--
-- ON DELETE CASCADE keeps step rows tied to the parent skill; the
-- existing skill-deletion path (`SkillsUseCase::delete_with_blobs`)
-- already wipes attachments via the same mechanism — steps follow
-- the same lifecycle.

CREATE TABLE IF NOT EXISTS skill_steps (
  id                TEXT NOT NULL PRIMARY KEY,
  skill_id          TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  position          REAL NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL DEFAULT '',
  expected_outcome  TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_steps_skill_position
  ON skill_steps(skill_id, position);
