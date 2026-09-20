import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App.js";
import { loadAppearanceFonts } from "./display-fonts.js";
import { loadAppearanceSettings } from "./appearance.js";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

void loadAppearanceFonts(loadAppearanceSettings());

createRoot(root).render(
  import.meta.env.DEV ? (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ) : (
    <App />
  )
);
