/*
 * Storybook 10 — main config (Catique HUB design-system gallery, E2.6).
 *
 * Scope:
 *   - Stories live next to primitives in src/shared/ui/<Component>/<Component>.stories.tsx.
 *   - Entity widgets / FSD widgets are intentionally OUT of scope here —
 *     they assemble shared/ui primitives + IPC; rendering them in
 *     Storybook would need a Tauri-IPC mock, which we don't ship in E2.6.
 *
 * Aliases mirror tsconfig.json + vite.config.ts so stories can import
 * from "@shared/lib", "@shared/ui", etc. without relative paths.
 *
 * Reference:
 *   https://storybook.js.org/docs/get-started/frameworks/react-vite
 */

import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/shared/ui/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-themes"],
  // Storybook 10 ships docs/controls/actions/viewport/backgrounds/measure
  // baked into the manager — no addon-essentials needed.
  docs: {
    defaultName: "Docs",
  },
  typescript: {
    // We use react-docgen-typescript-style prop tables via `react-docgen`
    // (Storybook default in 10.x); no extra config needed for our setup.
    reactDocgen: "react-docgen-typescript",
  },
  async viteFinal(viteConfig) {
    viteConfig.resolve = viteConfig.resolve ?? {};
    viteConfig.resolve.alias = {
      ...(viteConfig.resolve.alias ?? {}),
      "@": fileURLToPath(new URL("../src", import.meta.url)),
      "@app": fileURLToPath(new URL("../src/app", import.meta.url)),
      "@shared": fileURLToPath(new URL("../src/shared", import.meta.url)),
      "@entities": fileURLToPath(new URL("../src/entities", import.meta.url)),
      "@widgets": fileURLToPath(new URL("../src/widgets", import.meta.url)),
      "@bindings": fileURLToPath(new URL("../bindings", import.meta.url)),
    };
    return viteConfig;
  },
};

export default config;
