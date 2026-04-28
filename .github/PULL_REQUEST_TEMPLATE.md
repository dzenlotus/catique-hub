## Summary

<!-- One or two sentences describing the change and why it is needed. -->

## Linked issue / task

<!-- GitHub issue, Promptery task id (e.g. ctq-XX), or ADR reference. -->

Closes #

## Test plan

- [ ] `pnpm exec tsc --noEmit` passes
- [ ] `pnpm test --run` passes (or the suite genuinely has nothing to run)
- [ ] `cargo fmt --all -- --check` passes
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` passes
- [ ] `cargo test --workspace` passes
- [ ] New or updated tests cover the change (if behaviour changed)

## Quality checklist (NFR §3, §5, §6)

- [ ] No `unwrap()`, `expect()` without proven invariant, `panic!()`,
      `todo!()`, or `unimplemented!()` in production paths
- [ ] No `format!` SQL string concatenation with user input
      (parameterized queries only — NFR §4.3)
- [ ] License of any added dependency is on the allowlist
      (MIT / Apache-2.0 / BSD / ISC / MPL-2.0 / Zlib / Unlicense / CC0)
- [ ] Commit messages follow Conventional Commits
      (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)
- [ ] If this is an architectural change, the relevant ADR in
      promptery's `docs/catique-migration/` (or a new one) is referenced
- [ ] If the DB schema changed, a migration is added and tested

## Screenshots / recordings

<!-- For UI changes only. -->
