-- 011_space_prompts.sql — fourth-level prompt-inheritance join.
--
-- Catique's product spec (D9 / ctq-73) mandates a four-level resolver:
-- `space → board → column → task`. Migrations 001–010 ship the lower
-- three levels (`board_prompts`, `column_prompts`, `task_prompts`) but
-- left the space level absent — the audit `F-02` (P0) called this out
-- as a schema gap that blocks every cross-board organisational default.
-- This migration lands the missing join table; the resolver itself
-- (ctq-100) walks all four levels and is implemented separately.
--
-- Shape mirrors `board_prompts` / `column_prompts` (001_initial.sql
-- lines 214-226):
--   * compound primary key `(space_id, prompt_id)` — at most one row
--     per (space, prompt) pair, dedup is the join table's job;
--   * both FKs cascade on parent delete, so dropping a space or a
--     prompt cleans up its attachments without an explicit sweep;
--   * `position` is REAL (matching `role_prompts` / `task_prompts`)
--     so the application layer can mid-point insert without
--     renumbering — the integer-positioned board/column tables are
--     historical Promptery quirks, not a contract we want to extend.
--
-- The migration is purely additive (CREATE TABLE / CREATE INDEX, no
-- ALTER). `IF NOT EXISTS` everywhere keeps re-runs idempotent on
-- developer workstations even when the runner's `_migrations` ledger
-- is hand-edited during tests.

CREATE TABLE IF NOT EXISTS space_prompts (
  space_id  TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  position  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (space_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_space_prompts_space ON space_prompts(space_id);
