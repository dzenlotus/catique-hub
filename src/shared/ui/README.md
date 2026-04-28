# `shared/ui` — design-system primitives

Wrappers over `react-aria-components` (RAC), one folder per primitive
(`Button/`, `Dialog/`, `Input/`, …). Each wrapper consumes semantic
tokens from `src/app/styles/tokens.generated.css` (light + dark) plus
`tokens.foundation.css` (typography) via CSS Modules and exposes a
narrow, opinionated React API.

## Decision: no Tailwind

We use CSS Modules + tokens directly, NOT Tailwind. Rationale:

1. Maria's `design-discovery.md` defines a closed semantic-token set —
   `var(--color-accent-bg)` etc. CSS Modules read those directly, so
   tokens stay the single source of truth. With Tailwind we'd be
   maintaining a `tailwind.config.ts` mapping that duplicates the
   token JSON and drifts.
2. The component surface is small (Maria's inventory § 3.1 lists ~10
   primitives for E2). The keystroke savings from Tailwind utility
   classes don't justify the build-toolchain weight (postcss +
   autoprefixer + a JIT step the lockfile must track).
3. E1 ships into Tauri's Chromium/WebKit bundle — we control the
   browser matrix, so we don't need Tailwind's vendor-prefix safety
   net. Native CSS nesting + `:is()` covers what we need.

If a future contributor wants utility classes (e.g. for
quick prototyping in `widgets/*`), they can add Tailwind alongside
without breaking these primitives — CSS Modules are scope-isolated.

## Conventions

- One folder per primitive: `Button/Button.tsx` + `Button.module.css`
  + `Button.test.tsx` + `Button.stories.tsx` + `index.ts`.
- Re-export only the React component and its prop type from
  `index.ts`. Internal helpers stay private.
- All styling uses semantic tokens (`var(--color-...)`, `var(--space-*)`,
  `var(--radius-*)`). Primitive tokens are off-limits.
- Animations and transitions MUST be wrapped in
  `@media (prefers-reduced-motion: reduce) { animation: none; transition: none; }`.
- Each primitive ships at least one Vitest test covering rendered
  output and one RAC behaviour (focus, keyboard, dismiss, etc.).
- Each primitive ships 1-2 Storybook stories per variant.

## Storybook — ENABLED (E2.6)

Run `pnpm storybook` (port 6006) for the visual gallery. Stories live
next to each primitive: `src/shared/ui/<Component>/<Component>.stories.tsx`.
Theme toggle in the toolbar flips `data-theme="dark"|"light"` on
`<html>` so you can verify both.

`pnpm build-storybook` produces a static export at `storybook-static/`
(gitignored). Used as a reviewer-shareable artifact when iterating.

A11y audit runs via `@storybook/addon-a11y` (axe under the hood) on
each story; flagged rules: `color-contrast`, `focus-order-semantics`.
Catique target is WCAG 2.1 AA min, AAA for primary action token-pairs
(NFR-2).

## Tokens — generated from JSON (E2.6)

Source-of-truth: `design-tokens/tokens.json` (two-tier model: primitive
→ semantic, light + dark blocks). `tools/tokens-build.ts` emits
`src/app/styles/tokens.generated.css`. Edit the JSON, run `pnpm tokens:build`,
commit both. CI in E2.7 asserts they stay in sync.

`tokens.foundation.css` (typography only) is hand-written — values change
rarely and aren't worth a generation step.

## Data-fetching — TanStack Query (E2.3)

Entity slices use **`@tanstack/react-query` v5** for IPC query caching.
Wired in `src/app/providers/QueryProvider.tsx` with:

- `staleTime: 30s`, `gcTime: 5min`.
- `refetchOnWindowFocus: false` (Tauri windows always have focus).
- `retry: 1` for transport failures, **0** for `AppErrorInstance`
  (domain errors are deterministic).

Why react-query over hand-rolled `useState + useEffect + Context`:
dedupe, invalidation-on-mutation, and `isPending` / `isError` states
are otherwise replicated per slice. One dependency (MIT, 11 kB gz)
amortises across every entity in E2.x onwards.

---

## Primitive index

### `Button/`
RAC `Button`. Variants: `primary` / `secondary` / `ghost`. Sizes: `sm` / `md` / `lg`.
WCAG token-pair (primary): `--color-accent-fg` on `--color-accent-bg`
→ AAA pass on light + dark. Used everywhere a click commits an action.

### `Dialog/`
RAC `Modal` + `ModalOverlay` + `Dialog` + `Heading`. Single layout
(centered, max-width 480 px). Render-prop `(close) => …` for body.
Used for: confirm-destructive prompts, create-entity flows that
require a focused decision.

### `Input/`
RAC `TextField` + `Input` + `Label` + `FieldError`. Always renders a
visible label (WCAG 3.3.2). Accepts `errorMessage` to flip into invalid
state. Used for: text fields in welcome-flow, settings, task title.

### `Tabs/` — E2.6 (NEW)
RAC `Tabs` + `TabList` + `Tab` + `TabPanel`. Variants: `horizontal`
(default) / `vertical`. WCAG token-pair: `--color-text-default` on
`--color-surface-canvas` (AAA). Used for: settings panes, TaskDialog
sections (overview / prompts / attachments / events).

### `Listbox/` — E2.6 (NEW)
RAC `ListBox` + `ListBoxItem`. Selection: `single` (default) / `multiple`.
Selected items render with a check glyph + accent-soft background
(color + glyph for dalton-friendly dual coding per design-discovery §4).
Used for: Tag picker, Role picker, Skill multiselect.

### `Menu/` — E2.6 (NEW)
RAC `MenuTrigger` + `Popover` + `Menu` + `MenuItem` + `Separator`.
Item variant `default` / `danger` (danger renders red text +
`--color-status-danger-soft` hover). Used for: row-actions on cards,
header app menu.

### `Combobox/` — E2.6 (NEW)
RAC `ComboBox` + `Input` + `ListBox` + `Popover`. Items pre-filtered by
the parent (RAC handles default substring filter; parents pass a fresh
`items` collection on async refresh — no special `loadCallback` API).
Optional `emptyState` slot. Used for: prompt picker, tag autocomplete
in TaskDialog.

### `Tooltip/` — E2.6 (NEW)
RAC `TooltipTrigger` + `Tooltip` + `OverlayArrow`. Placement
`top` (default) / `bottom` / `left` / `right`. Trigger child must be
focusable (a `<Button>` or RAC `<FocusableProvider>`-wrapped element).
Used for: icon-only buttons, truncated text reveal, keyboard-shortcut
hints.
