import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "./",
  root: ".",
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
