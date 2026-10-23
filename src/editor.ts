import { Dialog, openTab } from "siyuan";
import { EDITOR_PATH, ICON_ID, PLUGIN_NAME, TAB_TYPE } from "./constants";
import type { AcAsset } from "./types";

export interface EditorHost {
  app: unknown;
  isMobile: boolean;
  i18n: Record<string, string>;
  updateEditorTabTitle(tabId: string, title: string): void;
}

export interface EditorOptions {
  insert?: boolean;
  update?: boolean;
  format?: "png" | "svg";
}

interface EditorData {
  asset?: string;
  title?: string;
  editorOptions?: EditorOptions;
}

interface EditorRecord {
  asset: string;
  element: HTMLElement;
  iframe: HTMLIFrameElement;
  tabId: string;
  dialog?: Dialog;
}

function currentTheme(): "light" | "dark" {
  try {
    const mode = (window as unknown as { siyuan?: { config?: { appearance?: { mode?: number } } } })
      .siyuan?.config?.appearance?.mode;
    return mode === 0 ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function currentLang(): "zh" | "en" {
  try {
    const lang = (window as unknown as { siyuan?: { config?: { lang?: string } } }).siyuan?.config?.lang;
    return lang?.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

function editorUrl(asset: string, options: EditorOptions = {}): string {
  const params = new URLSearchParams({
    asset,
    theme: currentTheme(),
    lang: currentLang(),
    v: typeof __PLUGIN_VERSION__ === "string" ? __PLUGIN_VERSION__ : "",
  });
  if (options.insert) params.set("insert", "1");
  if (options.update) params.set("update", "1");
  if (options.format) params.set("format", options.format);
  return `${EDITOR_PATH}?${params.toString()}`;
}

export class EditorManager {
  private host: EditorHost;
  private records: EditorRecord[] = [];

  constructor(host: EditorHost) {
    this.host = host;
  }

  isOpen(asset: string): boolean {
    this.records = this.records.filter((record) => record.dialog || record.iframe.isConnected);
    return this.records.some((record) => record.asset === asset);
  }

  open(asset: AcAsset, options: EditorOptions = {}): void {
    this.records = this.records.filter((record) => record.dialog || record.iframe.isConnected);
    const existing = this.records.find(
      (record) => record.asset === asset.path && (record.dialog || record.iframe.isConnected),
    );
    if (existing) {
      if (!this.focus(existing)) {
        console.info("Analog Canvas is already open in another tab", asset.path);
      }
      return;
    }
    if (this.host.isMobile) {
      this.openDialog(asset, options);
      return;
    }
    const data: EditorData = { asset: asset.path, title: asset.title, editorOptions: options };
    void openTab({
      app: this.host.app as never,
      custom: {
        id: `${PLUGIN_NAME}${TAB_TYPE}`,
        icon: ICON_ID,
        title: asset.title,
        data,
      },
    });
  }

  private openDialog(asset: AcAsset, options: EditorOptions): void {
    const holder = document.createElement("div");
    holder.className = "ac-editor-dialog";
    const dialog = new Dialog({
      title: asset.title,
      content: holder.outerHTML,
      width: "100vw",
      height: "100vh",
    });
    const element = dialog.element.querySelector(".b3-dialog__content") as HTMLElement;
    element.classList.add("ac-editor-dialog__content");
    this.mount(
      element,
      { asset: asset.path, title: asset.title, editorOptions: options },
      "",
      dialog,
    );
  }

  mount(
    element: HTMLElement,
    data: EditorData,
    tabId = "",
    dialog?: Dialog,
  ): void {
    const asset = typeof data?.asset === "string" ? data.asset : "";
    if (!asset) {
      element.textContent = this.host.i18n.loadFailed;
      return;
    }
    element.classList.add("ac-editor-host");
    element.style.height = "100%";
    element.style.display = "flex";
    element.style.flexDirection = "column";
    element.innerHTML = "";

    const shell = document.createElement("div");
    shell.className = "ac-editor-shell";
    const loading = document.createElement("div");
    loading.className = "ac-editor-loading";
    loading.textContent = this.host.i18n.editorLoading;
    const iframe = document.createElement("iframe");
    iframe.className = "ac-editor-frame";
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("allow", "clipboard-read; clipboard-write");
    iframe.setAttribute("data-ac-asset", asset);
    iframe.title = asset;
    iframe.src = editorUrl(asset, data.editorOptions);
    shell.append(iframe, loading);
    element.appendChild(shell);
    if (dialog) element.classList.add("ac-editor-dialog__content--active");

    const record: EditorRecord = { asset, element, iframe, tabId, dialog };
    this.records.push(record);

    let loaded = false;
    iframe.addEventListener("load", () => {
      let valid = false;
      try {
        valid = Boolean(iframe.contentDocument?.getElementById("root"));
      } catch {
        valid = false;
      }
      if (!valid) {
        loading.textContent = this.host.i18n.loadFailed;
        return;
      }
      loaded = true;
      shell.classList.add("ac-editor-shell--loaded");
      window.setTimeout(() => loading.remove(), 240);
    });
    window.setTimeout(() => {
      if (!loaded) loading.textContent = this.host.i18n.loadFailed;
    }, 30000);
  }

  updateTitle(asset: string, title: string): void {
    this.records = this.records.filter((record) => record.dialog || record.iframe.isConnected);
    for (const record of this.records) {
      if (record.asset !== asset || !record.tabId) continue;
      this.host.updateEditorTabTitle(record.tabId, title);
    }
  }

  private focus(record: EditorRecord): boolean {
    if (record.dialog) {
      record.dialog.element.style.zIndex = "9999";
      return true;
    }
    const id = record.tabId;
    if (!id) return false;
    const item = document.querySelector(
      `.layout-tab-bar .item[data-id="${CSS.escape(id)}"], .layout-tab .item[data-id="${CSS.escape(id)}"]`,
    ) as HTMLElement | null;
    if (!item) return false;
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  }
}
