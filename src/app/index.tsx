import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { AppProviders } from "./providers";
// Foundation tokens (typography) come first; generated tokens (colors,
// spacing, radii, light/dark semantic) are emitted by tools/tokens-build.ts
// from design-tokens/tokens.json.
import "./styles/tokens.foundation.css";
import "./styles/tokens.generated.css";
import "./styles/globals.css";

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
