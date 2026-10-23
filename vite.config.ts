import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const isDev = process.env.NODE_ENV === "development";
const outputDir = isDev ? "dev" : "dist";
const version = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"),
).version as string;

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: "plugin.json", dest: "." },
        { src: "README*.md", dest: "." },
        { src: "THIRD_PARTY_NOTICES.md", dest: "." },
        { src: "CHANGELOG.md", dest: "." },
        { src: "NOTICE", dest: "." },
        { src: "LICENSE", dest: "." },
        { src: "icon.png", dest: "." },
        { src: "preview.png", dest: "." },
      ],
    }),
  ],
  define: {
    __PLUGIN_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: outputDir,
    emptyOutDir: false,
    minify: !isDev,
    sourcemap: isDev ? "inline" : false,
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      fileName: () => "index.js",
      cssFileName: "index",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: ["siyuan", "process"],
      output: {
        entryFileNames: "[name].js",
        assetFileNames: (assetInfo) =>
          assetInfo.name === "style.css" ? "index.css" : (assetInfo.name ?? "asset"),
      },
    },
  },
});
