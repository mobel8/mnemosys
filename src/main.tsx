import React from "react";
import ReactDOM from "react-dom/client";
// Self-hosted variable fonts (offline-safe — bundled by Vite, no CDN).
// Display: Space Grotesk · Body/UI: Inter · Numbers/mono: JetBrains Mono.
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import App from "./App";
import "./styles/globals.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
