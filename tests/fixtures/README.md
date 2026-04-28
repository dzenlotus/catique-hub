# Test fixtures

## `promptery-v0.4-golden.sqlite`

Shared test fixture for the import-roundtrip integration test
(`crates/application/tests/import_roundtrip.rs`). Sourced byte-identically
from `promptery/tests/fixtures/promptery-v0.4-golden.sqlite` per D-019
(decision-log entry, 2026-04-28).

The fixture is the canonical Promptery v0.4 DB shape — applies
`src/db/schema.sql` + the 15 ordered migrations from `src/db/migrations/`,
then seeds a deterministic Mulberry32-PRNG payload.

### D-019 contract row counts

| Table | Count |
|---|---:|
| `spaces` | 10 |
| `space_counters` | 10 |
| `roles` | 12 |
| `skills` | 8 |
| `mcp_tools` | 6 |
| `role_skills` | 24 |
| `role_mcp_tools` | 12 |
| `role_prompts` | 48 |
| `boards` | 50 |
| `columns` | 200 |
| `prompts` | 100 |
| `prompt_groups` | 6 |
| `prompt_group_members` | 100 |
| `board_prompts` | 100 |
| `column_prompts` | 200 |
| `tasks` | 1000 |
| `task_prompts` | 2000 |
| `task_attachments` | 20 |
| `task_events` | 1000 |
| `agent_reports` | 50 |
| `tags` | 8 |
| `prompt_tags` | 200 |
| `task_skills` | 0 |
| `task_mcp_tools` | 0 |
| `task_prompt_overrides` | 100 |
| `tasks_fts` | 1000 |
| `agent_reports_fts` | 50 |
| `settings` | 2 |
| `_migrations` | 15 |

### Schema hash

```
sha256(schema.sql || migrations[sorted asc by filename])
= 38b7a2367fdac911d69330e19b841bf43b33302ff494998bb797783fc94ab138
```

### Updating

Do not regenerate this file in-tree. The seed script lives in the
Promptery repo (`tests/fixtures/seed-promptery-v0.4-golden.ts`). When
the schema hash bumps under D-021 Q-3 paired-PR policy, copy the new
golden fixture from Promptery and update the row counts above.
