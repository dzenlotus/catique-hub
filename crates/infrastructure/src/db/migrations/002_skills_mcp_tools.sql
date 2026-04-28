-- 002_skills_mcp_tools.sql — extend skills and mcp_tools tables.
--
-- Wave-E2.x (Round 6 back-fill): the initial schema bootstrapped from
-- Promptery v0.4 created `skills` and `mcp_tools` with only the
-- minimal Promptery-compatible columns (id, name, content, color,
-- created_at, updated_at). Catique's CRUD pipeline requires:
--
--   skills     — description, position
--   mcp_tools  — description, schema_json, position
--
-- SQLite only supports ADD COLUMN in ALTER TABLE; we cannot DROP or
-- rename columns in-place. We therefore:
--   1. Add the new columns with backward-compatible defaults.
--   2. Populate `position` from `rowid` so existing rows get a stable
--      initial order (ascending insertion order → stable list).
--
-- CHECK constraints are not back-applied to existing rows by SQLite
-- (they only fire on INSERT / UPDATE). The application layer enforces
-- them on all writes so the constraint is effectively honoured.

-- ====================================================================
-- skills — add description + position
-- ====================================================================
ALTER TABLE skills ADD COLUMN description TEXT;
ALTER TABLE skills ADD COLUMN position REAL NOT NULL DEFAULT 0;

-- Seed position so existing rows sort deterministically.
UPDATE skills SET position = CAST(rowid AS REAL) WHERE position = 0;

-- ====================================================================
-- mcp_tools — add description, schema_json, position
-- ====================================================================
ALTER TABLE mcp_tools ADD COLUMN description TEXT;
ALTER TABLE mcp_tools ADD COLUMN schema_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE mcp_tools ADD COLUMN position REAL NOT NULL DEFAULT 0;

-- Seed position so existing rows sort deterministically.
UPDATE mcp_tools SET position = CAST(rowid AS REAL) WHERE position = 0;
