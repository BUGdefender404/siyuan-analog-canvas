import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function run(command, args, env = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await rm(resolve(ROOT, "dist"), { recursive: true, force: true });
run("corepack", ["pnpm", "exec", "vite", "build"], { NODE_ENV: "production" });
run("node", ["scripts/build-editor.mjs"]);
console.log("\nBuild complete: dist/");
