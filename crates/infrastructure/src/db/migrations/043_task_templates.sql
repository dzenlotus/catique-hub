-- 043_task_templates.sql — task templates (catique-1).
--
-- A template is a named, kinded markdown skeleton the user picks when
-- creating a task. Selecting one pre-fills the new task's description
-- with the template `body` so each task type (feature / bug / research)
-- starts from its own structured set of "fields" (rendered as markdown
-- sections — Goal, Definition of Done, Steps to reproduce, …).
--
-- Model notes:
--   * `kind` is a small fixed vocabulary; `custom` is the escape hatch
--     for user-authored templates. The CHECK keeps a bad value out.
--   * `body` is the markdown skeleton inserted into the task. `description`
--     is the short helper shown next to the template in the picker.
--   * Templates are global (not space-scoped) — the product ask is "let
--     me choose a template", with no per-project requirement. A future
--     migration can add `space_id` if scoping is ever needed.
--   * Three built-ins are seeded so the feature is useful out of the box;
--     they carry stable ids (`tmpl-feature` / `tmpl-bug` / `tmpl-research`)
--     and are ordinary rows the user can edit or delete.

CREATE TABLE IF NOT EXISTS task_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'custom'
                CHECK (kind IN ('feature','bug','research','custom')),
  description TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  icon        TEXT,
  color       TEXT,
  position    REAL NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Seed the three built-in templates. `INSERT OR IGNORE` keeps the
-- migration idempotent across the rare re-apply (the runner already
-- guards against re-running, but a manual restore could replay it).
INSERT OR IGNORE INTO task_templates
  (id, name, kind, description, body, position, created_at, updated_at)
VALUES
  (
    'tmpl-feature',
    'Feature',
    'feature',
    'A new capability — what it is, its goal, Definition of Done, and examples.',
    '## Feature' || char(10) ||
    'What are we building?' || char(10) || char(10) ||
    '## Goal' || char(10) ||
    'Why — the outcome we want.' || char(10) || char(10) ||
    '## Definition of Done' || char(10) ||
    '- [ ] ' || char(10) || char(10) ||
    '## Examples' || char(10) ||
    'Links, references, mockups.' || char(10),
    0,
    CAST(strftime('%s','now') AS INTEGER) * 1000,
    CAST(strftime('%s','now') AS INTEGER) * 1000
  ),
  (
    'tmpl-bug',
    'Bug',
    'bug',
    'A defect — steps to reproduce, expected vs actual, and screenshots.',
    '## Summary' || char(10) ||
    'What is broken?' || char(10) || char(10) ||
    '## Steps to reproduce' || char(10) ||
    '1. ' || char(10) ||
    '2. ' || char(10) || char(10) ||
    '## Expected vs actual' || char(10) ||
    '- Expected: ' || char(10) ||
    '- Actual: ' || char(10) || char(10) ||
    '## Visual / screenshots' || char(10) ||
    'Attach screenshots to this task.' || char(10),
    1,
    CAST(strftime('%s','now') AS INTEGER) * 1000,
    CAST(strftime('%s','now') AS INTEGER) * 1000
  ),
  (
    'tmpl-research',
    'Research',
    'research',
    'An investigation — what to analyze and which questions to answer.',
    '## Topic' || char(10) ||
    'What do we need to analyze?' || char(10) || char(10) ||
    '## Questions to answer' || char(10) ||
    '- ' || char(10) || char(10) ||
    '## Findings' || char(10) ||
    'Fill in during the work.' || char(10),
    2,
    CAST(strftime('%s','now') AS INTEGER) * 1000,
    CAST(strftime('%s','now') AS INTEGER) * 1000
  );
