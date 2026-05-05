# NFR — Rust Stack (Catique HUB)

**Status:** approved  
**Owner:** product-analyst (ctq-59)  
**Date:** 2026-05-01  
**Audience:** tech-analyst making stack trade-off decisions (axum vs actix, sea-orm vs sqlx vs rusqlite, serde_json vs rmp-serde, etc.)  
**Supersedes:** none — first version  
**Reviewed-by:** tech-analyst (ctq-59 sign-off) — 2026-05-05  

---

## Context

Catique HUB is a Tauri 2.x desktop application (macOS + Windows). The Rust side is a 7-crate workspace (`domain`, `application`, `infrastructure`, `api`, `clients`, `sidecar`, `src-tauri`). Current storage layer: SQLite via rusqlite 0.32 + r2d2 pool. Async runtime: tokio 1 (multi-thread). Serialization on the IPC boundary: serde_json. Sidecar IPC (MCP sub-process lifecycle, ADR-0002): serde_json over stdio.

These NFRs define the constraints within which the tech-analyst must make library choices. Any choice that cannot satisfy the gates below must be documented as an ADR rejection.

---

## 1. Performance NFR

### 1.1 IPC command latency (Tauri ↔ Rust round-trip, measured front-end to front-end)

| Command | P50 target | P99 gate (CI-enforced from v1.0) |
|---|---|---|
| `list_boards` (≤ 50 boards) | < 5 ms | < 20 ms |
| `get_task_bundle` (single task + prompts + attachments) | < 10 ms | < 50 ms |
| `search_tasks` (full-text, ≤ 5 000 tasks) | < 30 ms | < 100 ms |

Measurement baseline: MacBook Pro M2, file-backed SQLite WAL, cold pool (first command after app window shows). Benchmarks run via `criterion` in `crates/infrastructure/benches/` (E1 gate: compile + pass; v1.0 gate: P99 assertion in CI using `criterion --bench -- --test`).

Any library that introduces an async-to-sync bridge adding > 5 ms overhead per call (measured via `tokio::time::Instant` in handler) must be rejected or benchmarked with mitigation.

### 1.2 Cold-start (app window visible, DB open, migrations applied)

| Milestone | Gate |
|---|---|
| E1 (MVP) | < 2 000 ms on MacBook Pro M2 |
| v1.0 | < 1 200 ms on MacBook Pro M2; < 2 500 ms on mid-range Windows (Core i5 + SATA SSD) |

Measurement: Tauri `setup` callback → `did-finish-load` webview event. The migration runner (current: `include_dir!`-embedded SQL, idempotent `_migrations` table) must complete within the startup budget — choosing a migration framework that does filesystem discovery at startup is disqualified.

### 1.3 Incremental build time (developer experience gate)

| Metric | Gate |
|---|---|
| `cargo check` after single `.rs` edit in `crates/api` | < 8 s on M2 (GitHub Actions: < 30 s) |
| `cargo build --release` (full, cached registry) | < 4 min on M2 (GitHub Actions: < 12 min) |

Proc-macro-heavy crates (e.g. sea-orm derive macros) may blow this budget. The tech-analyst must measure before locking in.

---

## 2. Footprint NFR

| Metric | E1 gate | v1.0 gate |
|---|---|---|
| Release binary size (`catique-hub` executable, macOS arm64, strip = true) | < 25 MB | < 20 MB |
| Resident Set Size (RSS) at idle (app open, no boards loaded) | < 120 MB | < 80 MB |
| Peak RSS during `search_tasks` over 5 000 tasks | — | < 200 MB |
| SQLite WAL file after 10 000 task inserts + compaction | < 50 MB | < 50 MB |

Measurement tools: `du -sh` for binary, `ps -o rss=` / Instruments for RSS. Current profile: `opt-level = "s"`, `lto = "thin"`, `codegen-units = 1`, `strip = true` (Cargo workspace root). Tech-analyst must justify any profile change against these gates.

An ORM or HTTP framework that pulls in > 3 MB of additional stripped binary size relative to the rusqlite-only baseline requires explicit justification in the ADR.

---

## 3. Reliability NFR

### 3.1 Panic recovery

- **Gate:** No IPC handler panics shall crash the Tauri process. All Tauri commands (`#[tauri::command]`) must return `Result<T, AppError>` — never `unwrap()` / `expect()` on non-test paths. Enforced by `clippy::pedantic` + custom lint or `cargo-semver-checks` step.
- The `[profile.release] panic = "abort"` setting (current workspace root) is intentional — it keeps binary size down. This means any third-party library panic will hard-abort. The tech-analyst must verify that chosen crates do not panic on malformed input at the IPC boundary (fuzz or doc-confirmed).

### 3.2 ACID under crash (storage)

- SQLite WAL mode is mandatory (`PRAGMA journal_mode = WAL` set on every new connection — see `crates/infrastructure/src/db/pool.rs`). Any migration to a different storage backend must provide equivalent crash-safety guarantees (WAL or fsync-on-commit).
- All multi-step DB mutations (e.g. task create + slug counter update) must use a single `IMMEDIATE` transaction. The `rusqlite::Transaction` API already enforces this; any ORM substitute must expose an equivalent synchronous or async transaction scope.
- `PRAGMA foreign_keys = ON` is applied per-connection (pool customizer). Any replacement pool must apply this pragma. Gate: integration test `pragmas_applied_to_new_connection` must remain green.

### 3.3 Connection-pool timeout and retry

- Pool acquire timeout: **500 ms** (`POOL_ACQUIRE_TIMEOUT`). Command returns `AppError::DbBusy` (HTTP 503-equivalent) to the frontend — not a hang.
- SQLite busy timeout: **5 000 ms** per connection (PRAGMA). Chosen because WAL-mode write contention should resolve well under 1 s; 5 s is the outer safety net.
- Any replacement connection-pool library must expose an equivalent `connection_timeout` API with millisecond precision.

### 3.4 Sidecar partial-failure

- If an MCP sidecar process exits unexpectedly, the Tauri process must detect the exit (tokio `wait()` or equivalent), emit a `sidecar:died` event to the frontend, and be ready to restart. It must not leave orphaned OS processes.
- Gate: unit test `sidecar_cleans_up_child_on_drop` (to be authored in `crates/sidecar/`) asserts `Child::try_wait()` returns `Some(_)` after a simulated kill within 200 ms.

---

## 4. Security NFR

### 4.1 Secret handling

- API keys and tokens are stored in the OS keychain: macOS Keychain Services / Windows Credential Manager. **No secrets are stored in SQLite or on disk in plaintext.** Any crate providing keychain access must not link against deprecated Security.framework APIs flagged by Apple's `security-framework` crate (current candidate) as of macOS 14.
- Gate: `cargo audit` in CI must report zero known vulnerabilities (`RUSTSEC-*`) in the dependency tree. Blocking: any advisory in the `secret` / `crypto` / `auth` category.

### 4.2 Input validation at the IPC boundary

- All `#[tauri::command]` inputs are deserialized from untrusted JSON (renderer). String fields must be validated for maximum length before DB insertion:
  - `title`: max 500 characters.
  - `description`: max 50 000 characters.
  - `slug` components: `[a-z0-9\-]`, max 32 characters.
- Validation must occur in the `application` layer (use-case), not the `api` layer alone, so it is testable without Tauri.
- Gate: unit tests cover the above limits with at-limit and over-limit inputs. CI fails if tests are absent (`cargo test --workspace` must include at least 3 validation tests per entity in `crates/application/tests/`).

### 4.3 SQL injection protection

- rusqlite parameterized queries (`params![]` / named params) are mandatory for all user-supplied values. String interpolation into SQL is forbidden. Enforced by code review and, where tooling allows, a custom Clippy lint or `audit-sql` step.
- Any ORM alternative must use prepared statements by default. The tech-analyst must document which API surfaces could produce dynamic SQL and confirm they are gated.
- Gate: `sqlfluff` or `grep -rn "execute.*format!"` CI check must return zero matches in `crates/infrastructure/src/`.

---

## 5. Maintainability NFR

### 5.1 Test coverage gate

| Milestone | Branch coverage threshold (llvm-cov) |
|---|---|
| E1 (milestone gate) | 75% branches across `crates/` (excluding `src-tauri/`) |
| v1.0 | 85% branches across `crates/` (excluding `src-tauri/`) |

Measurement: `cargo llvm-cov --workspace --branch --ignore-filename-regex='src-tauri'`. CI step added from E1. Coverage dropping below threshold blocks merge to `main`.

### 5.2 Lint gate

- `clippy::pedantic` at `deny` level for all new code in all workspace crates (`[lints.clippy] pedantic = { level = "deny" }` is already set in each `Cargo.toml`).
- Allowed exceptions must be listed explicitly per crate (no `#![allow(clippy::all)]` blankets).
- New crates added by the tech-analyst (e.g. an axum/actix integration crate) must inherit the same lint config — no opt-out.
- `cargo fmt --check` enforced in CI. Nightly format features are not permitted (ensures stable toolchain builds pass).

### 5.3 Dependency hygiene

- Exact-pinned (`=x.y.z`) for crates on the IPC/storage contract boundary: `serde`, `serde_json`, `rusqlite`, `r2d2`, `r2d2_sqlite`, `include_dir`, `nanoid`, `sha2`. Any new crate touching the IPC payload schema or the DB schema must be exact-pinned.
- All other crates: caret SemVer (`^x.y.z`). No `*` version specifiers.
- `cargo deny` check in CI: `deny = ["unmaintained"]` for crates with no commit activity in the last 24 months, `deny = ["duplicate"]` for duplicate major versions of the same crate.
- MSRV: `rust-version = "1.81"` (workspace). Any new crate dependency must compile on Rust 1.81 stable.

---

## 6. License NFR

- **Allowed:** Apache-2.0, MIT, MPL-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0, Unlicense (public-domain equivalent).
- **Forbidden:** AGPL-3.0, SSPL-1.0, Commons Clause overlays, any "non-commercial use" restriction, any license incompatible with Elastic License 2.0 (product license, `[workspace.package] license = "Elastic-2.0"`).
- Specifically: `sea-orm` (Apache-2.0 — allowed), `sqlx` (MIT — allowed), `axum` (MIT — allowed), `actix-web` (MIT/Apache-2.0 — allowed). The tech-analyst must verify transitive deps via `cargo deny check licenses`.
- Gate: `cargo deny check licenses` in CI with `deny = ["AGPL-3.0", "SSPL-1.0"]` in `deny.toml`. Blocks merge on first violation.
- Note on bundled SQLite (`rusqlite` `bundled` feature): SQLite source code is public domain — no license issue. This remains the preferred approach for Windows shipping (avoids system libsqlite version mismatch).

---

## 7. Acceptance Criteria for the Chosen Stack

The tech-analyst's output ADR must demonstrate that the chosen combination satisfies each gate below. A trade-off matrix row-per-library against each axis is sufficient for AC-1.

### AC-1: Trade-off matrix axes (NFR-grounded)

When comparing alternatives (e.g. axum vs actix, sea-orm vs sqlx vs rusqlite, serde_json vs rmp-serde), the matrix must include one column per the following NFR axes:

1. **IPC P99 latency** — measured or justified against the § 1.1 targets.
2. **Binary size delta** — stripped release binary diff from the rusqlite baseline.
3. **Cold-start overhead** — startup time contribution of the crate's initialization (connection pool open, macro-generated code, etc.).
4. **Panic surface** — does the crate panic on malformed input? (yes/no + mitigation).
5. **License** — confirmed allowed per § 6.
6. **MSRV compatibility** — compiles on Rust 1.81.
7. **Proc-macro / compile-time cost** — incremental `cargo check` time delta.

### AC-2: CI-enforced gates (E1+)

The following checks must be green in CI from E1 onwards. Additions made by the chosen stack must not break any existing gate:

| Gate | Tool | Failure action |
|---|---|---|
| Binary size ≤ 25 MB (release, macOS arm64) | `du -sh` step post-`cargo build --release` | Blocks merge |
| Branch coverage ≥ 75% | `cargo llvm-cov --branch` | Blocks merge |
| Zero `cargo audit` high-severity advisories | `cargo audit` | Blocks merge |
| License allowlist | `cargo deny check licenses` | Blocks merge |
| Lint clean | `cargo clippy --workspace -- -D warnings` | Blocks merge |
| Format clean | `cargo fmt --check` | Blocks merge |

v1.0 additionally enforces: P99 latency assertions in criterion benchmarks, branch coverage ≥ 85%, binary size ≤ 20 MB.

---

## Open Assumptions

1. **No embedded HTTP server in E1.** The current architecture has no in-process HTTP server (all IPC goes through Tauri's invoke bridge). If a future ctq adds an HTTP API (e.g. for local MCP server mode), axum/actix NFRs will need an addendum covering port binding, TLS, and request-size limits. This document does not cover that surface.

2. **serde_json vs rmp-serde for sidecar IPC.** The sidecar protocol (ADR-0002, ctq-56) currently uses `serde_json` over stdio. `rmp-serde` (MessagePack) would reduce serialization overhead but changes the protocol format, requiring MCP client compatibility testing. This NFR assumes serde_json remains the sidecar protocol unless the tech-analyst's benchmark shows > 10 ms per-message overhead at 95th percentile — at which point the decision must be ADR'd separately.

3. **Windows binary size baseline is unknown.** The 25 MB gate was set against a macOS arm64 measurement. MSVC toolchain and Windows CRT linkage may produce larger binaries. The tech-analyst must measure on Windows before v1.0 and propose a revised gate if needed.
