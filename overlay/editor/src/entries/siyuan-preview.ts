import { prepareDocumentFormulaArtifacts } from "@icm/derived";
import {
  formalSvgTextFace,
  inlineSchematicWebFontFaceCss,
  withSchematicFontFaces,
} from "@icm/exporters/browser-fonts";
import { parseProject } from "@icm/project-protocol";
import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

const root = document.getElementById("ac-preview-root")!;
const asset = new URLSearchParams(location.search).get("asset") ?? "";

root.innerHTML = `<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #fff; }
  #ac-preview-root { height: 100%; }
  .ac-preview { position: relative; height: 100%; display: flex; align-items: center; justify-content: center; padding: 10px; background: #fff; }
  .ac-preview svg { max-width: 100%; max-height: 100%; width: auto; height: auto; display: block; }
  .ac-preview__empty { font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #6b7280; text-align: center; padding: 24px; }
  .ac-preview__error { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #b91c1c; white-space: pre-wrap; text-align: left; max-height: 100%; overflow: auto; }
  .ac-preview__edit { position: absolute; right: 10px; top: 10px; border: 1px solid rgba(15, 23, 42, .18); border-radius: 7px; background: rgba(255,255,255,.94); color: #0f172a; font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 7px 11px; cursor: pointer; box-shadow: 0 2px 8px rgba(15,23,42,.12); opacity: 0; transition: opacity .15s; }
  .ac-preview:hover .ac-preview__edit, .ac-preview__edit:focus { opacity: 1; }
  .ac-preview__edit:hover { background: #f1f5f9; }
  @media (hover: none) { .ac-preview__edit { opacity: 1; } }
</style>`;

const shell = document.createElement("div");
shell.className = "ac-preview";
root.appendChild(shell);
const edit = document.createElement("button");
edit.className = "ac-preview__edit";
edit.type = "button";
edit.textContent = "编辑";
edit.addEventListener("click", () => {
  parent.postMessage({ __ac: 1, type: "event", event: "open-editor", payload: { asset } }, location.origin);
});
shell.appendChild(edit);

function show(message: string, className: string) {
  const box = document.createElement("div");
  box.className = className;
  box.textContent = message;
  shell.replaceChildren(box, edit);
}

function hostRequest(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("SiYuan host timeout"));
    }, 5000);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin) return;
      const message = event.data as { __ac?: number; type?: string; id?: string; result?: unknown; error?: string };
      if (message?.__ac !== 1 || message.type !== "response" || message.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(message.error));
      else resolve((message.result ?? {}) as Record<string, unknown>);
    };
    window.addEventListener("message", onMessage);
    parent.postMessage({ __ac: 1, type: "request", id, method, params }, location.origin);
  });
}

async function loadText(): Promise<string> {
  const url = "/" + asset.replace(/^\/+/, "");
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) return response.text();
  } catch {
    // Fall back to the plugin bridge, which reads through the SiYuan API.
  }
  const result = await hostRequest("readAsset", { asset });
  const text = result.text;
  if (typeof text !== "string") throw new Error(`Cannot read ${asset}`);
  return text;
}

async function render() {
  try {
    if (!asset) {
      show("No circuit asset selected.", "ac-preview__empty");
      return;
    }
    const text = await loadText();
    const project = parseProject(text);
    const topDocument = project.documents.find((item) => item.id === project.topDocumentId);
    if (!topDocument) throw new Error("The project has no top document.");
    const prepared = await prepareDocumentFormulaArtifacts(topDocument);
    let svg = "";
    try {
      svg = renderDocumentSvg(
        topDocument,
        createProjectSymbolResolver(project, builtInSymbols),
        { background: "#ffffff", margin: 8 },
      );
    } finally {
      prepared.release();
    }
    try {
      const css = await inlineSchematicWebFontFaceCss(fetch, formalSvgTextFace(svg));
      svg = withSchematicFontFaces(svg, css);
    } catch {
      // Preview still draws with the host's fallback faces.
    }
    const figure = document.createElement("div");
    figure.className = "ac-preview";
    figure.style.cssText = "position:absolute;inset:0;";
    figure.innerHTML = svg;
    shell.replaceChildren(figure, edit);
    document.title = `${project.name} — Analog Canvas Preview`;
    parent.postMessage({ __ac: 1, type: "event", event: "preview-title", payload: { asset, title: project.name } }, location.origin);
  } catch (error) {
    show(String(error instanceof Error ? error.message : error), "ac-preview__error");
    parent.postMessage({ __ac: 1, type: "event", event: "preview-error", payload: { asset, message: String(error) } }, location.origin);
  }
}

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  const message = event.data;
  if (message?.__ac === 1 && message.type === "event" && message.event === "refresh") void render();
});

void render();
