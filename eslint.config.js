// ESLint flat config — React-hooks + a11y + FSD boundaries enforcement.
//
// Catique HUB uses 6 canonical Feature-Sliced Design layers:
//   app  →  pages  →  widgets  →  features  →  entities  →  shared
//
// Imports must travel strictly downward. The `boundaries/dependencies`
// rule below codifies that. The selector format is the v6 one
// (`from: ["app"]`, single-level arrays) — the previous config used the
// legacy v5 double-nested form (`from: [["app"]]`) which silently matched
// nothing, so the rule never fired.
//
// Severity is "warn" for boundaries today so CI surfaces the count without
// blocking merges while the tracked violations (docs/audit/fsd-audit-2026-05.md)
// are cleaned up. Flip to "error" once they reach zero.
//
// FIXED (S2.1): the audit's §2.1 "widgets/features/pages → app/providers"
// upward-import violation is resolved. `useToast`/`ToastProvider` and the
// `useActiveSpace` context now live in `@shared/lib` (toast/ + active-space/);
// the `ActiveSpaceProvider` component stays in `app` because it resolves the
// default space via `useSpaces()` (an entity dep `shared` may not take).
// Consumers import `useToast`/`useActiveSpace` downward from `@shared/lib`.
//
// KNOWN GAP: boundaries can only flag a cross-layer import once it can
// classify the *target* module's element, which requires the import
// resolver to resolve the `@app/@entities/@shared/…` path aliases. Under
// ESLint 9 flat config, eslint-import-resolver-typescript v4 currently
// returns `found:false` for our baseUrl-less tsconfig `paths`, so target
// classification (and thus violation detection) is incomplete. The v6
// selector migration + react-hooks/jsx-a11y wiring below are fully live;
// finishing the resolver wiring (or adding an explicit baseUrl) is the
// remaining step to make FSD enforcement bite. Tracked as F5b follow-up.

import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import boundaries from "eslint-plugin-boundaries";
import importPlugin from "eslint-plugin-import";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/**/*.test.{ts,tsx}",
      "src/**/*.spec.{ts,tsx}",
      "src/**/*.stories.{ts,tsx}",
      "src/e2e/**",
    ],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      boundaries,
      import: importPlugin,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    settings: {
      // v4 flat-config resolver API. The legacy `import/resolver: { typescript }`
      // object form silently failed to resolve the `@app/@entities/@shared/…`
      // path aliases, which in turn left boundaries unable to classify import
      // targets (so FSD violations went undetected). The `-next` resolver
      // factory reads tsconfig `paths` correctly.
      "import/resolver-next": [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        }),
      ],
      "boundaries/elements": [
        { type: "app", pattern: "src/app/**/*" },
        { type: "pages", pattern: "src/pages/*", mode: "folder" },
        { type: "widgets", pattern: "src/widgets/*", mode: "folder" },
        { type: "features", pattern: "src/features/*/*", mode: "folder" },
        { type: "entities", pattern: "src/entities/*", mode: "folder" },
        { type: "shared", pattern: "src/shared/**/*" },
      ],
      "boundaries/ignore": [
        "src/types/**",
        "src/**/*.test.*",
        "src/**/*.spec.*",
        "src/**/*.stories.*",
      ],
    },
    rules: {
      // --- React hooks: rules-of-hooks is a real bug class (error);
      //     exhaustive-deps mirrors React's own advisory default (warn). ---
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // --- Accessibility: recommended set, all forced to "warn" so the
      //     count is visible without blocking merges yet (the recommended
      //     preset ships some as error). ---
      ...Object.fromEntries(
        Object.keys(jsxA11y.flatConfigs.recommended.rules).map((rule) => [
          rule,
          "warn",
        ]),
      ),

      // --- FSD layering (v6 object-selector syntax) ---
      "boundaries/dependencies": [
        "warn",
        {
          default: "disallow",
          rules: [
            { from: { type: "app" }, allow: { to: { type: ["app", "pages", "widgets", "features", "entities", "shared"] } } },
            { from: { type: "pages" }, allow: { to: { type: ["pages", "widgets", "features", "entities", "shared"] } } },
            { from: { type: "widgets" }, allow: { to: { type: ["widgets", "features", "entities", "shared"] } } },
            { from: { type: "features" }, allow: { to: { type: ["features", "entities", "shared"] } } },
            { from: { type: "entities" }, allow: { to: { type: ["entities", "shared"] } } },
            { from: { type: "shared" }, allow: { to: { type: ["shared"] } } },
          ],
        },
      ],
    },
  },
];
