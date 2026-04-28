-- Migration 016 — task attachments.
--
-- Per-task file uploads (images and arbitrary files). Metadata lives in
-- task_attachments; binary content lives on disk under
-- ~/.promptery/attachments/<task_id>/<storage_path>. The CASCADE on task_id
-- removes metadata rows when the parent task is deleted; the application
-- layer is responsible for removing the attachments directory after the
-- DELETE on tasks runs.
CREATE TABLE IF NOT EXISTS task_attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  uploaded_by TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);
