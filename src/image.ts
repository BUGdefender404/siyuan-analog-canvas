import { fetchSyncPost } from "siyuan";
import { ASSET_PREFIX, IMAGE_EXTENSIONS, type ImageExtension } from "./constants";
import type { AcAsset } from "./types";

export interface ImageBlockRef {
  id: string;
  imagePath: string;
  ext: ImageExtension;
}

function escapeSql(value: string): string {
  return value.replace(/'/gu, "''");
}

export function imagePathFor(source: string, ext: ImageExtension): string {
  return `${source.replace(/\.icproj\.json$/iu, "")}.${ext}`;
}

export function imageExtension(mediaType: string, name: string): ImageExtension | null {
  const lower = `${mediaType} ${name}`.toLowerCase();
  for (const ext of IMAGE_EXTENSIONS) {
    if (lower.includes(`.${ext}`) || lower.includes(`/${ext}`)) return ext;
  }
  return null;
}

export async function insertImageAfterBlock(
  blockId: string,
  source: AcAsset,
  imagePath: string,
): Promise<void> {
  const response = await fetchSyncPost("/api/block/insertBlock", {
    dataType: "markdown",
    data: `![circuit](${encodeURI(imagePath)})`,
    previousID: blockId,
  });
  if (response.code !== 0) {
    throw new Error(response.msg || "Could not insert the image block");
  }
  const operations = (response.data as Array<{ doOperations?: Array<{ action?: string; id?: string }> }> | null) ?? [];
  const inserted = operations
    .flatMap((entry) => entry.doOperations ?? [])
    .find((operation) => operation.action === "insert" && operation.id);
  if (!inserted?.id) {
    throw new Error("The image block was inserted, but its block id was not returned");
  }
  const attrs = await fetchSyncPost("/api/attr/setBlockAttrs", {
    id: inserted.id,
    attrs: {
      "custom-data-assets": source.path,
      "custom-ac-image": imagePath.endsWith(".svg") ? "svg" : "png",
      "custom-ac-image-path": imagePath,
      "custom-ac-title": source.title,
    },
  });
  if (attrs.code !== 0) {
    throw new Error(attrs.msg || "The image was inserted but its circuit link could not be saved");
  }
}

export async function findImageBlocks(source: string): Promise<ImageBlockRef[]> {
  const response = await fetchSyncPost("/api/query/sql", {
    stmt: `SELECT id, content, ial FROM blocks WHERE ial LIKE '%custom-data-assets="${escapeSql(source)}"%' LIMIT 100`,
  });
  if (response.code !== 0 || !Array.isArray(response.data)) return [];
  const refs: ImageBlockRef[] = [];
  for (const row of response.data as Array<{ id?: unknown; content?: unknown; ial?: unknown }>) {
    const content = String(row.content ?? "");
    const ial = String(row.ial ?? "");
    const stored = /custom-ac-image-path="([^"]+)"/u.exec(ial)?.[1] ?? "";
    const src =
      stored ||
      /(assets\/analog-canvas\/[^\s"]+\.(?:png|svg))/iu.exec(content)?.[1] ||
      /<img[^>]*\bsrc="([^"]+)"/iu.exec(content)?.[1] ||
      "";
    if (!src) continue;
    const clean = src.replace(/^\/+/u, "").replace(/[?#].*$/u, "");
    const ext = clean.match(/\.(png|svg)$/iu)?.[1]?.toLowerCase() as ImageExtension | undefined;
    if (!ext || !IMAGE_EXTENSIONS.includes(ext)) continue;
    refs.push({ id: String(row.id ?? ""), imagePath: clean, ext });
  }
  return refs;
}

export async function referencingBlockIds(source: string): Promise<string[]> {
  const response = await fetchSyncPost("/api/query/sql", {
    stmt: `SELECT id FROM blocks WHERE ial LIKE '%custom-data-assets="${escapeSql(source)}"%' LIMIT 500`,
  });
  if (response.code !== 0 || !Array.isArray(response.data)) return [];
  return (response.data as Array<{ id?: unknown }>).map((row) => String(row.id ?? "")).filter(Boolean);
}

export async function updateSourceReferences(
  oldSource: string,
  nextSource: string,
  nextTitle: string,
): Promise<void> {
  const ids = await referencingBlockIds(oldSource);
  for (const id of ids) {
    await fetchSyncPost("/api/attr/setBlockAttrs", {
      id,
      attrs: {
        "custom-data-assets": nextSource,
        "custom-ac-title": nextTitle,
      },
    });
  }
}

export function isCircuitImage(path: string): boolean {
  return path.startsWith(`${ASSET_PREFIX}/`);
}
