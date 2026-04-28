import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { AppProviders } from "./providers";
// Web-fonts. Nunito Variable comes from `@fontsource-variable/nunito`
// (same package Promptery uses) and self-hosts the font files in the
// Vite bundle — no external CDN, no privacy leak. Imported here so the
// browser starts fetching the font weights before any UI renders.
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
