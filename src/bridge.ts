import { PLUGIN_NAME } from "./constants";
import type { AcAsset, AcVersion, BridgeEvent, SavedFile } from "./types";

export interface BridgeHost {
  readAsset(path: string): Promise<string>;
  listAssets(): Promise<AcAsset[]>;
  listVersions(path: string): Promise<AcVersion[]>;
  saveProject(params: {
    asset: string | null;
    text: string;
    name: string;
    saveAs: boolean;
    autosave?: boolean;
  }): Promise<{ status: "saved"; file: SavedFile } | { status: "cancelled" }>;
  pickAssetForEditor(): Promise<AcAsset | null>;
  pickSaveName(suggestedName: string): Promise<string | null>;
  saveExport(params: {
    asset: string | null;
    name: string;
    mediaType: string;
    bytes: Uint8Array;
    intent: "insert" | "export" | "clipboard";
  }): Promise<{ status: "saved"; path: string } | { status: "cancelled" }>;
  readClipboardText(): Promise<string>;
  openOnlineGallery(): void;
  openEditor(asset: AcAsset): void;
  updateTabTitle(asset: string, title: string): void;
  setEditorDirty(asset: string, dirty: boolean): void;
  requestEditorClose(asset: string): void;
  notify(message: string, type?: "info" | "error"): void;
  libraryAction(params: Record<string, unknown>): Promise<void>;
  duplicateAsset(path: string): Promise<AcAsset>;
}

interface RequestMessage {
  __ac: 1;
  type: "request";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

function isRequest(value: unknown): value is RequestMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<RequestMessage>;
  return (
    message.__ac === 1 &&
    message.type === "request" &&
    typeof message.id === "string" &&
    typeof message.method === "string"
  );
}

function isEvent(value: unknown): value is BridgeEvent {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<BridgeEvent>;
  return message.__ac === 1 && message.type === "event" && typeof message.event === "string";
}

const MAX_CIRCUIT_CLIPBOARD = 16 * 1024 * 1024;

/** The editor's own cross-window copy format; never accept arbitrary JSON. */
export function circuitClipboardText(text: string): string | null {
  if (!text || text.length > MAX_CIRCUIT_CLIPBOARD) return null;
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const envelope = value as {
    format?: unknown;
    version?: unknown;
    project?: unknown;
  };
  if (
    envelope.format !== "analog-canvas/clipboard" ||
    envelope.version !== 1 ||
    !envelope.project ||
    typeof envelope.project !== "object"
  ) {
    return null;
  }
  return text;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export class AcBridge {
  private host: BridgeHost;
  private listener = (event: MessageEvent) => this.onMessage(event);

  constructor(host: BridgeHost) {
    this.host = host;
  }

  attach(): void {
    window.addEventListener("message", this.listener);
  }

  detach(): void {
    window.removeEventListener("message", this.listener);
  }

  private isOurFrame(source: MessageEventSource | null): source is Window {
    if (!source) return false;
    return Array.from(document.querySelectorAll("iframe")).some(
      (frame) =>
        frame.contentWindow === source &&
        frame.src.includes(`/plugins/${PLUGIN_NAME}/editor/`),
    );
  }

  private onMessage(event: MessageEvent): void {
    if (event.origin !== window.location.origin) return;
    if (!this.isOurFrame(event.source)) return;
    const source = event.source;
    if (isRequest(event.data)) {
      void this.reply(source, event.data);
      return;
    }
    if (isEvent(event.data)) {
      void this.onEvent(event.data);
    }
  }

  private async reply(source: Window, message: RequestMessage): Promise<void> {
    try {
      const result = await this.dispatch(message.method, message.params ?? {});
      source.postMessage(
        { __ac: 1, type: "response", id: message.id, result },
        window.location.origin,
      );
    } catch (error) {
      source.postMessage(
        {
          __ac: 1,
          type: "response",
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        },
        window.location.origin,
      );
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "readAsset": {
        const asset = String(params.asset ?? "");
        return { text: await this.host.readAsset(asset) };
      }
      case "listAssets": {
        return { assets: await this.host.listAssets() };
      }
      case "saveProject": {
        return this.host.saveProject({
          asset: typeof params.asset === "string" ? params.asset : null,
          text: String(params.text ?? ""),
          name: String(params.name ?? "untitled.icproj.json"),
          saveAs: Boolean(params.saveAs),
          autosave: params.autosave === true,
        });
      }
      case "pickAsset": {
        const asset = await this.host.pickAssetForEditor();
        if (!asset) return { status: "cancelled" };
        const text = await this.host.readAsset(asset.path);
        return {
          status: "opened",
          file: {
            id: asset.path,
            revision: Date.now(),
            name: asset.fileName,
            path: asset.path,
          },
          text,
        };
      }
      case "pickSaveName": {
        const name = await this.host.pickSaveName(String(params.suggestedName ?? "Untitled"));
        return name ? { name } : { status: "cancelled" };
      }
      case "readCircuitClipboard": {
        const text = await this.host.readClipboardText();
        const payload = circuitClipboardText(text);
        return payload ? { status: "ok", text: payload } : { status: "empty" };
      }
      case "saveExport": {
        return this.host.saveExport({
          asset: typeof params.asset === "string" ? params.asset : null,
          name: String(params.name ?? "export.bin"),
          mediaType: String(params.mediaType ?? "application/octet-stream"),
          bytes: base64ToBytes(String(params.base64 ?? "")),
          intent:
            params.intent === "insert"
              ? "insert"
              : params.intent === "clipboard"
                ? "clipboard"
                : "export",
        });
      }
      case "libraryList": {
        const assets = await this.host.listAssets();
        const recentProjects = assets.slice(0, 8).map((asset) => ({
          id: asset.path,
          name: asset.title,
          path: asset.path,
        }));
        return {
          status: "listed",
          root: "assets/analog-canvas",
          recentProjects,
          projects: assets.map((asset) => ({
            id: asset.path,
            name: asset.title,
            path: asset.path,
            modified: asset.updated,
            favorite: false,
            recycled: false,
          })),
        };
      }
      case "libraryAction": {
        await this.host.libraryAction(params);
        return { status: "done" };
      }
      case "history": {
        const id = String(params.id ?? "");
        const currentText = await this.host.readAsset(id);
        const versions = await this.host.listVersions(id);
        return { status: "listed", currentText, versions };
      }
      case "savedCopy": {
        const id = String(params.id ?? "");
        const text = await this.host.readAsset(id);
        return {
          status: "read",
          name: id.slice(id.lastIndexOf("/") + 1),
          text,
        };
      }
      case "duplicateAsset": {
        const asset = await this.host.duplicateAsset(
          String(params.path ?? params.id ?? ""),
        );
        return { status: "done", asset };
      }
      case "copyToLibrary": {
        await this.host.duplicateAsset(String(params.id ?? ""));
        return { status: "done" };
      }
      case "componentsList":
        return { entries: [] };
      case "openEditor": {
        const assets = await this.host.listAssets();
        const asset = assets.find((item) => item.path === String(params.asset ?? ""));
        if (asset) this.host.openEditor(asset);
        return { status: "done" };
      }
      case "external":
        return { status: "done" };
      case "noop":
        return { status: "done" };
      default:
        throw new Error(`Unsupported host method: ${method}`);
    }
  }

  private async onEvent(message: BridgeEvent): Promise<void> {
    const payload = message.payload ?? {};
    if (message.event === "open-editor") {
      const path = String(payload.asset ?? "");
      const assets = await this.host.listAssets();
      const asset = assets.find((item) => item.path === path);
      if (asset) this.host.openEditor(asset);
      return;
    }
    if (message.event === "title") {
      const path = String(payload.asset ?? "");
      const title = String(payload.title ?? "").trim();
      if (path && title) this.host.updateTabTitle(path, title);
      return;
    }
    if (message.event === "dirty") {
      const path = String(payload.asset ?? "");
      if (path) this.host.setEditorDirty(path, payload.dirty === true);
      return;
    }
    if (message.event === "request-close") {
      const path = String(payload.asset ?? "");
      if (path) this.host.requestEditorClose(path);
      return;
    }
    if (message.event === "open-gallery") {
      this.host.openOnlineGallery();
      return;
    }
    if (message.event === "preview-height") {
      return;
    }
    if (message.event === "preview-error") {
      return;
    }
  }
}
