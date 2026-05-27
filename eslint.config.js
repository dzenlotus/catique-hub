// ESLint flat config — FSD boundaries enforcement.
//
// Catique HUB uses 6 canonical Feature-Sliced Design layers:
//   app  →  pages  →  widgets  →  features  →  entities  →  shared
//
// Imports must travel strictly downward. The `boundaries/dependencies`
// rule below codifies that.
//
// Known existing violations (tracked in docs/audit/fsd-audit-2026-05.md):
//   - widgets/* → app/providers (useToast, ActiveSpaceProvider)
//   - shared    → entities (spacesKeys re-export)
//   - cross-entity (AppErrorInstance in entities/board imported by
//     entities/role-note)
//
// Severity is "warn" today so CI surfaces the count without blocking
// merges. Flip to "error" once the existing violations are cleaned up.
//
// TODO (F5b follow-up): plugin-boundaries v6 selector syntax does not
// surface violations in this config yet — the rule was wired with the
// legacy `boundaries/element-types` API in mind. Migrating fully to
// the v6 object-selector syntax (or downgrading to v5 if v6 churn is
// too costly) is tracked separately. Until then this config documents
// intent and `pnpm lint` runs without crashing.

import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import boundaries from "eslint-plugin-boundaries";
import importPlugin from "eslint-plugin-import";

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
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
      },
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
      "boundaries/dependencies": [
        "warn",
        {
          default: "disallow",
          rules: [
            {
              from: [["app"]],
              allow: [["app"], ["pages"], ["widgets"], ["features"], ["entities"], ["shared"]],
            },
            {
              from: [["pages"]],
              allow: [["widgets"], ["features"], ["entities"], ["shared"]],
            },
            {
              from: [["widgets"]],
              allow: [["features"], ["entities"], ["shared"]],
            },
            {
              from: [["features"]],
              allow: [["entities"], ["shared"]],
            },
            {
              from: [["entities"]],
              allow: [["entities"], ["shared"]],
            },
            {
              from: [["shared"]],
              allow: [["shared"]],
            },
          ],
        },
      ],
    },
  },
];
