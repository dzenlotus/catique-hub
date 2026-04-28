# `shared/ui` — design-system primitives

Wrappers over `react-aria-components` (RAC), one folder per primitive
(`Button/`, `Dialog/`, `Input/`, …). Each wrapper consumes semantic
tokens from `src/app/styles/tokens.css` via CSS Modules and exposes a
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
  + `Button.test.tsx` + `index.ts`.
- Re-export only the React component and its prop type from
  `index.ts`. Internal helpers stay private.
- All styling uses semantic tokens (`var(--color-...)`, `var(--space-*)`,
  `var(--radius-*)`). Primitive tokens are off-limits.
- Animations and transitions MUST be wrapped in
  `@media (prefers-reduced-motion: reduce) { animation: none; transition: none; }`.
- Each primitive ships at least one Vitest test covering rendered
  output and one RAC behaviour (focus, keyboard, dismiss, etc.).

## Storybook — deferred to E2.7

Visual gallery / interaction-explorer for these primitives is **deferred
to E2.7** (backlog). E2.x scope is tight, and Storybook + theming
sidecar is its own ~half-day setup. Until then, eyeball changes via:

- The primitives showcase page at `src/app/_demo/Showcase.tsx`
  (import directly when iterating; not wired into the main entry).
- Vitest + `@testing-library/react` for behaviour checks.

When E2.7 lands, point Storybook at the same CSS Modules + tokens —
no migration of existing primitives required.

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
