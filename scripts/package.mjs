import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { zipSync } from "fflate";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const REQUIRED = [
  "plugin.json",
  "index.js",
  "README.md",
  "README_zh_CN.md",
  "icon.png",
  "preview.png",
  "editor/index.html",
  "editor/siyuan-host.js",
  "editor/preview/siyuan-preview.html",
];

async function walk(dir) {
  const files = {};
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await walk(path));
    } else {
      const key = relative(DIST, path).replaceAll("\\", "/");
      if (key === "package.zip") continue;
      files[key] = new Uint8Array(await readFile(path));
    }
  }
  return files;
}

for (const file of REQUIRED) {
  try {
    await stat(join(DIST, file));
  } catch {
    console.error(`Missing required package file: dist/${file}`);
    process.exit(1);
  }
}

const files = await walk(DIST);
const zip = zipSync(files, { level: 6 });
await writeFile(join(ROOT, "package.zip"), zip);
console.log(`package.zip: ${(zip.byteLength / 1024 / 1024).toFixed(1)} MiB, ${Object.keys(files).length} files`);
