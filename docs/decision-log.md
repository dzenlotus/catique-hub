# Decision Log

One-line index of architectural decisions. For substance, see the linked ADR.

Format: `D-NN | YYYY-MM-DD | Title | ADR ref`

**Note on numbering:** `docs/release-runbook.md` references `D-018` as the planned entry for the code-signing decision (ctq-62). The entries below are created fresh; if a prior log exists elsewhere in the project, merge and renumber. OQ-6 in ADR-0002 tracks this housekeeping item.

---

| Entry | Date | Decision | ADR |
|---|---|---|---|
| D-001 | 2026-05-01 | MCP sidecar = bundled Node 20 over stdio JSON-RPC | ADR-0002 |
| D-002 | 2026-05-05 | NFR set for Rust stack approved | (no ADR — see nfr-rust-stack.md) |
| D-003 | 2026-05-05 | MCP sidecar spike validated: cold-start 20–40 ms ≪ 2 s budget; Q-1 size revised to +30–35 MB (UPX incompatible with macOS codesign) | ADR-0002 + experiments/sidecar-spike/ |
| D-004 | 2026-05-05 | Resolver strategy: write-time materialisation | ADR-0006 |
| D-005 | 2026-05-05 | MCP server registry-only (v1) | ADR-0007 |
