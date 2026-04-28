/*
 * Storybook 10 — preview config (Catique HUB).
 *
 * - Imports tokens.css + globals.css so primitives render with the same
 *   semantic tokens as the live app.
 * - withThemeByDataAttribute toggles `data-theme="dark"|"light"` on
 *   <html>, mirroring how the app switches themes (see
 *   src/app/styles/tokens.css §SEMANTIC LAYER — dark theme override).
 * - Defaults to light theme to match the app's first-run state.
 */

import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Preview } from "@storybook/react-vite";

import "../src/app/styles/tokens.foundation.css";
import "../src/app/styles/tokens.generated.css";
import "../src/app/styles/globals.css";

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // axe rules tuned to NFR-2 (WCAG 2.1 AA min, AAA for primary actions).
      config: {
        rules: [
          { id: "color-contrast", enabled: true },
          { id: "focus-order-semantics", enabled: true },
        ],
      },
    },
    backgrounds: { disable: true }, // tokens drive bg via data-theme
    layout: "centered",
  },
  decorators: [
    withThemeByDataAttribute({
      themes: { light: "light", dark: "dark" },
      defaultTheme: "light",
      attributeName: "data-theme",
      parentSelector: "html",
    }),
  ],
};

export default preview;
