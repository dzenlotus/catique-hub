import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { AppProviders } from "./providers";
import "./styles/tokens.css";
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
