import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const EXTERNAL_UPSTREAM = process.env.ANALOG_CANVAS_SRC
  ? resolve(process.env.ANALOG_CANVAS_SRC)
  : null;
const UPSTREAM = EXTERNAL_UPSTREAM ?? join(ROOT, "_upstream");
const PIN = "729cfb1ed7e01f3ba5e56bd1aca41ae03731aab4";
const REPO = "https://github.com/cascode-ai/analog-canvas.git";
const MIRROR = "https://ghfast.top/https://github.com/cascode-ai/analog-canvas.git";

function run(command, args, cwd, extraEnv = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}  (${cwd})`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${result.status}`);
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
}

async function ensureUpstream() {
  if (existsSync(join(UPSTREAM, ".git"))) {
    const head = await git(["rev-parse", "HEAD"], UPSTREAM);
    if (head.status === 0 && head.stdout.trim() === PIN) {
      console.log(`Reusing upstream at ${PIN}`);
      return;
    }
    console.log("Upstream is at a different commit; fetching the pinned commit.");
  } else {
    await rm(UPSTREAM, { recursive: true, force: true });
    await mkdir(UPSTREAM, { recursive: true });
    await git(["init"], UPSTREAM);
  }

  for (const remote of [REPO, MIRROR]) {
    await git(["remote", "remove", "origin"], UPSTREAM);
    await git(["remote", "add", "origin", remote], UPSTREAM);
    console.log(`Fetching ${PIN} from ${remote}`);
    const fetch = await git(["fetch", "--depth", "1", "origin", PIN], UPSTREAM);
    if (fetch.status === 0) {
      const checkout = await git(["checkout", "--detach", "FETCH_HEAD"], UPSTREAM);
      if (checkout.status === 0) {
        await git(["remote", "set-url", "origin", REPO], UPSTREAM);
        return;
      }
    }
    console.warn(`Fetch failed from ${remote}: ${(fetch.stderr || "").trim()}`);
  }
  throw new Error("Could not fetch the pinned Analog Canvas commit from GitHub or the mirror.");
}

async function copyTree(from, to) {
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
}

async function replaceInJs(dir, search, replacement) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await replaceInJs(path, search, replacement);
    } else if (entry.name.endsWith(".js")) {
      const text = await readFile(path, "utf8");
      if (!text.includes(search)) continue;
      await writeFile(path, text.split(search).join(replacement));
    }
  }
}

async function injectHost(editorDir) {
  const shim = await readFile(join(ROOT, "overlay/host/siyuan-host.js"));
  await writeFile(join(editorDir, "siyuan-host.js"), shim);

  const indexPath = join(editorDir, "index.html");
  let html = await readFile(indexPath, "utf8");
  html = html.replace(/\s*<link rel="manifest"[^>]*>/u, "");
  html = html.replace(
    /<head>/iu,
    `<head>\n    <script>try{var t=new URLSearchParams(location.search).get("theme");if(t==="light"||t==="dark")localStorage.theme=t;}catch(e){}</script>`,
  );
  if (!html.includes('src="./siyuan-host.js"')) {
    html = html.replace(
      /<script type="module"[^>]*src="[^"]*"><\/script>/u,
      `<script src="./siyuan-host.js"></script>\n    $&`,
    );
  }
  await writeFile(indexPath, html);

  const favicon = join(UPSTREAM, "apps/editor/public/icon-192.png");
  if (existsSync(favicon)) {
    await cp(favicon, join(editorDir, "tokenzhang-favicon.png"));
    await replaceInJs(join(editorDir, "assets"), "/tokenzhang-favicon.png", "./tokenzhang-favicon.png");
  }
  // The desktop composition uses one fixed workspace id. Each SiYuan tab is
  // its own iframe, so derive the id from the asset path to isolate recovery
  // state between simultaneously open circuits.
  await replaceInJs(
    join(editorDir, "assets"),
    "`desktop-main`",
    '`siyuan-${new URLSearchParams(location.search).get("asset")||"new"}`',
  );
  for (const stale of ["sw.js", "manifest.webmanifest", "desktop-modules.json"]) {
    await rm(join(editorDir, stale), { force: true });
  }

  const license = await readFile(join(UPSTREAM, "LICENSE.md")).catch(() => null);
  if (license) await writeFile(join(editorDir, "LICENSE.md"), license);
  await writeFile(
    join(editorDir, "SOURCE.txt"),
    `Analog Canvas editor bundle\nUpstream: ${REPO}\nCommit: ${PIN}\nLicense: AGPL-3.0-only\nBuilt by: siyuan-analog-canvas/scripts/build-editor.mjs\n`,
  );
}

async function main() {
  if (process.env.AC_SKIP_EDITOR_BUILD === "1" && existsSync(join(ROOT, "dist/editor/index.html"))) {
    console.log("AC_SKIP_EDITOR_BUILD=1 and dist/editor exists; skipping editor build.");
    return;
  }

  if (EXTERNAL_UPSTREAM) {
    if (!existsSync(join(UPSTREAM, "pnpm-workspace.yaml"))) {
      throw new Error(`ANALOG_CANVAS_SRC is not a checkout of Analog Canvas: ${UPSTREAM}`);
    }
    console.log(`Using external upstream checkout: ${UPSTREAM}`);
  } else {
    await ensureUpstream();
    await git(["checkout", "--detach", PIN], UPSTREAM);
  }
  if (process.env.AC_REUSE_UPSTREAM_BUILD !== "1") {
    await run("corepack", ["pnpm", "install", "--frozen-lockfile"], UPSTREAM);
  }

  await mkdir(join(UPSTREAM, "apps/editor/src/entries"), { recursive: true });
  await cp(join(ROOT, "overlay/editor/siyuan-preview.html"), join(UPSTREAM, "apps/editor/siyuan-preview.html"));
  await cp(
    join(ROOT, "overlay/editor/src/entries/siyuan-preview.ts"),
    join(UPSTREAM, "apps/editor/src/entries/siyuan-preview.ts"),
  );
  await cp(
    join(ROOT, "overlay/editor/vite.siyuan-preview.config.ts"),
    join(UPSTREAM, "apps/editor/vite.siyuan-preview.config.ts"),
  );

  if (process.env.AC_REUSE_UPSTREAM_BUILD !== "1") {
    console.log("\nBuilding upstream workspace packages and apps…");
    await run("corepack", ["pnpm", "-r", "--if-present", "build"], UPSTREAM);
  }

  console.log("\nBuilding the offline editor…");
  await rm(join(UPSTREAM, "apps/editor/dist-desktop"), { recursive: true, force: true });
  await run(
    "corepack",
    ["pnpm", "exec", "vite", "build", "--config", "vite.desktop.config.ts", "--base=./"],
    join(UPSTREAM, "apps/editor"),
  );

  console.log("\nBuilding the lightweight SVG preview…");
  await rm(join(UPSTREAM, "apps/editor/dist-siyuan-preview"), { recursive: true, force: true });
  await run(
    "corepack",
    ["pnpm", "exec", "vite", "build", "--config", "vite.siyuan-preview.config.ts"],
    join(UPSTREAM, "apps/editor"),
  );

  const built = join(UPSTREAM, "apps/editor/dist-desktop");
  await copyTree(join(UPSTREAM, "apps/editor/dist-siyuan-preview"), join(built, "preview"));

  const target = join(ROOT, "dist/editor");
  await mkdir(join(ROOT, "dist"), { recursive: true });
  await copyTree(built, target);
  await injectHost(target);

  const size = spawnSync("du", ["-sh", target], { encoding: "utf8" });
  console.log(`\nEditor bundle ready: ${target}`);
  if (size.stdout) console.log(size.stdout.trim());
}

await main();
