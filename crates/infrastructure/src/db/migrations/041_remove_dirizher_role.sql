-- 041_remove_dirizher_role.sql
--
-- Remove the "Дирижер" (Dirizher) coordinator system role. It was the
-- Pattern B coordinator seeded by 004_cat_as_agent_phase1.sql, but it is
-- no longer wanted — it never owns work and only cluttered the agent
-- list. `delete_role` refuses `is_system` rows, so it can't be removed
-- through the UI/IPC; this migration is the supported path.
--
-- `boards.owner_role_id` has no ON DELETE action (RESTRICT), so defensively
-- reassign any board that somehow points at Dirizher to Maintainer before
-- deleting. Everything else clears itself: `tasks.role_id` / `boards.role_id`
-- are ON DELETE SET NULL, and the role_* join tables are ON DELETE CASCADE.
--
-- Runs after 004's seed, so fresh installs create-then-drop in one batch
-- and never surface the row. Idempotent on installs where it's absent.

UPDATE boards
   SET owner_role_id = 'maintainer-system'
 WHERE owner_role_id = 'dirizher-system';

DELETE FROM roles WHERE id = 'dirizher-system';
