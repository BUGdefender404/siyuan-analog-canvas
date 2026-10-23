import {
  assetFsPath,
  putBinaryFile,
  putTextFile,
  readBinaryFile,
  readDir,
  readTextFile,
  removeFile,
  renameFile,
} from "./api";
import {
  ASSET_PREFIX,
  DATA_ASSET_DIR,
  HISTORY_DIR,
  IMAGE_EXTENSIONS,
  PROJECT_EXT,
  TEMPLATE_DIR,
  type ImageExtension,
} from "./constants";
import type { AcAsset, AcTemplate, AcVersion, DirEntry } from "./types";

const SUFFIX = /-(\d{14})-([a-z0-9]{7})$/u;

function timestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

function randomId(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 7);
}

export function sanitizeTitle(value: string): string {
  const cleaned = value
    .replace(/\.icproj\.json$/iu, "")
    .replace(/\.icproj$/iu, "")
    .replace(/[\\/:*?"<>|]/gu, "_")
    .replace(/\s+/gu, " ")
    .replace(/^[.\s]+|[.\s]+$/gu, "")
    .slice(0, 80);
  return cleaned || "untitled";
}

export function titleFromFileName(fileName: string): string {
  const base = fileName.endsWith(PROJECT_EXT)
    ? fileName.slice(0, -PROJECT_EXT.length)
    : fileName;
  return base.replace(SUFFIX, "");
}

function newFileName(title: string): string {
  return `${sanitizeTitle(title)}-${timestamp()}-${randomId()}${PROJECT_EXT}`;
}

function validateAssetPath(path: string): void {
  const normalized = path.replace(/^\/+/u, "");
  if (!normalized.startsWith(`${ASSET_PREFIX}/`) || normalized.includes("..")) {
    throw new Error(`Invalid circuit asset path: ${path}`);
  }
}

function toAsset(path: string, updated = Date.now()): AcAsset {
  const normalized = path.replace(/^\/+/u, "");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  const stamp = updated > 0 && updated < 1e12 ? updated * 1000 : updated;
  return {
    path: normalized,
    fileName,
    title: titleFromFileName(fileName),
    updated: stamp,
  };
}

function historyStamp(name: string, prefix: string): number {
  const digits = name.slice(prefix.length, prefix.length + 14);
  if (!/^\d{14}$/u.test(digits)) return 0;
  const date = new Date(
    Number(digits.slice(0, 4)),
    Number(digits.slice(4, 6)) - 1,
    Number(digits.slice(6, 8)),
    Number(digits.slice(8, 10)),
    Number(digits.slice(10, 12)),
    Number(digits.slice(12, 14)),
  );
  return date.getTime();
}

function projectBase(source: AcAsset): string {
  return source.fileName.slice(0, -PROJECT_EXT.length);
}

export class AssetStore {
  async list(): Promise<AcAsset[]> {
    let entries;
    try {
      entries = await readDir(DATA_ASSET_DIR);
    } catch {
      return [];
    }
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((entry) => !entry.isDir && entry.name.endsWith(PROJECT_EXT))
      .map((entry) => toAsset(`${ASSET_PREFIX}/${entry.name}`, entry.updated))
      .sort((left, right) => right.updated - left.updated || left.title.localeCompare(right.title));
  }

  async read(path: string): Promise<string> {
    validateAssetPath(path);
    return readTextFile(assetFsPath(path));
  }

  async saveText(path: string, text: string): Promise<AcAsset> {
    validateAssetPath(path);
    const normalized = path.replace(/^\/+/u, "");
    const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
    await putTextFile(assetFsPath(normalized), text, fileName);
    return toAsset(normalized);
  }

  async create(title: string, text?: string): Promise<AcAsset> {
    const body = text ?? (await this.blankProject(title));
    const path = `${ASSET_PREFIX}/${newFileName(title)}`;
    return this.saveText(path, body);
  }

  async saveAs(title: string, text: string): Promise<AcAsset> {
    return this.create(title, text);
  }

  async duplicate(path: string): Promise<AcAsset> {
    const text = await this.read(path);
    const source = toAsset(path);
    return this.create(`${source.title} copy`, text);
  }

  async rename(path: string, newTitle: string): Promise<AcAsset> {
    const source = toAsset(path);
    const match = source.fileName.slice(0, -PROJECT_EXT.length).match(SUFFIX);
    const suffix = match ? `-${match[1]}-${match[2]}` : `-${timestamp()}-${randomId()}`;
    const newPath = `${ASSET_PREFIX}/${sanitizeTitle(newTitle)}${suffix}${PROJECT_EXT}`;
    if (newPath === source.path) return source;
    await renameFile(assetFsPath(source.path), assetFsPath(newPath));
    return toAsset(newPath);
  }

  async remove(path: string): Promise<void> {
    validateAssetPath(path);
    await removeFile(assetFsPath(path));
    await this.removeHistory(path);
  }

  private async removeHistory(path: string): Promise<void> {
    const prefix = `${projectBase(toAsset(path))}.`;
    let entries: DirEntry[] = [];
    try {
      entries = await readDir(assetFsPath(HISTORY_DIR));
    } catch {
      return;
    }
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (
        entry.isDir ||
        !entry.name.startsWith(prefix) ||
        !entry.name.endsWith(PROJECT_EXT)
      ) {
        continue;
      }
      await removeFile(assetFsPath(`${HISTORY_DIR}/${entry.name}`)).catch(() => undefined);
    }
  }

  async saveBinaryAt(
    path: string,
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<AcAsset> {
    validateAssetPath(path);
    const normalized = path.replace(/^\/+/u, "");
    const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
    await putBinaryFile(assetFsPath(normalized), bytes, fileName, mediaType);
    return toAsset(normalized);
  }

  async readBinary(path: string): Promise<Uint8Array> {
    validateAssetPath(path);
    return readBinaryFile(assetFsPath(path));
  }

  /** Keep the previous contents before a save, at most once per interval. */
  async snapshot(
    path: string,
    text: string,
    options: { minInterval?: number; limit?: number } = {},
  ): Promise<void> {
    const source = toAsset(path);
    const prefix = `${projectBase(source)}.`;
    let entries: DirEntry[] = [];
    try {
      entries = await readDir(assetFsPath(HISTORY_DIR));
    } catch {
      entries = [];
    }
    if (!Array.isArray(entries)) entries = [];
    const history = entries
      .filter(
        (entry) =>
          !entry.isDir && entry.name.startsWith(prefix) && entry.name.endsWith(PROJECT_EXT),
      )
      .sort((left, right) => right.name.localeCompare(left.name));
    const latest = history[0];
    if (latest) {
      const savedAt =
        latest.updated && latest.updated > 0
          ? latest.updated * 1000
          : historyStamp(latest.name, prefix);
      if (options.minInterval && savedAt > 0 && Date.now() - savedAt < options.minInterval) {
        return;
      }
      try {
        const previous = await readTextFile(assetFsPath(`${HISTORY_DIR}/${latest.name}`));
        if (previous === text) return;
      } catch {
        // A damaged snapshot must not block the project save.
      }
    }
    const name = `${projectBase(source)}.${timestamp()}-${randomId()}${PROJECT_EXT}`;
    await putTextFile(assetFsPath(`${HISTORY_DIR}/${name}`), text, name);
    await this.pruneHistory(prefix, options.limit ?? 20);
  }

  async versions(path: string): Promise<AcVersion[]> {
    const source = toAsset(path);
    const prefix = `${projectBase(source)}.`;
    let entries: DirEntry[] = [];
    try {
      entries = await readDir(assetFsPath(HISTORY_DIR));
    } catch {
      entries = [];
    }
    if (!Array.isArray(entries)) return [];
    const names = entries
      .filter(
        (entry) =>
          !entry.isDir && entry.name.startsWith(prefix) && entry.name.endsWith(PROJECT_EXT),
      )
      .sort((left, right) => right.name.localeCompare(left.name))
      .slice(0, 100);
    const versions: AcVersion[] = [];
    for (const entry of names) {
      try {
        const text = await readTextFile(assetFsPath(`${HISTORY_DIR}/${entry.name}`));
        const savedAt =
          entry.updated && entry.updated > 0
            ? entry.updated * 1000
            : historyStamp(entry.name, prefix) || Date.now();
        versions.push({ id: entry.name, savedAt, text });
      } catch {
        // Skip a snapshot that vanished while reading the list.
      }
    }
    return versions;
  }

  async readVersion(path: string, id: string): Promise<string> {
    return readTextFile(assetFsPath(this.versionPath(path, id)));
  }

  async moveHistory(oldPath: string, newPath: string): Promise<void> {
    const oldSource = toAsset(oldPath);
    const newSource = toAsset(newPath);
    const oldPrefix = `${projectBase(oldSource)}.`;
    const newPrefix = projectBase(newSource);
    let entries: DirEntry[] = [];
    try {
      entries = await readDir(assetFsPath(HISTORY_DIR));
    } catch {
      return;
    }
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (
        entry.isDir ||
        !entry.name.startsWith(oldPrefix) ||
        !entry.name.endsWith(PROJECT_EXT)
      ) {
        continue;
      }
      const nextName = `${newPrefix}.${entry.name.slice(oldPrefix.length)}`;
      await renameFile(
        assetFsPath(`${HISTORY_DIR}/${entry.name}`),
        assetFsPath(`${HISTORY_DIR}/${nextName}`),
      ).catch(() => undefined);
    }
  }

  async restoreVersion(path: string, id: string, limit: number): Promise<AcAsset> {
    const text = await this.readVersion(path, id);
    const current = await this.read(path);
    if (current !== text) {
      await this.snapshot(path, current, { limit });
    }
    return this.saveText(path, text);
  }

  async branchVersion(path: string, id: string, title: string): Promise<AcAsset> {
    const text = await this.readVersion(path, id);
    let body = text;
    try {
      const project = JSON.parse(text) as Record<string, unknown>;
      project.name = sanitizeTitle(title);
      project.id = `ac-${timestamp()}-${randomId()}`;
      body = JSON.stringify(project, null, 2);
    } catch {
      // Keep the snapshot text when it is not a JSON project.
    }
    return this.create(sanitizeTitle(title), body);
  }

  async createFromTemplate(title: string, template: AcTemplate): Promise<AcAsset> {
    if (
      !template.file ||
      template.file.includes("..") ||
      template.file.includes("/") ||
      template.file.includes("\\")
    ) {
      throw new Error(`Invalid template file: ${template.file}`);
    }
    const project = await this.loadTemplate(template.file);
    project.name = title;
    project.id = `ac-${timestamp()}-${randomId()}`;
    return this.create(title, JSON.stringify(project, null, 2));
  }

  private versionPath(path: string, id: string): string {
    const source = toAsset(path);
    const prefix = `${projectBase(source)}.`;
    if (
      !id.startsWith(prefix) ||
      !id.endsWith(PROJECT_EXT) ||
      id.includes("..") ||
      id.includes("/") ||
      id.includes("\\")
    ) {
      throw new Error(`Invalid history version: ${id}`);
    }
    return `${HISTORY_DIR}/${id}`;
  }

  private async pruneHistory(prefix: string, limit: number): Promise<void> {
    const keep = Math.min(100, Math.max(5, Math.round(limit)));
    let entries: DirEntry[] = [];
    try {
      entries = await readDir(assetFsPath(HISTORY_DIR));
    } catch {
      return;
    }
    if (!Array.isArray(entries)) return;
    const stale = entries
      .filter(
        (entry) =>
          !entry.isDir && entry.name.startsWith(prefix) && entry.name.endsWith(PROJECT_EXT),
      )
      .sort((left, right) => right.name.localeCompare(left.name))
      .slice(keep);
    for (const entry of stale) {
      await removeFile(assetFsPath(`${HISTORY_DIR}/${entry.name}`)).catch(() => undefined);
    }
  }

  async imageFor(
    source: AcAsset,
  ): Promise<{ path: string; ext: ImageExtension } | null> {
    let entries;
    try {
      entries = await readDir(DATA_ASSET_DIR);
    } catch {
      return null;
    }
    if (!Array.isArray(entries)) return null;
    const base = source.fileName.slice(0, -PROJECT_EXT.length);
    for (const ext of IMAGE_EXTENSIONS) {
      const fileName = `${base}.${ext}`;
      if (entries.some((entry) => !entry.isDir && entry.name === fileName)) {
        return { path: `${ASSET_PREFIX}/${fileName}`, ext };
      }
    }
    return null;
  }

  private async blankProject(title: string): Promise<string> {
    const template = await this.loadTemplate("blank.icproj.json");
    template.name = title;
    template.id = `ac-${timestamp()}-${randomId()}`;
    return JSON.stringify(template, null, 2);
  }

  private async loadTemplate(file: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${TEMPLATE_DIR}/${encodeURIComponent(file)}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Cannot load project template (HTTP ${response.status})`);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}

export function assetUrl(path: string): string {
  return `/${path.replace(/^\/+/u, "")}`;
}
