# D-G — Audit of boards without role owner

**Status:** Proposed (draft — awaiting product sign-off)
**Phase:** 0 (informational — establishes whether a migration is required for v3)
**Surface:** One-shot diagnostic script + optional migration `034_backfill_board_owners.sql`.

---

## Context

D-020 (role ownership invariant): every board has exactly one owning role; there are no "shared" boards. Project Map open issue #2 asks: do any production / dev / test databases violate this? Cleanup options depend on the answer.

## Approach

1. Run the diagnostic against every reachable DB:

   ```sql
   SELECT b.id, b.name, b.space_id, b.role_id
   FROM boards b
   LEFT JOIN roles r ON r.id = b.role_id
   WHERE b.role_id IS NULL
      OR r.id IS NULL
      OR r.space_id <> b.space_id;
   ```

   Three failure modes detected: NULL owner, dangling FK, cross-space mismatch.

2. Bucket the targets:
   - `~/Library/Application Support/catique-dev/catique.sqlite` (this machine)
   - `~/Library/Application Support/catique/catique.sqlite` (any release install on this machine)
   - Any DB shipped to QA or shared with collaborators.

3. For each row returned:

   | Fix-mode | When |
   |---|---|
   | `auto-assign space owner role` | Board is in a space that has exactly one role → assign that role |
   | `reassign to first role` | Space has multiple roles → pick the lex-first role and warn |
   | `delete board` | Space has zero roles AND the board has zero tasks (orphan) |
   | `manual` | Anything else — surface in CLI output, require user decision |

4. Materialise the fix as `034_backfill_board_owners.sql` only if any row was found. If the audit reports zero rows on every DB, **commit no migration** — D-020 holds today and the v3 frontend can rely on it.

## Decision

**Run audit first; defer migration to only-if-needed.** The cost of a no-op migration is not zero — every install applies it. Don't ship one unless we know there's data to fix.

## Acceptance criteria

- Diagnostic produces a JSON report committed under `docs/refactor-v3/decisions/audit-D-G-report.json` (or similar) with:
  - DB path
  - Schema version
  - Affected rows (`board_id`, `space_id`, `failure_mode`)
- If the report is empty → close this decision with a note "no migration shipped".
- If non-empty → cut a migration ticket with the bucket counts; the migration writes the fixes per the policy above.

## Open questions

- Where to store reports for non-local DBs? Recommendation: do not check them into git — paste them into the PR description.

## Out of scope

- Reactive enforcement (a CHECK constraint or trigger) to prevent future drift. That's a separate decision; today the application layer guarantees owner-on-create per `boards.rs::create_board`.
