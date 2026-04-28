-- Migration 014: prompt token counts.
--
-- Adds a stored `token_count` column on prompts. Counts are computed by the
-- application layer (js-tiktoken / cl100k_base) on insert/update inside the
-- same transaction; the DB itself just persists the integer.
--
-- The accompanying JS step (apply014TokenCount in migrations.ts) backfills
-- existing rows by walking every prompt and re-running countTokens(). Both
-- legs are idempotent: the ALTER is guarded by a column-presence check, and
-- backfill only writes rows where token_count IS NULL.

ALTER TABLE prompts ADD COLUMN token_count INTEGER;
