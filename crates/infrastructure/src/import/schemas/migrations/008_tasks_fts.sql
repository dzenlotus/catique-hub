-- 008_tasks_fts
-- Full-text search across task title + description via SQLite FTS5. Mirror
-- table kept in sync with `tasks` through three triggers (insert/update/delete);
-- the JS migration step backfills existing rows on first run. The FTS table
-- carries `task_id UNINDEXED` so it isn't considered for matching but joins
-- back to `tasks.id` cheaply.

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
