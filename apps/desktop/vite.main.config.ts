import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const isPreload = mode === "preload";
  return {
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
