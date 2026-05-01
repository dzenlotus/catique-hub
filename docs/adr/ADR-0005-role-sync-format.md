# ADR-0005 — Role-file Sync: marker, format, attached-prompts handling (ctq-69)

**Status:** Accepted
**Date:** 2026-05-01
**Author:** Catique HUB team
**Roadmap item:** ctq-69 (Roles sync — Catique Hub roles → agent files in connected clients)
**Depends on:** ADR-0003 (Adapter Pattern), ADR-0004 (Instructions Editor)

---

## Context

Catique Hub stores roles in its SQLite database as the source of truth. Connected agentic clients (Claude Code, Cursor, …) consume their own per-file agent definitions on disk in client-specific formats. ctq-69 exports Catique roles into each client's native shape so the user does not have to maintain two parallel sources.

Three decisions must be locked before the export is safe:

1. **How do we mark "this file was written by Catique Hub" so a re-sync never clobbers user-authored agents?**
2. **What does the rendered file look like for each client?** (Filename, directory, frontmatter shape, body order.)
3. **What happens to a role's *attached prompts* on export?** Inline them, drop them, or sidecar?

The implementation is in `crates/application/src/clients.rs::render_role_file` and the per-client paths in `crates/clients/src/adapters/*.rs::agents_dir/agent_filename`.

---

## Decision

### 1. Marker: defence-in-depth (filename prefix **AND** frontmatter)

A file is treated as Catique-managed if and only if **both** signals are present:

- **Filename prefix:** the basename starts with `catique-`. Concretely `catique-{role_id}.md` or `catique-{role_id}.mdc`.
- **Frontmatter field:** the YAML frontmatter contains `managed-by: catique-hub`.

The application layer encodes both as constants:

```rust
const MANAGED_BY_VALUE: &str = "catique-hub";   // frontmatter value
const CATIQUE_PREFIX:   &str = "catique-";       // filename prefix
```

Why both? Either alone is fragile:

- **Filename only** would let a renamed user file (e.g. `catique-original.md` saved by accident) be silently overwritten.
- **Frontmatter only** would let a user copy our frontmatter into their own file as decoration and lose it on next sync.

Demanding both means the user has to opt in twice — on the filename **and** in the file body — for Catique to treat the file as ours. A user-authored file accidentally satisfying one is impossible to satisfy both without intent.

**Alternatives considered:**

- **Sidecar JSON** (`catique-roles.json` listing managed paths). Rejected: an out-of-band registry can drift from the actual filesystem, requires a reconciliation step, and creates a second source of truth for "what is managed."
- **HTML comment in body.** Rejected: not all clients render markdown, and the comment is invisible to the user reading the file. Frontmatter is conventional in this domain (Cursor's `.mdc` format expects YAML frontmatter natively).

### 2. Per-client format mappings

#### v1 client coverage (role sync)

| Client          | Supports role sync | `agents_dir`                           | `agent_filename(role_id)`         | Extension |
|-----------------|--------------------|----------------------------------------|------------------------------------|-----------|
| Claude Code     | ✅                  | `~/.claude/agents/`                    | `catique-{role_id}.md`             | `.md`     |
| Cursor          | ✅                  | `~/.cursor/rules/`                     | `catique-{role_id}.mdc`            | `.mdc`    |
| Claude Desktop  | ❌ (`SyncNotSupported`) | n/a                              | n/a                                | n/a       |
| Qwen CLI        | ❌ (`SyncNotSupported`) | n/a                              | n/a                                | n/a       |

`SyncNotSupported` returns `AppError::Validation` from `sync_roles_to_client`, so the UI can grey out the Sync button and explain why. Claude Desktop's per-project agent model and Qwen's underspecified agent format make their inclusion in v1 a research liability — they remain in the registry for **instructions** editing (ADR-0004) but opt out of role sync.

#### Rendered file shape (uniform across `.md` and `.mdc`)

```markdown
---
managed-by: catique-hub
role-id: <stable-role-id>
role-name: "<display name, double-quotes escaped>"
synced-at: <unix-ms>
color: "<optional brand colour>"
---

<role.description verbatim, if non-empty>

<each attached prompt rendered as a section — see §3>
```

Reasoning:

- **`---` fences** for YAML frontmatter — recognised by both Claude Code and Cursor, and by every general-purpose markdown previewer.
- **`role-id` is the stable Catique id**, not a slug. Slugs change when the role is renamed; the id is the join key for re-sync.
- **`synced-at` in unix-ms** so `list_synced_client_roles` can sort by recency without re-stat'ing the file.
- **Identical body shape across clients** keeps the renderer single-implementation; per-client divergence is paid only at the filesystem layer (path + extension), not at the content layer.
- **Cursor's `.mdc` format** is markdown with YAML frontmatter — our shape is a strict subset of what Cursor accepts. No format-specific transformation needed.

### 3. Attached prompts: inline into the body

A Catique role can have N attached prompts (instruction snippets composed via the inheritance resolver). These ship as **inlined sections in the rendered file body**, after the role description.

```markdown
---
managed-by: catique-hub
role-id: rust-backend
…
---

<role.description>

## Prompt: senior-engineering-bar

<prompt body>

## Prompt: …

…
```

Why inline?

- **One file per role** keeps the consumer simple (Claude Code reads one file, gets the full role context). Splitting prompts into sidecar files would force the client to know to load N files per role.
- **Resolved at sync time**, not at runtime. The agent reads a static file; it doesn't need to know about Catique's inheritance resolver. This is the boundary where Catique semantics get flattened into the client's contract.
- **Re-sync is idempotent on the disk shape**: same role + same prompts = same file content, byte-for-byte. Diffable in git if the user version-controls their `~/.claude/agents/`.

**Alternatives considered:**

- **Drop prompts on export.** Rejected: a role without its prompts is missing the meat of its instructions. The inheritance is the product.
- **Sidecar prompts file** (`catique-rust-backend.prompts.md`). Rejected: doubles the file count, doubles the marker checks, and no client agent format reads sidecars natively.

### 4. One-way semantics (Catique Hub → clients)

Sync is unidirectional. The user editing a managed agent file outside Catique Hub will lose those edits on the next sync — by design. The `RoleSyncReport` returned to the UI exposes `created`, `updated`, `deleted`, and `skipped` arrays so the user can audit what changed.

Bidirectional sync was explicitly out of scope per the task description: it would require conflict resolution, format reverse-mapping, and a merge UI. v1 ships without these.

### 5. Skip / preserve user-authored files

Files in `agents_dir` that **fail either marker check** (no `catique-` prefix, or no `managed-by: catique-hub` frontmatter) appear in `RoleSyncReport.skipped` and are never read, written, or deleted by the sync use-case. The `catique-` namespace is reserved; everything outside it is the user's domain.

Concretely: if the user has hand-authored `~/.claude/agents/code-reviewer.md`, sync ignores it. If they accidentally created `~/.claude/agents/catique-code-reviewer.md` without our frontmatter, sync also ignores it (defence-in-depth saves them).

---

## Out of scope (deferred to follow-ups)

- **Bidirectional sync.** Catique Hub → clients only.
- **Filesystem watcher.** Same rationale as ADR-0004: explicit user-initiated sync only.
- **Per-project agents.** Claude Desktop's project-scoped agent model is not addressed in v1; only global `~/.claude/agents/` is touched (via Claude Code's adapter).
- **Cross-platform beyond macOS.** Adapters are guarded with `cfg(target_os = "macos")` per ADR-0003.
- **Custom format mappings.** Each adapter has fixed `agents_dir` + `agent_filename` + uses the shared renderer. Clients with truly different formats (future Aider, Continue.dev, etc.) will get a separate adapter and may diverge the renderer at that point.
- **Auto-sync on role change.** The Settings toggle is documented in the task description but defaults OFF; explicit Sync button only for v1.

---

## Acceptance (graduation to Defined)

- [x] **ADR on marker mechanism** — §1 of this document. Defence-in-depth: filename prefix + frontmatter, both required.
- [x] **ADR on per-client format mappings** — §2. Two clients support sync (Claude Code, Cursor); two are explicitly `SyncNotSupported` (Claude Desktop, Qwen). Renderer is shared.
- [x] **Decision: attached prompts on export** — §3. Inlined into body as `## Prompt: <name>` sections.
- [x] **v1 client coverage list confirmed** — §2 table. Claude Code + Cursor for role sync; Claude Desktop + Qwen instructions-only.

---

## Consequences

**Positive:**

- A re-sync is byte-deterministic given the same inputs — easy to test, easy to diff.
- User-authored agents in the same directory are provably untouched (two independent gates must pass).
- Adding a fifth role-syncing client requires only an adapter change (`agents_dir` + `agent_filename` + register in `all_adapters()`); the renderer doesn't move.
- Clients that don't fit the shape (Claude Desktop, Qwen) are explicit non-participants, not silently broken — `SyncNotSupported` is a typed error.

**Negative / accepted risk:**

- A user who edits a managed file outside Catique Hub will lose those edits on next sync. Mitigated by the prominent `synced-at` timestamp and the one-way warning in the UI.
- The `catique-` filename prefix is a global namespace claim in `~/.claude/agents/` and `~/.cursor/rules/`. If another tool ever adopts the same prefix, files will alias. Probability is low; cost is recoverable (rename our prefix in a future ADR if needed).
- Attached-prompt inlining means very large prompt sets produce large agent files. Not a concern at current sizes (single-digit KB) but should be revisited if a role accumulates >50 prompts.

---

## Related

- **ADR-0003** — Agentic Client Adapter Pattern (ctq-67). Defines `ClientAdapter::agents_dir` and `agent_filename` used here.
- **ADR-0004** — Client Instructions Editor (ctq-68). Establishes the one-way philosophy this ADR extends.
- **`crates/application/src/clients.rs`** — `sync_roles_to_client` use-case, `render_role_file`, `parse_frontmatter`, `list_synced_roles`.
- **`crates/domain/src/client_role_sync.rs`** — `SyncedRoleFile`, `RoleSyncReport`.
- **`crates/clients/src/adapters/{claude_code,cursor}.rs`** — sync-supporting adapters.
- **`crates/clients/src/adapters/{claude_desktop,qwen}.rs`** — `SyncNotSupported` adapters (instructions only).
