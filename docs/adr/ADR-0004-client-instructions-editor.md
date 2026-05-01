# ADR-0004 — Client Instructions Editor: reload semantics & conflict UX (ctq-68)

**Status:** Accepted
**Date:** 2026-05-01
**Author:** Catique HUB team
**Roadmap item:** ctq-68 (Global instructions editor for connected agentic clients)
**Depends on:** ADR-0003 (Agentic Client Adapter Pattern)

---

## Context

Each connected agentic client persists "global instructions" as a plain-text file the LLM reads on every session (Claude Code's `CLAUDE.md`, Cursor's `rules.mdc`, Qwen's `QWEN.md`, Claude Desktop's `CLAUDE.md`). Maintainers edit these in different editors, on different paths, with different conventions. Catique HUB exposes a unified editor so the maintainer can review and update them all from one place.

Three questions must be answered before the editor can ship:

1. **How does the editor learn that the file changed externally?** Watcher vs polling vs explicit reload.
2. **What happens when the user saves an edit while the file has been modified externally since they opened the editor?** Block? Warn? Merge?
3. **Where does the file live for each client?** Catique HUB cannot edit a path it cannot resolve.

This ADR resolves all three. The implementation lives in `src/widgets/client-instructions-editor/` and `crates/clients/src/adapters/*::instructions_file()`.

---

## Decision

### 1. Reload semantics: **manual-only, no watcher, no polling**

The editor reads the file once on open (via `read_client_instructions` IPC) and never re-reads it implicitly. The user must explicitly click **«Перезагрузить»** to see external changes.

This is one-way and user-initiated. Reasons:

- **No watcher overhead.** macOS FSEvents would have to be wired through Tauri, propagated to the webview, debounced. Cost is non-trivial; benefit is marginal because the user is a single human editing one place at a time.
- **No surprise updates during typing.** A watcher firing mid-edit would force a merge dialog while the user is composing — disruptive.
- **No race conditions on save.** Without a watcher there is no window where "fresh data arrived 50 ms before the user clicks Save and we have to decide which wins."
- **The editor is not a live document tool.** The mental model is closer to a text editor (vim, VS Code) than to Google Docs. Vim does not auto-reload either; it warns.

**Trade-off accepted:** if the user has the editor open while another tool modifies the file, the user must remember to click «Перезагрузить» before editing further. This is mitigated by the conflict warning in §2.

### 2. Conflict UX: **warning, not blocking**

When the user clicks **«Сохранить»**:

1. The mutation handler reads the file's current `mtime` from disk (cheap stat) and compares it to the `mtime` recorded when the editor opened (`mountedModifiedAt`).
2. If the `mtime` drifted, a non-blocking warning banner appears: *«Файл был изменён другой программой с момента открытия редактора. Сохранение перезапишет внешние изменения.»*
3. The save proceeds anyway. The user's in-memory content overwrites the file. The banner remains visible until a successful save resets `mountedModifiedAt` to the new `mtime`.

This is intentionally **not** a blocking dialog. Reasons:

- **The user is the source of truth.** They opened the editor, they typed an edit, they hit Save. Asking «Are you sure?» second-guesses an action they've already confirmed.
- **No merge tooling.** A blocking dialog would either force a hard discard ("Lose your edits") or require a 3-way merge UI we have not built and do not plan to build for v1.
- **The warning is recoverable.** If the user does want the external changes, they can: dismiss the save (in-memory edits stay), click «Перезагрузить» (which prompts to discard if dirty), then re-edit on top of fresh content.

**Trade-off accepted:** in a true concurrent-edit scenario, the most-recent-Save wins. This is the same semantic as `git push --force`. The warning makes it visible; the user owns the consequences.

**Other dirty-state guards** (already implemented in the widget):

- Closing the dialog with unsaved edits triggers `window.confirm("Есть несохранённые изменения. Отменить их?")`.
- Clicking «Перезагрузить» with unsaved edits triggers the same confirmation.
- The widget never silently discards user input.

### 3. Per-client file paths

Each adapter's `instructions_file()` returns the canonical global-instructions path:

| Client            | Path                                                      | Format        | Notes                                                                 |
|-------------------|-----------------------------------------------------------|---------------|-----------------------------------------------------------------------|
| Claude Code       | `~/.claude/CLAUDE.md`                                     | Markdown      | Plain markdown, no frontmatter.                                       |
| Claude Desktop    | `~/Library/Application Support/Claude/CLAUDE.md`          | Markdown      | Per-project `<project>/.claude/CLAUDE.md` is **out of scope** for v1. |
| Cursor            | `~/.cursor/rules.mdc`                                     | Markdown      | Cursor's directory-of-rules pattern (`~/.cursor/rules/`) is **out of scope** for v1; the single `rules.mdc` file is the canonical global instructions surface. |
| Qwen CLI          | `~/.qwen/QWEN.md`                                         | Markdown      | Best-effort path — Qwen's docs do not formalise this; subject to change. |

All four files are treated as plain markdown by the editor. No format-specific parsing in v1 (Cursor's optional YAML frontmatter is preserved verbatim — the textarea round-trips it without interpretation).

If `instructions_file()` returns a path that does not exist, `read_client_instructions` returns `{ content: "", modifiedAt: 0n, filePath }` — the editor renders an empty buffer, and the first save creates the file. Parent directories are created on demand by `write_client_instructions` with `O_CREAT | parent_mkdir_p` semantics.

---

## Out of scope (deferred)

- **Project-level instructions** (`<project>/.claude/CLAUDE.md`, Cursor's per-project `.cursor/rules.mdc`). Catique HUB edits **global** instructions only. Project-level files are deliberately closer to source code and managed by the project's own conventions.
- **Cursor's directory-of-rules pattern** (`~/.cursor/rules/*.mdc`). The directory contains role-scoped rules; ctq-69 (Roles sync) writes per-role files here, but the global editor does not multiplex across them.
- **Filesystem watcher.** Decided against in §1; not a follow-up.
- **Auto-syncing changes between clients.** Each client's instructions file is independent. If the user wants to share content, they copy-paste — explicit and observable.
- **Per-client format awareness** (parsing Cursor's frontmatter, validating Markdown structure). v1 treats all files as opaque text.
- **Cross-platform beyond macOS.** Windows / Linux support is deferred at the adapter layer (ADR-0003 §4). The editor inherits that limit.

---

## Acceptance (graduation to Defined)

- [x] **ADR on reload semantics** — this document.
- [x] **Conflict UX defined** — warning banner, save-through; documented in §2 and implemented at `src/widgets/client-instructions-editor/ClientInstructionsEditor.tsx:123-148`.
- [x] **Per-client file paths resolved** for Claude Code, Cursor, Qwen, Claude Desktop — see §3 and the adapter unit tests (`crates/clients/src/adapters/*.rs::tests::instructions_file_*`).

---

## Consequences

**Positive:**

- The editor's behaviour is predictable: the user controls when the file is read and when it is written.
- Implementation footprint is small — no watcher infrastructure, no merge UI, no per-client format adapters.
- All four v1 clients share one editor surface; adding a fifth client requires only a new adapter in `crates/clients/src/adapters/` (per ADR-0003).

**Negative / accepted risk:**

- A user who edits in two places concurrently can lose external changes on save. Mitigated by the warning banner and by the `mtime` check.
- Manual reload requires a deliberate user action; users accustomed to live-reload editors may be surprised once.
- Best-guess Qwen CLI path may drift if upstream changes its convention. Tracked as a follow-up; the cost of being wrong is a missing-file empty editor, not data loss.

---

## Related

- **ADR-0003** — Agentic Client Adapter Pattern (ctq-67). Defines the trait and discovery model this editor consumes.
- **ctq-69** — Roles sync to client agent files. Writes per-role files into `~/.cursor/rules/` and `~/.claude/agents/` using the same adapter trait, separate from this editor's scope.
- **`crates/clients/src/lib.rs`** — `ClientAdapter` trait (`instructions_file`, `agents_dir`, `agent_filename`).
- **`crates/api/src/handlers/clients.rs`** — `read_client_instructions` / `write_client_instructions` IPC commands.
- **`src/widgets/client-instructions-editor/`** — editor widget.
- **`src/entities/connected-client/`** — `useClientInstructions` / `useWriteClientInstructionsMutation` hooks.
