-- Migration 003: add optional description to boards.
ALTER TABLE boards ADD COLUMN description TEXT;
