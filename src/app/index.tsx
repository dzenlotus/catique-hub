import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { AppProviders } from "./providers";
import { LocalStorageStore, stringCodec } from "@shared/storage";
// CSS reset — the-new-css-reset. Full reset (zeroes margin/padding/list-style/
// border/font everywhere). Loaded BEFORE design-token sheets so our `--*`
// rules win over reset defaults (e.g. body color).
import "the-new-css-reset/css/reset.css";
// Web-fonts. JetBrains Mono Variable is the primary UI face; Playfair
// Display Variable is reserved for the wordmark. Self-hosted via
// @fontsource-variable — no external CDN, no privacy leak.
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/playfair-display";
// Foundation tokens (typography) come first; generated tokens (colors,
// spacing, radii, light/dark semantic) are emitted by tools/tokens-build.ts
// from design-tokens/tokens.json.
import "./styles/tokens.foundation.css";
import "./styles/tokens.generated.css";
import "./styles/globals.css";

// Synchronously apply the persisted theme before React mounts to prevent a
// flash of the wrong theme. Goes through `LocalStorageStore` (the single
// source of truth for storage I/O); the store internally swallows errors
// from private-mode / restricted environments.
const themeStore = new LocalStorageStore<string>({
  key: "catique:theme",
  codec: stringCodec,
});
const storedTheme = themeStore.get();
const resolvedTheme: "dark" | "light" =
  storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
document.documentElement.dataset["theme"] = resolvedTheme;
if (storedTheme !== "light" && storedTheme !== "dark") {
  themeStore.set(resolvedTheme);
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
