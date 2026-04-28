# `tools/` — repo-local build scripts

Repo-local Node scripts that augment the main app build. Run via `pnpm`
scripts so the working directory is consistent.

## `tokens-build.ts`

Reads `design-tokens/tokens.json` and emits
`src/app/styles/tokens.generated.css` (both `:root` for light theme and
`[data-theme="dark"]` for dark theme overrides).

```sh
pnpm tokens:build
```

Run after editing `design-tokens/tokens.json`. The generated file is
checked into git — CI in E2.7 will assert the file matches what the
script produces from the JSON source. If they drift, the build fails.

### Why no Style Dictionary

The script is ~80 lines of plain TypeScript. Style Dictionary would
add:

- Two transitive dependencies (`style-dictionary` + `node-glob`).
- A config file with our specific `tokens.json` shape.
- A learning curve for any contributor reading the build chain.

For our scale (~50 semantic tokens, two themes, no platform-specific
output), the dependency cost outweighs the simplicity benefit. See the
`dependency-discipline` decision norm. If we ever ship Catique to
multiple platforms (iOS, Android, web) or add a token-pipeline step
(e.g. opacity-modifier transforms), revisit Style Dictionary then.

## Conventions

- Scripts are single-file, ESM (`.ts`), ≤100 lines.
- Run via `tsx` (exact-pinned dev dep). No bundling step.
- Idempotent: running twice in a row produces bit-identical output.
- All paths absolute via `import.meta.url` — never `process.cwd()`.
