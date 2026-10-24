import {
  fetchSyncPost,
  getFrontend,
  Plugin,
  showMessage,
  type Custom,
  type Protyle,
} from "siyuan";
import "./index.css";
import { AssetStore, sanitizeTitle, titleFromFileName } from "./assets";
import { AcBridge, type BridgeHost } from "./bridge";
import {
  ASSET_PREFIX,
  DEFAULT_PREVIEW_HEIGHT,
  DOCK_TYPE,
  GALLERY_DOCK_TYPE,
  GALLERY_ICON_ID,
  GALLERY_TAB_TYPE,
  ICON_ID,
  PLUGIN_NAME,
  TAB_TYPE,
} from "./constants";
import {
  chooseDirectory,
  copyPngToClipboard,
  copySvgToClipboard,
  readClipboardText as readSystemClipboard,
  saveFileAs,
} from "./desktop";
import { closeGuardDialog, confirmDialog, promptText } from "./dialog";
import { AssetDock } from "./dock";
import { EditorManager, type EditorHost, type EditorRecord } from "./editor";
import { GalleryManager } from "./gallery";
import { openHistoryDialog } from "./history";
import type { PluginHost } from "./host";
import { importProjectFile as importProjectFromFile } from "./import";
import {
  findImageBlocks,
  imageExtension,
  imagePathFor,
  insertImageAfterBlock,
  referencingBlockIds,
  updateSourceReferences,
} from "./image";
import { AssetPicker } from "./picker";
import { insertPreview, refreshPreviews } from "./preview";
import { openSettings, type SettingsHost } from "./settings";
import type { AcAsset, AcSettings, AcVersion, ImageFormat, SavedFile } from "./types";

interface PendingInsert {
  blockId: string;
  title: string;
  format: ImageFormat;
}

export default class AnalogCanvasPlugin
  extends Plugin
  implements PluginHost, EditorHost, BridgeHost, SettingsHost
{
  settings: AcSettings = {
    previewHeight: DEFAULT_PREVIEW_HEIGHT,
    insertMode: "image",
    imageFormat: "png",
    exportDir: "",
    exportScale: 3,
    autosave: true,
    historyLimit: 20,
    editorTopBar: true,
    galleryDock: true,
  };
  assetStore = new AssetStore();
  isMobile = false;

  private bridge!: AcBridge;
  private editorManager!: EditorManager;
  private galleryManager!: GalleryManager;
  private picker!: AssetPicker;
  private dock!: AssetDock;
  private pendingInserts = new Map<string, PendingInsert>();
  private dirtyAssets = new Set<string>();
  private dirtyWaiters = new Map<string, Array<(dirty: boolean) => void>>();
  private allowCloseTab = "";
  private topBar?: HTMLElement;

  async onload(): Promise<void> {
    this.isMobile = ["mobile", "browser-mobile"].includes(getFrontend());
    await this.loadSettings();
    this.bridge = new AcBridge(this);
    this.editorManager = new EditorManager(this);
    this.galleryManager = new GalleryManager(this);
    this.picker = new AssetPicker(this);
    this.dock = new AssetDock(this);
    this.bridge.attach();

    this.addIcons(`<symbol id="${ICON_ID}" viewBox="0 0 32 32">
  <path d="M4 9v14M8 9v14M13 12v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M13 14l3.5 2-3.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  <path d="M17 16h4M21 11v10M21 16h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <circle cx="4" cy="16" r="1.5" fill="currentColor"/>
  <circle cx="27" cy="16" r="1.5" fill="currentColor"/>
</symbol>
<symbol id="${GALLERY_ICON_ID}" viewBox="0 0 32 32">
  <rect x="4" y="6" width="10" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
  <rect x="18" y="6" width="10" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
  <rect x="4" y="18" width="10" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="M18 22h10M23 18v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</symbol>`);

    const plugin = this;
    this.addTab({
      type: TAB_TYPE,
      init() {
        const custom = this as unknown as Custom;
        const element = custom.element as HTMLElement;
        plugin.editorManager.mount(
          element,
          custom.data as {
            asset?: string;
            title?: string;
            editorOptions?: { insert?: boolean; update?: boolean; format?: ImageFormat };
          },
          custom.tab?.id ?? element.parentElement?.getAttribute("data-id") ?? "",
        );
      },
      beforeDestroy(this: Custom) {
        const data = this.data as { asset?: string } | undefined;
        if (data?.asset) plugin.setEditorDirty(data.asset, false);
      },
    });

    this.addTab({
      type: GALLERY_TAB_TYPE,
      init() {
        const custom = this as unknown as Custom;
        const element = custom.element as HTMLElement;
        plugin.galleryManager.mount(
          element,
          custom.tab?.id ?? element.parentElement?.getAttribute("data-id") ?? "",
        );
      },
      beforeDestroy(this: Custom) {
        plugin.galleryManager.detach(this.tab?.id ?? "");
      },
    });

    this.protyleSlash = [
      {
        filter: ["插入电路图", "insert circuit", "analog canvas", "analog", "电路图", "ac"],
        id: "insertAnalogCanvas",
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#${ICON_ID}"></use></svg><span class="b3-list-item__text">${this.i18n.insertCircuit}</span></div>`,
        callback: (protyle: Protyle, nodeElement: HTMLElement) => {
          const blockId =
            nodeElement?.getAttribute?.("data-node-id") ??
            nodeElement?.closest?.("[data-node-id]")?.getAttribute("data-node-id") ??
            "";
          void this.picker.pick("insert", protyle, blockId);
        },
      },
    ];

    this.addCommand({
      langKey: "openAnalogCanvas",
      hotkey: "⌥⌘A",
      callback: () => {
        void this.picker.pick("open");
      },
    });

    this.addCommand({
      langKey: "openOnlineGallery",
      callback: () => {
        this.openOnlineGallery();
      },
    });

    if (!this.isMobile) {
      this.topBar = this.addTopBar({
        icon: ICON_ID,
        title: this.i18n.openEditor,
        position: "right",
        callback: () => {
          void this.picker.pick("open");
        },
      });
      this.addDock({
        config: {
          position: "LeftBottom",
          size: { width: 220, height: 0 },
          icon: ICON_ID,
          title: this.i18n.dockTitle,
        },
        data: {},
        type: DOCK_TYPE,
        init() {
          const custom = this as unknown as Custom;
          plugin.dock.mount(custom.element as HTMLElement);
        },
      });
      this.addDock({
        config: {
          position: "RightTop",
          size: { width: 460, height: 0 },
          icon: GALLERY_ICON_ID,
          title: this.i18n.onlineGallery,
          show: false,
        },
        data: {},
        type: GALLERY_DOCK_TYPE,
        init() {
          const custom = this as unknown as Custom;
          plugin.galleryManager.mountDock(custom.element as HTMLElement);
        },
        destroy() {
          const custom = this as unknown as { element?: HTMLElement };
          plugin.galleryManager.detachDock(custom.element);
        },
      });
    }

    window.setTimeout(() => this.applyGalleryVisibility(), 0);

    this.eventBus.on("open-siyuan-url-plugin", this.handleOpenUrl);
    this.eventBus.on("open-menu-image", this.handleImageMenu);
    window.addEventListener("beforeunload", this.handleBeforeUnload);
    document.addEventListener("click", this.handleTabClose, true);
    document.addEventListener("keydown", this.handleTabCloseKey, true);
  }

  onunload(): void {
    this.bridge?.detach();
    this.eventBus.off("open-siyuan-url-plugin", this.handleOpenUrl);
    this.eventBus.off("open-menu-image", this.handleImageMenu);
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
    document.removeEventListener("click", this.handleTabClose, true);
    document.removeEventListener("keydown", this.handleTabCloseKey, true);
  }

  openSetting(): void {
    openSettings(this);
  }

  async saveSettings(settings: AcSettings): Promise<void> {
    await this.saveData("settings", settings);
    this.applyGalleryVisibility();
  }

  private applyGalleryVisibility(retries = 10): void {
    if (this.topBar) {
      this.topBar.style.display = this.settings.editorTopBar ? "" : "none";
    }
    const item = document.querySelector(
      `.dock__item[data-type="${CSS.escape(GALLERY_DOCK_TYPE)}"]`,
    ) as HTMLElement | null;
    if (!item) {
      if (retries > 0) {
        window.setTimeout(() => this.applyGalleryVisibility(retries - 1), 100);
      }
      return;
    }
    if (this.settings.galleryDock) {
      delete item.dataset.acGalleryHidden;
      item.style.display = "";
      return;
    }
    if (item.classList.contains("dock__item--active")) item.click();
    item.dataset.acGalleryHidden = "1";
    item.style.display = "none";
  }

  private async loadSettings(): Promise<void> {
    let stored: unknown = null;
    try {
      stored = await this.loadData("settings");
    } catch {
      stored = null;
    }
    const value = stored as Partial<AcSettings> | null;
    const raw = Number(value?.previewHeight);
    this.settings = {
      previewHeight: Number.isFinite(raw)
        ? Math.min(900, Math.max(160, Math.round(raw)))
        : DEFAULT_PREVIEW_HEIGHT,
      insertMode: value?.insertMode === "interactive" ? "interactive" : "image",
      imageFormat: value?.imageFormat === "svg" ? "svg" : "png",
      exportDir: typeof value?.exportDir === "string" ? value.exportDir.trim() : "",
      exportScale: Number.isFinite(Number(value?.exportScale))
        ? Math.min(6, Math.max(1, Math.round(Number(value?.exportScale))))
        : 3,
      autosave: value?.autosave !== false,
      historyLimit: Number.isFinite(Number(value?.historyLimit))
        ? Math.min(100, Math.max(5, Math.round(Number(value?.historyLimit))))
        : 20,
      editorTopBar: value?.editorTopBar !== false,
      galleryDock: value?.galleryDock !== false,
    };
  }

  async pickExportDir(): Promise<string | null> {
    return chooseDirectory({
      title: this.i18n.chooseFolder,
      defaultPath: this.settings.exportDir,
    });
  }

  private handleOpenUrl = (event: CustomEvent<{ url: string }>): void => {
    try {
      const url = new URL(event.detail.url);
      if (url.host !== "plugins" || !url.pathname.includes(PLUGIN_NAME)) return;
      const assetPath = url.searchParams.get("asset");
      if (!assetPath) return;
      void this.resolveAsset(assetPath).then((asset) => {
        if (asset) this.openAsset(asset);
      });
    } catch {
      // A malformed siyuan:// URL is not ours.
    }
  };

  private async resolveAsset(path: string): Promise<AcAsset | null> {
    const assets = await this.assetStore.list();
    return assets.find((asset) => asset.path === path) ?? null;
  }

  async readAsset(path: string): Promise<string> {
    return this.assetStore.read(path);
  }

  async listAssets(): Promise<AcAsset[]> {
    return this.assetStore.list();
  }

  async listVersions(path: string): Promise<AcVersion[]> {
    return this.assetStore.versions(path);
  }

  async saveProject(params: {
    asset: string | null;
    text: string;
    name: string;
    saveAs: boolean;
    autosave?: boolean;
  }): Promise<{ status: "saved"; file: SavedFile } | { status: "cancelled" }> {
    const title = sanitizeTitle(params.name.replace(/\.icproj\.json$/iu, ""));
    if (!params.saveAs && params.asset) {
      const existing = await this.resolveAsset(params.asset);
      if (existing) {
        try {
          const previous = await this.assetStore.read(existing.path);
          if (previous !== params.text) {
            await this.assetStore.snapshot(existing.path, previous, {
              // Autosave must not fill the history with near-identical copies.
              minInterval: params.autosave ? 5 * 60 * 1000 : 0,
              limit: this.settings.historyLimit,
            });
          }
        } catch (error) {
          console.warn("[siyuan-analog-canvas] history snapshot failed", error);
        }
      }
    }
    const asset =
      !params.asset || params.saveAs
        ? await this.assetStore.create(title, params.text)
        : await this.assetStore.saveText(params.asset, params.text);
    this.refreshDock();
    refreshPreviews(asset.path);
    return {
      status: "saved",
      file: {
        id: asset.path,
        revision: Date.now(),
        name: asset.fileName,
        path: asset.path,
      },
    };
  }

  async pickAssetForEditor(): Promise<AcAsset | null> {
    return this.picker.pickForEditor();
  }

  async pickSaveName(suggestedName: string): Promise<string | null> {
    const name = await promptText({
      title: this.i18n.saveAs ?? "Save as",
      label: this.i18n.namePlaceholder,
      value: suggestedName.replace(/\.icproj\.json$/iu, ""),
      confirmText: this.i18n.save,
      cancelText: this.i18n.cancel,
      isMobile: this.isMobile,
      validate: (value) => (value.trim() ? null : this.i18n.nameRequired),
    });
    return name ? sanitizeTitle(name) : null;
  }

  async saveExport(params: {
    asset: string | null;
    name: string;
    mediaType: string;
    bytes: Uint8Array;
    intent: "insert" | "export" | "clipboard";
  }): Promise<{ status: "saved"; path: string } | { status: "cancelled" }> {
    if (params.intent === "clipboard") {
      const ext = imageExtension(params.mediaType, params.name);
      const copied =
        ext === "svg"
          ? await copySvgToClipboard(new TextDecoder().decode(params.bytes))
          : ext === "png"
            ? await copyPngToClipboard(params.bytes)
            : false;
      if (copied) {
        this.notify(
          ext === "svg" ? this.i18n.copiedSvg ?? "SVG copied" : this.i18n.copiedPng ?? "PNG copied",
          "info",
        );
        return { status: "saved", path: "" };
      }
      this.notify(this.i18n.copyFailed ?? "Could not copy the drawing", "error");
      return { status: "cancelled" };
    }
    if (params.intent === "insert") {
      const ext = imageExtension(params.mediaType, params.name);
      const source = params.asset ? await this.resolveAsset(params.asset) : null;
      if (!source || !ext) {
        this.notify(this.i18n.unsupportedAction, "error");
        return { status: "cancelled" };
      }
      const pending = this.pendingInserts.get(source.path);
      const blocks = await findImageBlocks(source.path);
      const matching = blocks.find((block) => block.ext === ext);
      if (blocks.length > 0 && !matching) {
        this.notify(
          (this.i18n.imageFormatMismatch ?? "The note image is {ext}; export the same format.").replace(
            "{ext}",
            blocks[0]?.ext.toUpperCase() ?? "",
          ),
          "error",
        );
        return { status: "cancelled" };
      }
      const imagePath = matching?.imagePath ?? imagePathFor(source.path, ext);
      await this.assetStore.saveBinaryAt(imagePath, params.bytes, params.mediaType);
      refreshPreviews(source.path);
      if (pending) {
        await insertImageAfterBlock(pending.blockId, source, imagePath);
        this.pendingInserts.delete(source.path);
        this.notify(this.i18n.imageInserted, "info");
      } else if (matching) {
        this.notify(this.i18n.imageUpdated, "info");
      } else {
        this.notify(this.i18n.imageSaved, "info");
      }
      return { status: "saved", path: imagePath };
    }

    const result = await saveFileAs({
      name: params.name,
      defaultDir: this.settings.exportDir,
      bytes: params.bytes,
      mediaType: params.mediaType,
      title: this.i18n.exportTitle,
    });
    if (result.status === "saved") {
      this.notify((this.i18n.exportSaved ?? "Exported to {path}").replace("{path}", result.path), "info");
      return { status: "saved", path: result.path };
    }
    if (result.status === "downloaded") {
      this.notify((this.i18n.exportDownloaded ?? "Downloaded {name}").replace("{name}", result.path), "info");
      return { status: "saved", path: result.path };
    }
    return { status: "cancelled" };
  }

  openEditor(asset: AcAsset): void {
    this.editorManager.open(asset);
  }

  openOnlineGallery(): void {
    this.galleryManager.open();
  }

  async importProjectFile(): Promise<AcAsset | null> {
    return importProjectFromFile(this);
  }

  async readClipboardText(): Promise<string> {
    return readSystemClipboard();
  }

  updateTabTitle(asset: string, title: string): void {
    this.editorManager.updateTitle(asset, title);
  }

  updateEditorTabTitle(tabId: string, title: string): void {
    const tabs = Object.values(this.getOpenedTab()).flat();
    const custom = tabs.find((item) => item.tab?.id === tabId);
    if (custom?.tab) custom.tab.updateTitle(title);
  }

  notify(message: string, type: "info" | "error" = "info"): void {
    showMessage(message, 5000, type);
  }

  async libraryAction(params: Record<string, unknown>): Promise<void> {
    const action = String(params.action ?? "");
    const id = String(params.id ?? "");
    if (action === "rename" && typeof params.name === "string") {
      const asset = await this.resolveAsset(id);
      if (asset) await this.renameAsset(asset, params.name);
      return;
    }
    if (action === "delete" || action === "purge") {
      const asset = await this.resolveAsset(id);
      if (asset) await this.deleteAsset(asset);
      return;
    }
    if (action === "restore-version") {
      const version = String(params.version ?? "");
      const asset = await this.resolveAsset(id);
      if (!asset || !version) throw new Error(this.i18n.assetMissing);
      await this.restoreVersion(asset, version);
      return;
    }
    if (action === "branch-version") {
      const version = String(params.version ?? "");
      const asset = await this.resolveAsset(id);
      if (!asset || !version) throw new Error(this.i18n.assetMissing);
      await this.branchVersion(asset, version);
      return;
    }
    if (action === "duplicate") {
      await this.duplicateAsset(id);
      return;
    }
    if (action === "favorite" || action === "restore") return;
    throw new Error(`Unsupported library action: ${action}`);
  }

  setEditorDirty(asset: string, dirty: boolean): void {
    if (!asset) return;
    if (dirty) {
      this.dirtyAssets.add(asset);
      return;
    }
    this.dirtyAssets.delete(asset);
    const waiters = this.dirtyWaiters.get(asset);
    if (waiters) {
      this.dirtyWaiters.delete(asset);
      waiters.forEach((waiter) => waiter(false));
    }
  }

  private handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    this.pruneDirty();
    if (this.dirtyAssets.size === 0) return;
    event.preventDefault();
    event.returnValue = "";
  };

  private pruneDirty(): void {
    for (const asset of [...this.dirtyAssets]) {
      if (!this.editorManager.isOpen(asset)) this.dirtyAssets.delete(asset);
    }
  }

  private handleTabClose = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const close = target?.closest?.(".item__close") as HTMLElement | null;
    if (!close) return;
    const tab = close.closest(
      ".layout-tab-bar .item, .layout-tab .item",
    ) as HTMLElement | null;
    if (!tab || tab.classList.contains("item--pin")) return;
    const tabId = tab.getAttribute("data-id") ?? "";
    if (this.allowCloseTab && this.allowCloseTab === tabId) {
      this.allowCloseTab = "";
      return;
    }
    const record = this.editorManager.recordForTab(tabId);
    if (!record || !this.dirtyAssets.has(record.asset)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void this.confirmDirtyClose(record, () => close.click());
  };

  private handleTabCloseKey = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() !== "w") return;
    const active = document.querySelector(
      ".layout__wnd--active .layout-tab-bar .item--focus, .layout-tab-bar .item--focus",
    ) as HTMLElement | null;
    const tabId = active?.getAttribute("data-id") ?? "";
    const record = this.editorManager.recordForTab(tabId);
    if (!record) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.requestEditorClose(record.asset);
  };

  requestEditorClose(asset: string): void {
    const record = this.editorManager.recordForAsset(asset);
    if (!record) return;
    const performClose = record.dialog
      ? () => record.dialog?.destroy()
      : () => this.closeButtonForTab(record.tabId)?.click();
    if (this.dirtyAssets.has(record.asset)) {
      void this.confirmDirtyClose(record, performClose);
    } else {
      performClose();
    }
  }

  private closeButtonForTab(tabId: string): HTMLElement | null {
    if (!tabId) return null;
    const tab = document.querySelector(
      `.layout-tab-bar .item[data-id="${CSS.escape(tabId)}"], .layout-tab .item[data-id="${CSS.escape(tabId)}"]`,
    );
    return (tab?.querySelector(".item__close") as HTMLElement | null) ?? null;
  }

  private async confirmDirtyClose(
    record: EditorRecord,
    performClose: () => void,
  ): Promise<void> {
    const choice = await closeGuardDialog({
      title: this.i18n.unsavedTitle ?? "Unsaved changes",
      message: (this.i18n.unsavedMessage ?? "Save changes before closing?").replace(
        "{name}",
        titleFromFileName(record.asset.slice(record.asset.lastIndexOf("/") + 1)),
      ),
      saveText: this.i18n.saveAndClose ?? "Save and close",
      discardText: this.i18n.closeWithoutSaving ?? "Close without saving",
      cancelText: this.i18n.cancel,
      isMobile: this.isMobile,
    });
    if (choice === "cancel") return;
    if (choice === "save") {
      const saved = await this.saveEditor(record);
      if (!saved) {
        this.notify(this.i18n.saveFailed ?? "Could not save the circuit", "error");
        return;
      }
    } else {
      this.dirtyAssets.delete(record.asset);
    }
    this.allowCloseTab = record.tabId;
    performClose();
  }

  private saveEditor(record: EditorRecord): Promise<boolean> {
    if (!this.dirtyAssets.has(record.asset)) return Promise.resolve(true);
    if (!record.iframe.isConnected) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        const waiters = this.dirtyWaiters.get(record.asset) ?? [];
        this.dirtyWaiters.set(
          record.asset,
          waiters.filter((waiter) => waiter !== onSaved),
        );
        resolve(value);
      };
      const onSaved = (dirty: boolean) => {
        if (!dirty) finish(true);
      };
      const timer = window.setTimeout(() => finish(false), 20000);
      const waiters = this.dirtyWaiters.get(record.asset) ?? [];
      waiters.push(onSaved);
      this.dirtyWaiters.set(record.asset, waiters);
      try {
        record.iframe.contentWindow?.postMessage(
          { __ac: 1, type: "event", event: "save" },
          window.location.origin,
        );
      } catch {
        finish(false);
      }
    });
  }

  async duplicateAsset(path: string): Promise<AcAsset> {
    const asset = await this.assetStore.duplicate(path);
    this.refreshDock();
    this.notify(this.i18n.saved, "info");
    return asset;
  }

  async restoreVersion(asset: AcAsset, version: string): Promise<void> {
    if (this.editorManager.isOpen(asset.path)) {
      throw new Error(
        this.i18n.closeEditorForRestore ?? "Close the editor before restoring a version.",
      );
    }
    await this.assetStore.restoreVersion(asset.path, version, this.settings.historyLimit);
    this.refreshDock();
    refreshPreviews(asset.path);
    this.notify(this.i18n.historyRestored ?? "Version restored", "info");
  }

  async branchVersion(asset: AcAsset, version: string): Promise<AcAsset> {
    const branched = await this.assetStore.branchVersion(
      asset.path,
      version,
      `${asset.title} (${this.i18n.historyVersion ?? "version"})`,
    );
    this.refreshDock();
    this.notify(
      (this.i18n.versionBranched ?? "Created {name}").replace("{name}", branched.title),
      "info",
    );
    return branched;
  }

  async insertAsset(asset: AcAsset, protyle?: Protyle, targetBlockId?: string): Promise<void> {
    if (this.settings.insertMode === "interactive" || !targetBlockId) {
      if (!protyle) {
        this.notify(this.i18n.noInsertTarget, "error");
        return;
      }
      try {
        protyle.focus();
      } catch {
        // The editor may have been closed while the picker was open.
      }
      const image = await this.assetStore.imageFor(asset);
      insertPreview(protyle, asset, this.settings.previewHeight, image?.path);
      return;
    }
    const existing = await this.assetStore.imageFor(asset);
    if (existing) {
      await insertImageAfterBlock(targetBlockId, asset, existing.path);
      this.notify(this.i18n.imageInserted, "info");
      return;
    }
    this.pendingInserts.set(asset.path, {
      blockId: targetBlockId,
      title: asset.title,
      format: this.settings.imageFormat,
    });
    if (this.editorManager.isOpen(asset.path)) {
      this.notify(this.i18n.openInEditorHint, "info");
      return;
    }
    this.editorManager.open(asset, {
      insert: true,
      format: this.settings.imageFormat,
    });
  }

  openAsset(asset: AcAsset): void {
    this.editorManager.open(asset);
  }

  async renameAsset(asset: AcAsset, newTitle: string): Promise<void> {
    if (this.editorManager.isOpen(asset.path)) {
      this.notify(this.i18n.closeEditorFirst, "error");
      return;
    }
    const title = sanitizeTitle(newTitle);
    if (!title || title === asset.title) return;
    const text = await this.assetStore.read(asset.path);
    let body = text;
    try {
      const project = JSON.parse(text) as Record<string, unknown>;
      project.name = title;
      body = JSON.stringify(project, null, 2);
    } catch {
      // Keep the original text if it is not valid JSON.
    }
    const renamed = await this.assetStore.saveAs(title, body);
    await this.assetStore.moveHistory(asset.path, renamed.path).catch(() => undefined);
    await this.assetStore.remove(asset.path);
    await updateSourceReferences(asset.path, renamed.path, title);
    const pending = this.pendingInserts.get(asset.path);
    if (pending) {
      this.pendingInserts.delete(asset.path);
      this.pendingInserts.set(renamed.path, { ...pending, title });
    }
    this.refreshDock();
    const references = await referencingBlockIds(renamed.path).catch(() => []);
    this.notify(
      references.length > 0
        ? `${this.i18n.renamed} · ${(this.i18n.renameReferenced ?? "{count} reference(s) updated.").replace(
            "{count}",
            String(references.length),
          )}`
        : this.i18n.renamed,
      "info",
    );
  }

  private handleImageMenu = (event: CustomEvent<{ element?: HTMLElement }>): void => {
    const element = event.detail?.element;
    if (!element) return;
    const holder =
      (element.closest?.("[custom-data-assets]") as HTMLElement | null) ??
      (element.hasAttribute?.("custom-data-assets") ? element : null);
    const source = holder?.getAttribute("custom-data-assets") ?? "";
    if (!source.startsWith(`${ASSET_PREFIX}/`)) return;
    const image =
      element.tagName?.toLowerCase() === "img"
        ? (element as HTMLImageElement)
        : (element.querySelector?.("img") as HTMLImageElement | null);
    const src = image?.getAttribute("data-src") ?? image?.getAttribute("src") ?? "";
    const ext = src.match(/\.(png|svg)(?:[?#]|$)/iu)?.[1]?.toLowerCase() as ImageFormat | undefined;
    window.siyuan.menus?.menu.addItem({
      id: "analog-canvas-edit-image",
      icon: ICON_ID,
      label: this.i18n.editCircuit,
      click: () => {
        void this.resolveAsset(source).then((asset) => {
          if (!asset) {
            this.notify(this.i18n.assetMissing, "error");
            return;
          }
          this.editorManager.open(asset, {
            update: true,
            format: ext ?? this.settings.imageFormat,
          });
        });
      },
    });
    window.siyuan.menus?.menu.addItem({
      id: "analog-canvas-history-image",
      icon: "iconClock",
      label: this.i18n.history,
      click: () => {
        void this.resolveAsset(source).then((asset) => {
          if (asset) void openHistoryDialog(this, asset);
        });
      },
    });
    window.siyuan.menus?.menu.addSeparator?.();
    window.siyuan.menus?.menu.addItem({
      id: "analog-canvas-copy-png",
      icon: "iconCopy",
      label: this.i18n.copyPng ?? "Copy PNG",
      click: () => void this.copyCircuit(source, "png"),
    });
    window.siyuan.menus?.menu.addItem({
      id: "analog-canvas-copy-svg",
      icon: "iconCopy",
      label: this.i18n.copySvg ?? "Copy SVG",
      click: () => void this.copyCircuit(source, "svg"),
    });
  };

  private async copyCircuit(source: string, format: ImageFormat): Promise<void> {
    const imagePath = imagePathFor(source, format);
    try {
      const copied =
        format === "svg"
          ? await copySvgToClipboard(await this.assetStore.read(imagePath))
          : await copyPngToClipboard(await this.assetStore.readBinary(imagePath));
      if (copied) {
        this.notify(
          format === "svg"
            ? this.i18n.copiedSvg ?? "SVG copied"
            : this.i18n.copiedPng ?? "PNG copied",
          "info",
        );
      } else {
        this.notify(this.i18n.copyFailed ?? "Could not copy the drawing", "error");
      }
    } catch {
      this.notify(this.i18n.copyFailed ?? "Could not copy the drawing", "error");
    }
  }

  async deleteAsset(asset: AcAsset): Promise<void> {
    const references = await this.countReferences(asset.path).catch(() => 0);
    const warning =
      references > 0
        ? `\n\n${(this.i18n.deleteReferenced ?? "Referenced by {count} block(s); their previews will stop working.").replace(
            "{count}",
            String(references),
          )}`
        : "";
    const confirmed = await confirmDialog({
      title: this.i18n.delete,
      message: (this.i18n.confirmDelete ?? "Delete \"{name}\"?").replace("{name}", asset.title) + warning,
      confirmText: this.i18n.delete,
      cancelText: this.i18n.cancel,
      isMobile: this.isMobile,
    });
    if (!confirmed) return;
    await this.assetStore.remove(asset.path);
    this.refreshDock();
    refreshPreviews(asset.path);
    this.notify(this.i18n.deleted, "info");
  }

  async copyLink(asset: AcAsset): Promise<void> {
    const url = `siyuan://plugins/${PLUGIN_NAME}?${new URLSearchParams({
      asset: asset.path,
      title: asset.title,
    }).toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      this.notify(this.i18n.linkCopied, "info");
    } catch (error) {
      this.notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  refreshDock(): void {
    void this.dock?.refresh();
  }

  private async countReferences(path: string): Promise<number> {
    const escaped = path.replace(/'/gu, "''");
    const response = await fetchSyncPost("/api/query/sql", {
      stmt: `SELECT count(*) AS c FROM blocks WHERE ial LIKE '%custom-data-assets="${escaped}"%'`,
    });
    if (response.code !== 0 || !Array.isArray(response.data)) return 0;
    const first = response.data[0] as { c?: number } | undefined;
    return Number(first?.c ?? 0);
  }
}
