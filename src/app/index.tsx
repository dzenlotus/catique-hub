import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { AppProviders } from "./providers";
// CSS reset — normalize.css. Loaded BEFORE design-token sheets so our
// `--color-*` rules win over normalize's defaults (e.g. body color).
import "normalize.css";
// Web-fonts. Nunito Variable is the primary UI face; Playfair Display
// Variable is reserved for the wordmark. Self-hosted via
// @fontsource-variable — no external CDN, no privacy leak.
import "@fontsource-variable/nunito";
import "@fontsource-variable/playfair-display";
// Foundation tokens (typography) come first; generated tokens (colors,
// spacing, radii, light/dark semantic) are emitted by tools/tokens-build.ts
// from design-tokens/tokens.json.
import "./styles/tokens.foundation.css";
import "./styles/tokens.generated.css";
import "./styles/globals.css";

// Synchronously apply the persisted theme before React mounts to prevent a
// flash of the wrong theme. Wrapped in try/catch for locked-down browsers
// (private-mode localStorage restrictions, strict CSP, or SSR environments).
try {
  const stored = localStorage.getItem("catique:theme");
  const resolved: "dark" | "light" =
    stored === "light" || stored === "dark" ? stored : "dark";
  document.documentElement.dataset["theme"] = resolved;
  if (stored !== "light" && stored !== "dark") {
    localStorage.setItem("catique:theme", resolved);
  }
} catch {
  /* private mode or restricted environment — silently proceed with default */
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Catique HUB: #root not found in index.html");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
