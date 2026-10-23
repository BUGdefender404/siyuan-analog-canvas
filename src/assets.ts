import {
  assetFsPath,
  putBinaryFile,
  putTextFile,
  readDir,
  readTextFile,
  removeFile,
  renameFile,
} from "./api";
import {
  ASSET_PREFIX,
  DATA_ASSET_DIR,
  IMAGE_EXTENSIONS,
  PROJECT_EXT,
  TEMPLATE_URL,
  type ImageExtension,
} from "./constants";
import type { AcAsset } from "./types";

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
    const response = await fetch(TEMPLATE_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Cannot load project template (HTTP ${response.status})`);
    }
    const template = (await response.json()) as Record<string, unknown>;
    template.name = title;
    template.id = `ac-${timestamp()}-${randomId()}`;
    return JSON.stringify(template, null, 2);
  }
}

export function assetUrl(path: string): string {
  return `/${path.replace(/^\/+/u, "")}`;
}
