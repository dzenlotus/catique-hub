-- 008_space_board_icons_colors.sql — add optional `color` + `icon` to
-- spaces and boards.
--
-- Mirrors `005_prompt_icons.sql` / `007_prompt_group_icons.sql` for the
-- top-level container entities. The TS layer maps the `icon` identifier
-- (e.g. "star", "bolt", "heart") onto a pixel-icon React component
-- sourced from `src/shared/ui/Icon/`. Storing the identifier as plain
-- TEXT keeps the backend agnostic to the icon set: rename a sprite on
-- the frontend without a migration.
--
-- `color` is the same `#RRGGBB` shape used everywhere else (validated
-- in the application layer, not in SQL).
--
-- Both columns are nullable so existing rows keep their "no icon / no
-- colour" behaviour. The application layer treats `NULL` and an
-- empty/unknown identifier the same way (no icon rendered, no override
-- colour). The migration is purely additive — `ADD COLUMN` does not
-- rewrite existing rows, so SQLite handles it without a table rebuild
-- and the operation is O(1) regardless of table size.
ALTER TABLE spaces ADD COLUMN color TEXT NULL;
ALTER TABLE spaces ADD COLUMN icon  TEXT NULL;
ALTER TABLE boards ADD COLUMN color TEXT NULL;
ALTER TABLE boards ADD COLUMN icon  TEXT NULL;
