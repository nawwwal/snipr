import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Build from the extension HTML folder so emitted pages are `editor.html`, not `src/extension/...`.
  root: path.join(rootDir, "src/extension"),
  // Relative asset URLs so scripts load under chrome-extension://<id>/...
  base: "./",
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.join(rootDir, "src"),
    },
  },
  build: {
    outDir: path.join(rootDir, "extension"),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        editor: path.join(rootDir, "src/extension/editor.html"),
        unsupported: path.join(rootDir, "src/extension/unsupported.html"),
        background: path.join(rootDir, "src/extension/background.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        format: "es",
      },
    },
  },
});
