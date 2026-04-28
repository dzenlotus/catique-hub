# `bindings/` — auto-generated Rust → TypeScript types

Owned by `ts-rs` 8.x macros in `crates/domain` and `crates/api`. **Do not
hand-edit.** Any change here is reverted on next `cargo test`.

## Regenerate

```bash
cargo test -p catique-domain
cargo test -p catique-api
```

Each `#[derive(TS)] #[ts(export, export_to = "../../bindings/")]` struct
emits one `.ts` file plus, on `cargo test`, an
`export_bindings_<TypeName>` test that performs the actual write.

## Check-in policy (E1.2 decision — Olga)

**The `.ts` files ARE checked into git** (no `bindings/*.ts` entry in
`.gitignore`). Rationale:

- Files are small (each entity ≈ 10–20 lines of TS) and deterministic
  output of ts-rs given pinned `=8.1.0`.
- The UI (`src/`) compiles via Vite without ever invoking Cargo; if the
  bindings weren't committed, a fresh clone couldn't `pnpm build` until
  Rust toolchain was installed and `cargo test` had run. That breaks the
  Promptery muscle-memory flow `pnpm i && pnpm dev`.
- Diffs in bindings during a PR are a useful review signal — they show
  IPC contract changes at a glance.

**CI gate (E2 to wire):** run `cargo test -p catique-domain -p catique-api`
then `git diff --exit-code bindings/`; non-empty diff → red. Prevents
"Rust struct changed but bindings stale" from sneaking in.

## Layout

```
bindings/
├── Space.ts
├── Board.ts
├── Column.ts
├── Task.ts
├── Prompt.ts
├── Role.ts
├── Tag.ts
├── AgentReport.ts
├── Attachment.ts
└── AppError.ts
```
