# Promptery v0.x Freeze — Maintainer Runbook (ctq-61)

| Field         | Value                                          |
|---------------|------------------------------------------------|
| Task          | ctq-61                                         |
| Unblocked by  | ctq-57 (ADR-0003 Refactor strategy — Done)     |
| Author        | Catique HUB release tooling                    |
| Date drafted  | 2026-05-05                                     |
| Status        | Ready for maintainer action — do NOT apply automatically |

---

## Purpose

Promptery has entered maintenance mode. Active feature development
continues in Catique HUB. This runbook gives the maintainer exact
copy-paste text for every surface that needs updating in the
Promptery repository, plus a checklist to apply it safely.

Do not commit or push anything from this file; apply changes manually
in the Promptery repo.

---

## Artifact 1 — README.md banner (paste at the very top, before any existing content)

```markdown
> **Maintenance mode.** Promptery (v0.x) is no longer receiving new
> features. Bug fixes and security patches will be applied on a
> best-effort basis. All active development has moved to
> [Catique HUB](<CATIQUE_HUB_URL>), which supersedes Promptery as the
> primary prompt-management and MCP-tooling platform. Existing
> Promptery users can migrate their data with `promptery migrate`
> before the archive date.
```

Replace `<CATIQUE_HUB_URL>` with the public GitHub URL of the
Catique HUB repository before committing.

---

## Artifact 2 — CONTRIBUTING.md "Where new features go" section

Add this section immediately after the project introduction, before
any "How to contribute" heading:

```markdown
## Where new features go

Promptery is in maintenance mode. New feature proposals belong in the
[Catique HUB](<CATIQUE_HUB_URL>) repository — please open issues and
pull requests there. Contributions to Promptery are limited to:

- Security patches
- Bug fixes for regressions introduced in v0.x
- Documentation corrections
```

Replace `<CATIQUE_HUB_URL>` with the same URL used in the README
banner above.

---

## Artifact 3 — GitHub repository About text (350 chars max)

```
MCP-powered prompt manager for Claude and other agentic clients. Now in maintenance mode — active development has moved to Catique HUB. Bug fixes only. Use promptery migrate to export your data before the archive date.
```

Character count: 219. Fits within the 350-character GitHub limit.

---

## Artifact 4 — GitHub repository topics

Replace or merge the current topic list with the following (5–7 topics).
`mcp` and `mcp-tools` are preserved for discoverability:

```
maintenance-mode
mcp
mcp-tools
prompt-management
claude
llm-tools
promptery
```

---

## Artifact 5 — Suggested commit message

```
docs: announce Catique HUB and Promptery maintenance mode
```

Use this message verbatim; it matches the DoD requirement in ctq-61.

---

## Artifact 6 — Maintainer checklist (apply manually in the Promptery repo)

Work through these steps in order. Each is reversible before the final push.

- [ ] **1. Resolve the placeholder.** Confirm the public URL for the
  Catique HUB repository. You will paste it in place of
  `<CATIQUE_HUB_URL>` in two places (README banner + CONTRIBUTING
  section).

- [ ] **2. Update README.md.** Open `README.md` in the Promptery repo.
  Paste the banner from Artifact 1 as the very first lines of the
  file (before any `#` heading or badge). Substitute
  `<CATIQUE_HUB_URL>`.

- [ ] **3. Update CONTRIBUTING.md.** If the file does not exist, create
  it with only the section from Artifact 2. If it exists, insert the
  section immediately after the opening paragraph, before the first
  `##` heading. Substitute `<CATIQUE_HUB_URL>`.

- [ ] **4. Stage and review the diff.** Run `git diff --staged` and
  confirm only README.md and CONTRIBUTING.md changed. No source files
  should be touched.

- [ ] **5. Commit.** Use the exact message from Artifact 5:
  `docs: announce Catique HUB and Promptery maintenance mode`

- [ ] **6. Update GitHub About.** In the Promptery repo's GitHub
  settings (Settings → General → Description / Website / Topics),
  paste the About text from Artifact 3 into the Description field
  and replace the topics with the list from Artifact 4.

- [ ] **7. Push.** Push the commit to the default branch of the
  Promptery repo.

- [ ] **8. Verify.** Open the repository homepage in a browser and
  confirm:
  - The maintenance-mode banner appears at the top of the README.
  - The `maintenance-mode` topic is visible under the repo name.
  - The About description reads correctly.

- [ ] **9. Report back.** Notify the Catique HUB team (or update
  ctq-61 in the board) that the freeze announcement has been applied.
