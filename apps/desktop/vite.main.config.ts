import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const isPreload = mode === "preload";
  return {
    resolve: {
      alias: {
        "@music-os/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url))
      }
    },
    build: {
      emptyOutDir: false,
      outDir: "dist",
      lib: {
        entry: isPreload ? "src/preload/index.ts" : "src/main/index.ts",
        formats: [isPreload ? "cjs" : "es"],
        fileName: () => (isPreload ? "preload/index.cjs" : "main/index.js")
      },
      rollupOptions: {
        external: ["electron", "node:path", "node:url"]
      }
    }
  };
});
