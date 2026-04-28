-- 017_agent_reports
-- Typed, persistent, searchable artefacts that an agent saves to a task —
-- an investigation result / analysis / plan / summary / review / memo.
-- Reports are first-class entities so they don't bloat task.description and
-- stay searchable across boards via FTS5.
--
-- Mirrors the 008_tasks_fts shape: a content table + a sibling FTS virtual
-- table kept in sync via three triggers (insert / update / delete). The
-- triggers reference `rowid` because the FTS5 contentless-coupled mode
-- ('content=agent_reports', 'content_rowid=rowid') uses the source row's
-- INTEGER rowid as the join key. The JS migration step backfills any rows
-- that pre-existed the FTS table on first run (idempotent — see migrations.ts).

CREATE TABLE IF NOT EXISTS agent_reports (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_reports_task ON agent_reports(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_reports_kind ON agent_reports(kind);

CREATE VIRTUAL TABLE IF NOT EXISTS agent_reports_fts USING fts5(
  report_id UNINDEXED,
  title,
  content,
  tokenize='unicode61 remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS agent_reports_fts_insert
AFTER INSERT ON agent_reports BEGIN
  INSERT INTO agent_reports_fts(report_id, title, content)
  VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS agent_reports_fts_update
AFTER UPDATE OF title, content ON agent_reports BEGIN
  UPDATE agent_reports_fts
  SET title = new.title, content = new.content
  WHERE report_id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS agent_reports_fts_delete
AFTER DELETE ON agent_reports BEGIN
  DELETE FROM agent_reports_fts WHERE report_id = old.id;
END;
