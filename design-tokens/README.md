# `design-tokens/` — single source of truth

Hand-edited JSON file describing the design system's primitive and
semantic tokens. The CSS that the app consumes (`src/app/styles/tokens.generated.css`)
is generated from this file by `tools/tokens-build.ts`.

## Workflow

1. Edit `tokens.json` — change a primitive value (e.g. nudge a gold
   shade) or a semantic mapping (e.g. point `color-accent-bg` at a
   different primitive).
2. Run `pnpm tokens:build` — emits `src/app/styles/tokens.generated.css`.
3. Verify visual changes in Storybook (`pnpm storybook`).
4. Commit both `tokens.json` AND `tokens.generated.css`. CI asserts they
   stay in sync.

## File shape

Two top-level blocks:

- `primitive` — physical values, theme-independent. Grouped by category
  (`color`, `space`, `radius`). UI code MUST NOT reference these directly.
- `semantic` — named UI roles, with `light` and `dark` sub-blocks. Values
  are either CSS literals (e.g. `"rgba(23,20,15,0.10)"`) or references
  to a primitive in the form `"{primitive.color.gold-500}"`.

A primitive reference is resolved to its literal at build time; the
generated CSS contains no `var()` chains between layers (keeps the
DevTools view clean — the cascade is tokens → component, not tokens →
tokens → component).

## Adding a new token

1. Add the primitive (if needed) under `primitive.color.*` (or `space`,
   `radius`). Use kebab-case names with a numeric step suffix.
2. Add a semantic mapping in BOTH `semantic.light` AND `semantic.dark`.
   Forgetting one breaks dark theme silently — there's no fallback.
3. Add a JSDoc comment in the consuming component documenting the
   token-pair contrast (light + dark).
4. Run `pnpm tokens:build` and `pnpm test`.

## What's NOT in here

- Typography (font families, sizes, weights, line-heights) lives in
  `src/app/styles/tokens.foundation.css`. Those values change rarely
  and aren't worth a generation step.
- Component-level decisions (button heights, spinner sizes) belong in
  `src/shared/ui/<Component>/<Component>.module.css` — not here.

## Why this lives outside `src/`

Source-of-truth data isn't application code. Putting it at the repo
root makes it discoverable and signals that it's owned by the
design-system process, not the React app.
