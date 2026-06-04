# D-G audit run — 2026-05-27

## DBs inspected

| Path | Schema version | Bytes | Boards-without-owner |
|---|---|---|---|
| `~/Library/Application Support/catique-dev/catique.sqlite` | (uninitialised — empty file) | 0 | 0 |
| `~/Library/Application Support/catique/catique.sqlite` | (not present) | — | n/a |

## Verdict

No installs on this machine have data. Migration `034_backfill_board_owners.sql` is **not** required from local audit.

## Pre-merge action

Before Phase 6 ships:

1. Re-run the diagnostic on every collaborator's `catique-dev/` and `catique/` DB (paste their report into the PR description).
2. If any non-zero result lands, cut `034_*.sql` per the policy in [`D-G`](D-G-board-owner-data-audit.md#approach).
3. Otherwise close D-G with "no migration shipped".

## Repro

```bash
sqlite3 "<path>/catique.sqlite" "
  SELECT b.id, b.name, b.space_id, b.role_id
  FROM boards b
  LEFT JOIN roles r ON r.id = b.role_id
  WHERE b.role_id IS NULL OR r.id IS NULL OR r.space_id <> b.space_id;
"
```
