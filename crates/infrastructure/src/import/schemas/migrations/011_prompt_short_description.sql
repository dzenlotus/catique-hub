-- Migration 011: add short_description to prompts table.
-- NULL by default — existing prompts have no short description until set.
ALTER TABLE prompts ADD COLUMN short_description TEXT;
