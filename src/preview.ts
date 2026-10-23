import type { Protyle } from "siyuan";
import { PREVIEW_PATH } from "./constants";
import type { AcAsset } from "./types";

function escapeAttr(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/\n/gu, " ");
}

function blockId(): string {
  const lute = (window as unknown as { Lute?: { NewNodeID?: () => string } }).Lute;
  if (typeof lute?.NewNodeID === "function") {
    try {
      return lute.NewNodeID();
    } catch {
      // Fall through to a local id.
    }
  }
  const stamp = new Date()
    .toISOString()
    .replace(/\D/gu, "")
    .slice(0, 14);
  const random = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) =>
    byte.toString(36).padStart(2, "0"),
  )
    .join("")
    .slice(0, 8);
  return `${stamp}${random}`;
}

export function previewSrc(asset: string, image?: string): string {
  const version = typeof __PLUGIN_VERSION__ === "string" ? __PLUGIN_VERSION__ : "";
  const params = new URLSearchParams({ asset, v: version });
  if (image) params.set("image", image);
  return `${PREVIEW_PATH}?${params.toString()}`;
}

export function insertPreview(
  protyle: Protyle,
  asset: AcAsset,
  height: number,
  image?: string,
): void {
  const id = blockId();
  const iframe = `<iframe frameborder="0" loading="lazy" style="width:100%;height:${Math.max(160, Math.round(height))}px;border:none;display:block;background:transparent;" src="${escapeAttr(previewSrc(asset.path, image))}"></iframe>`;
  const meta = `{: id="${id}" custom-data-assets="${escapeAttr(asset.path)}" custom-ac-title="${escapeAttr(asset.title)}" }`;
  protyle.insert(`${iframe}\n${meta}`, true, true);
}

export function refreshPreviews(asset?: string): void {
  const frames = document.querySelectorAll<HTMLIFrameElement>("iframe");
  for (const frame of frames) {
    let url: URL;
    try {
      url = new URL(frame.src, window.location.href);
    } catch {
      continue;
    }
    if (!url.pathname.endsWith("/editor/preview/siyuan-preview.html")) continue;
    const frameAsset = url.searchParams.get("asset");
    if (!frameAsset) continue;
    if (asset && frameAsset !== asset) continue;
    try {
      frame.contentWindow?.postMessage(
        { __ac: 1, type: "event", event: "refresh" },
        window.location.origin,
      );
    } catch {
      // The frame may have navigated away.
    }
  }
}

export function findPreviewFrames(asset: string): HTMLIFrameElement[] {
  return Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe")).filter((frame) => {
    try {
      const url = new URL(frame.src, window.location.href);
      return (
        url.pathname.endsWith("/editor/preview/siyuan-preview.html") &&
        url.searchParams.get("asset") === asset
      );
    } catch {
      return false;
    }
  });
}
