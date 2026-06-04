-- 040_drop_pinned_boards.sql
--
-- The "Pinned boards" sidebar feature was removed. Its persistence
-- (the `pinned_boards` table + index shipped in 036_pinned_recent_kv.sql)
-- is now dead — no handler, use case, or UI references it. Drop both.
--
-- The sibling `recent_boards` table is untouched: the Recent surface is
-- still live (board-visit tracking in KanbanBoard). `IF EXISTS` keeps
-- this idempotent and safe on installs that never created the table.

DROP INDEX IF EXISTS idx_pinned_boards_position;
DROP TABLE IF EXISTS pinned_boards;
