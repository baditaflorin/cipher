import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/cipher/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "docs",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        manualChunks(id) {
          if (
            id.includes("node_modules/react") ||
            id.includes("node_modules/react-dom")
          ) {
            return "react";
          }
          if (
            id.includes("node_modules/libsodium-wrappers") ||
            id.includes("node_modules/yjs")
          ) {
            return "crypto";
          }
          return undefined;
        }
      }
    }
  },
  test: {
    environment: "node",
    setupFiles: "src/test/setup.ts",
    exclude: ["node_modules/**", "dist/**", "docs/**", "tests/e2e/**"],
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
