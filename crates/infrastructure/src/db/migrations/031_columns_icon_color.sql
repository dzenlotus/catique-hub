-- 031_columns_icon_color.sql — per-column appearance (icon + color).
--
-- Adds two nullable TEXT columns so a column can carry an icon picked
-- from the IconColorPicker palette and a CSS color string, matching the
-- pattern used by boards, roles, prompts, prompt_groups, skills, and
-- spaces. Without this migration the kanban surface fell back to a
-- name-heuristic glyph (Backlog/In progress/Done) and gave no way to
-- customise that per column.
--
-- Both columns default to NULL (no override). Reading code treats NULL
-- on `icon` as "fall back to the name-heuristic glyph" and NULL on
-- `color` as "inherit the column-surface foreground" — preserving the
-- pre-migration look for every existing row without touching it.

ALTER TABLE columns ADD COLUMN icon TEXT;
ALTER TABLE columns ADD COLUMN color TEXT;
