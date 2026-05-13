-- 026_role_notes.sql — per-role retrospective memory store (ctq-137,
-- MEM-S1). One row per self-authored note attached to a role; each note
-- carries agent-invented tags (via the `role_note_tags` join) that
-- `recall_role_notes` overlaps against the task at hand. FTS5 mirror
-- (`role_notes_fts`) is the fallback when the agent has no useful tags
-- to start from.
--
-- Separation from `agent_reports`
-- ===============================
-- Reports (Promptery legacy + `001_initial.sql`) are per-task typed
-- artefacts the user reads: investigations, plans, summaries. Notes are
-- per-role retrospective memory the agent reads. The two surfaces have
-- different lifetimes (a task is finite; a role is persistent), different
-- audiences, and different write triggers — so they get separate tables.
--
-- Tag storage
-- ===========
-- Tags live in a side table (`role_note_tags`) rather than as a JSON
-- column on `role_notes` so the recall path can intersect by tag without
-- pulling every note's body into memory. The same shape is what the
-- existing `tags` / `prompt_tags` pair uses (`001_initial.sql:349-365`),
-- but the two namespaces are deliberately disjoint: role-note tags are
-- agent-invented strings local to the memory store; the `tags` table is
-- the user's curated prompt-tag library. See `docs/audit/mcp-tool-surface-audit.md`
-- §3.5 + §4.1 for the audit-side rationale.
--
-- Tag normalisation (kebab-case, max 32 chars, `[a-z0-9-]` only) lives
-- in the use-case layer (`crates/application/src/role_notes.rs`), not at
-- the SQL level — keeping it in Rust makes the rule unit-testable in
-- isolation and easier to evolve without touching the schema.
--
-- `authored_by` discriminates agent-written notes from
-- user-written ones (the UI also lets the user curate the store); a
-- CHECK constraint pins the discriminant set. `pinned` notes always
-- surface from `recall` regardless of tag overlap — they're the user's
-- way to elevate a memory the agent should always see.
--
-- `priority` is a small integer the agent or the user can bias recall
-- with; default 0. Higher = surfaced earlier in the recall ranking. The
-- recall ranking lives in the use case (`RoleNotesUseCase::recall`)
-- because it composes recency, overlap count, and FTS bm25 — none of
-- which are good fits for a SQL `ORDER BY`.

CREATE TABLE IF NOT EXISTS role_notes (
  id              TEXT NOT NULL PRIMARY KEY,
  role_id         TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  source_task_id  TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  body            TEXT NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 0,
  pinned          INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  authored_by     TEXT NOT NULL CHECK(authored_by IN ('agent','user')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_role_notes_role
  ON role_notes(role_id);

CREATE TABLE IF NOT EXISTS role_note_tags (
  note_id TEXT NOT NULL REFERENCES role_notes(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_role_note_tags_tag
  ON role_note_tags(tag);
CREATE INDEX IF NOT EXISTS idx_role_note_tags_note
  ON role_note_tags(note_id);

-- FTS5 over the note body for the fallback path in recall (used when
-- tag intersection is empty). The trigger pattern mirrors `tasks_fts`
-- from `001_initial.sql:306-329`.
CREATE VIRTUAL TABLE IF NOT EXISTS role_notes_fts USING fts5(
  note_id UNINDEXED,
  body,
  tokenize = 'unicode61 remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS role_notes_ai
AFTER INSERT ON role_notes BEGIN
  INSERT INTO role_notes_fts(note_id, body) VALUES (new.id, new.body);
END;

CREATE TRIGGER IF NOT EXISTS role_notes_ad
AFTER DELETE ON role_notes BEGIN
  DELETE FROM role_notes_fts WHERE note_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS role_notes_au
AFTER UPDATE OF body ON role_notes BEGIN
  UPDATE role_notes_fts SET body = new.body WHERE note_id = new.id;
END;
