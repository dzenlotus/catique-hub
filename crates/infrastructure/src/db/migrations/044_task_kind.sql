-- 044_task_kind.sql — task classification (catique).
--
-- Adds a `kind` discriminator to every task: blank / feature / bug /
-- research. `blank` is the default for existing rows and for cards the
-- user does not explicitly type. The CHECK keeps the column and the
-- `TaskKind` domain enum in lock-step so a bad value can never land.

ALTER TABLE tasks
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'blank'
  CHECK (kind IN ('blank', 'feature', 'bug', 'research'));
