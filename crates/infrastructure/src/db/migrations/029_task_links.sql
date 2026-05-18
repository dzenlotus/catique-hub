-- 029_task_links.sql — minimal task↔task relationship model (catique-4).
--
-- Lets the UI / agents express "A relates to B", "A blocks B", or
-- "A is a sub-task of B". The set of kinds is intentionally tiny — we
-- can grow it later by extending the CHECK list; an enum table would
-- add a join cost for what is always a small fixed vocabulary.
--
-- Cardinality:
--   * Pair (src, dst, kind) is unique — re-issuing the same link is a
--     no-op (idempotent insert via INSERT OR IGNORE in the repo).
--   * `src != dst` — no self-links. Enforced at SQL level so any
--     writer (including a manual sqlite3 poke) catches the mistake.
--   * `kind` is the discriminator. `related` is symmetric in
--     intent but stored asymmetric — the UI is free to render both
--     directions identically. `blocks` and `parent` are directional.
--
-- Indexing:
--   * The PK doubles as the lookup index on `(src_task_id, ...)`.
--   * `idx_task_links_dst` accelerates "who blocks me?" / "what is my
--     parent?" queries — the reverse direction.

CREATE TABLE IF NOT EXISTS task_links (
  src_task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dst_task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'related'
                 CHECK (kind IN ('related','blocks','parent')),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (src_task_id, dst_task_id, kind),
  CHECK (src_task_id <> dst_task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_links_dst
  ON task_links(dst_task_id);
