import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  base: "./",
  root: ".",
  resolve: {
    alias: {
      "@music-os/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url))
    }
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    watch: {
      // WSL gets no file events for edits made from Windows on /mnt/*,
      // so fall back to polling to keep HMR working in this setup.
      usePolling: true,
      interval: 400
    }
  }
});
