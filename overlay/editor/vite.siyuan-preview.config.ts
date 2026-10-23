import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    outDir: "dist-siyuan-preview",
    emptyOutDir: true,
    rolldownOptions: {
      input: resolve(import.meta.dirname, "siyuan-preview.html"),
    },
  },
});
