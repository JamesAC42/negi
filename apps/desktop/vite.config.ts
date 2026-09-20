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
    strictPort: true,
    watch: process.env.MUSIC_OS_VITE_POLL === "1"
      ? {
          // Opt-in polling for editors that do not deliver inotify events.
          usePolling: true,
          interval: 400
        }
      : {
          ignored: ["**/.music-os/**", "**/dist/**"]
        }
  }
});
