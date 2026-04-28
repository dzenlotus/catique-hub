-- 001_initial.sql — first migration for Catique HUB.
--
-- Wave-E2 (Olga, 2026-04-28): bootstrap the minimal table set required
-- for the Board vertical slice. Tables are copied **byte-identical** from
-- Promptery v0.4 schema so that the future import-module (E2.5) can
-- replay an existing Promptery DB without schema mismatches.
--
-- Source of truth:
--   docs/catique-migration/schemas/promptery-v0.4-schema.sql v0.4
--
-- Per-table provenance (line ranges refer to the source file above):
--   * spaces                         lines  1-15  (table + 2 indexes)
--   * roles                          lines 77-84
--   * boards                         lines 22-33  (table + 2 indexes)
--   * columns                        lines 35-42
--
-- D-025 #1 (Alex, decision-log): roles must exist before boards because
-- boards.role_id has FK ON DELETE SET NULL referencing roles(id) under
-- PRAGMA foreign_keys=ON. Therefore the `CREATE TABLE` order is:
--     spaces → roles → boards → columns
-- which is the order recorded below. `space_counters` is intentionally
-- omitted from this migration — slug auto-generation is not yet wired
-- (see E2.4 follow-up); we will add it together with the slug repo work.

-- spaces (Promptery v0.4 schema, lines 1-15) -----------------------------
CREATE TABLE IF NOT EXISTS spaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  prefix      TEXT NOT NULL UNIQUE,
  description TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0,
  position    REAL NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK (prefix GLOB '[a-z0-9-]*' AND length(prefix) BETWEEN 1 AND 10)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_is_default
  ON spaces(is_default) WHERE is_default = 1;
CREATE INDEX IF NOT EXISTS idx_spaces_position ON spaces(position);

-- roles (Promptery v0.4 schema, lines 77-84) -----------------------------
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  color TEXT DEFAULT '#888',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- boards (Promptery v0.4 schema, lines 22-33) ----------------------------
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
  position REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_boards_space ON boards(space_id);
CREATE INDEX IF NOT EXISTS idx_boards_space_position ON boards(space_id, position);

-- columns (Promptery v0.4 schema, lines 35-42) ---------------------------
CREATE TABLE IF NOT EXISTS columns (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
