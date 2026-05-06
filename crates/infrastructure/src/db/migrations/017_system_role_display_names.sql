-- 017_system_role_display_names.sql — rename system role display names.
--
-- Maintainer feedback 2026-05-06: the seeded system roles should
-- read "Owner" (matches the default board name) and "Дирижер"
-- (Cyrillic) in the UI. Internal ids (`maintainer-system`,
-- `dirizher-system`) stay so existing code references / IPC
-- guards / tests keep working — only `roles.name` changes.
--
-- Idempotent: re-running on an already-renamed DB is a no-op.

UPDATE roles SET name = 'Owner'
 WHERE id = 'maintainer-system';

UPDATE roles SET name = 'Дирижер'
 WHERE id = 'dirizher-system';
