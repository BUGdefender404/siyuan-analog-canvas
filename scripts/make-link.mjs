import { access, cp, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const NAME = "siyuan-analog-canvas";

function usage() {
  console.log(`Usage: pnpm make-link [--force] [<workspace-or-plugins-dir>]

The target can be a SiYuan workspace directory or its data/plugins directory.
You can also set SIYUAN_PLUGIN_DIR. Without an argument, common workspace
locations are tried. The link points at dist/, so run "pnpm build" first.`);
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function pluginsDir(input) {
  if (!input) return null;
  const absolute = isAbsolute(input) ? input : resolve(process.cwd(), input);
  return absolute.replaceAll("\\", "/").endsWith("/data/plugins")
    ? absolute
    : absolute.replaceAll("\\", "/").endsWith("/plugins")
      ? absolute
      : join(absolute, "data", "plugins");
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const targetArg = args.find((arg) => !arg.startsWith("--"));
const candidates = [
  process.env.SIYUAN_PLUGIN_DIR,
  pluginsDir(targetArg),
  pluginsDir(join(homedir(), "SiYuan")),
  pluginsDir(join(homedir(), "Documents", "SiYuan")),
  pluginsDir(join(homedir(), "OneDrive", "SiYuan")),
].filter(Boolean);

let pluginDir = null;
for (const candidate of candidates) {
  if (await exists(candidate)) {
    pluginDir = candidate;
    break;
  }
}

if (!pluginDir) {
  usage();
  console.error("\nCould not find a SiYuan workspace. Pass its data/plugins directory explicitly.");
  process.exit(1);
}

await mkdir(pluginDir, { recursive: true });
const link = join(pluginDir, NAME);
const source = join(ROOT, "dist");

if (!(await exists(source))) {
  console.error("dist/ does not exist. Run `pnpm build` first.");
  process.exit(1);
}

if (await exists(link)) {
  const current = await readlink(link).catch(() => null);
  if (!force) {
    console.error(`${link} already exists${current ? ` -> ${current}` : ""}. Re-run with --force to replace it.`);
    process.exit(1);
  }
  await rm(link, { recursive: true, force: true });
}

try {
  await symlink(source, link, "dir");
  console.log(`Linked ${link} -> ${source}`);
} catch (error) {
  if (error && error.code !== "EPERM") throw error;
  await cp(source, link, { recursive: true });
  console.log(`Could not create a symlink (Windows needs Developer Mode or admin); copied dist/ to ${link}.`);
  console.log("Re-run this command after each build to refresh the copy.");
}
console.log("Enable the plugin in SiYuan: Settings → Marketplace → Downloaded.");
