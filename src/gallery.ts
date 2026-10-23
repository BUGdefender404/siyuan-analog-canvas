import { Dialog, openTab } from "siyuan";
import {
  GALLERY_EDITOR_URL,
  GALLERY_HOME_URL,
  GALLERY_ICON_ID,
  GALLERY_TAB_TYPE,
} from "./constants";
import { t } from "./host";
import type { AcAsset } from "./types";

export interface GalleryHost {
  app: unknown;
  isMobile: boolean;
  i18n: Record<string, string>;
  importProjectFile(): Promise<AcAsset | null>;
  openAsset(asset: AcAsset): void;
  notify(message: string, type?: "info" | "error"): void;
}

type GalleryView = "home" | "editor";

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function galleryUrl(view: GalleryView): string {
  return view === "editor" ? GALLERY_EDITOR_URL : GALLERY_HOME_URL;
}

export class GalleryManager {
  private host: GalleryHost;
  private element: HTMLElement | null = null;
  private tabId = "";
  private dialog?: Dialog;
  private view: GalleryView = "home";

  constructor(host: GalleryHost) {
    this.host = host;
  }

  open(): void {
    if (this.dialog) {
      this.dialog.element.style.zIndex = "9999";
      return;
    }
    if (this.element?.isConnected) {
      if (!this.focus()) {
        console.info("Analog Canvas online gallery is open in another tab");
      }
      return;
    }
    if (this.host.isMobile) {
      this.openDialog();
      return;
    }
    void openTab({
      app: this.host.app as never,
      custom: {
        id: GALLERY_TAB_TYPE,
        icon: GALLERY_ICON_ID,
        title: t(this.host, "onlineGallery"),
        data: {},
      },
    })
      .then((tab) => {
        if (tab?.id && this.element?.isConnected) this.tabId = tab.id;
      })
      .catch((error) => {
        console.warn("[siyuan-analog-canvas] could not open the gallery tab", error);
      });
  }

  mount(element: HTMLElement, tabId = ""): void {
    this.element = element;
    this.tabId = tabId || this.tabId;
    element.classList.add("ac-gallery-host");
    element.style.height = "100%";
    this.render(element);
  }

  detach(tabId = ""): void {
    if (!tabId || tabId === this.tabId) {
      this.element = null;
      this.tabId = "";
    }
  }

  private openDialog(): void {
    const holder = document.createElement("div");
    holder.className = "ac-gallery-dialog-content";
    const dialog = new Dialog({
      title: t(this.host, "onlineGallery"),
      content: holder.outerHTML,
      width: "100vw",
      height: "100vh",
      destroyCallback: () => {
        if (this.dialog === dialog) this.dialog = undefined;
      },
    });
    this.dialog = dialog;
    const content = dialog.element.querySelector(
      ".b3-dialog__content",
    ) as HTMLElement | null;
    if (!content) return;
    content.classList.add("ac-gallery-dialog__content");
    this.mount(content);
  }

  private focus(): boolean {
    if (!this.tabId) return false;
    const item = document.querySelector(
      `.layout-tab-bar .item[data-id="${CSS.escape(this.tabId)}"], .layout-tab .item[data-id="${CSS.escape(this.tabId)}"]`,
    ) as HTMLElement | null;
    if (!item) return false;
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  }

  private render(element: HTMLElement): void {
    if (element.dataset.acGallery === "1") return;
    element.dataset.acGallery = "1";
    const home = galleryUrl("home");
    element.innerHTML = `<div class="ac-gallery">
  <div class="ac-gallery__toolbar">
    <div class="ac-gallery__views" role="group" aria-label="${escapeHtml(
      t(this.host, "onlineGallery"),
    )}">
      <button type="button" class="ac-gallery__view ac-gallery__view--active" data-view="home">${escapeHtml(
        t(this.host, "galleryTab"),
      )}</button>
      <button type="button" class="ac-gallery__view" data-view="editor">${escapeHtml(
        t(this.host, "galleryEditorTab"),
      )}</button>
    </div>
    <div class="ac-gallery__actions">
      <button type="button" class="b3-button b3-button--outline ac-gallery__import" title="${escapeHtml(
        t(this.host, "importProjectHint"),
      )}">${escapeHtml(t(this.host, "galleryImport"))}</button>
      <button type="button" class="b3-button b3-button--outline ac-gallery__refresh">${escapeHtml(
        t(this.host, "refresh"),
      )}</button>
      <button type="button" class="b3-button b3-button--outline ac-gallery__external">${escapeHtml(
        t(this.host, "galleryExternal"),
      )}</button>
    </div>
  </div>
  <div class="ac-gallery__hint">${escapeHtml(t(this.host, "galleryHint"))}</div>
  <div class="ac-gallery__stage">
    <iframe class="ac-gallery__frame" title="${escapeHtml(
      t(this.host, "onlineGallery"),
    )}" src="${home}" allow="clipboard-read; clipboard-write; fullscreen" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-storage-access-by-user-activation" referrerpolicy="no-referrer"></iframe>
    <div class="ac-gallery__loading"><span>${escapeHtml(
      t(this.host, "galleryLoading"),
    )}</span></div>
  </div>
</div>`;

    const root = element.querySelector(".ac-gallery") as HTMLElement;
    const frame = root.querySelector(".ac-gallery__frame") as HTMLIFrameElement;
    const stage = root.querySelector(".ac-gallery__stage") as HTMLElement;
    const views = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".ac-gallery__view"),
    );
    const showLoading = () => {
      stage.classList.remove("is-loaded");
      const label = stage.querySelector(".ac-gallery__loading span");
      if (label) label.textContent = t(this.host, "galleryLoading");
    };
    frame.addEventListener("load", () => {
      stage.classList.add("is-loaded");
    });
    views.forEach((button) => {
      button.addEventListener("click", () => {
        const view = button.dataset.view === "editor" ? "editor" : "home";
        if (view === this.view && frame.src === galleryUrl(view)) return;
        this.view = view;
        views.forEach((item) => {
          item.classList.toggle("ac-gallery__view--active", item === button);
        });
        showLoading();
        frame.src = galleryUrl(view);
      });
    });
    root.querySelector(".ac-gallery__refresh")?.addEventListener("click", () => {
      showLoading();
      frame.src = galleryUrl(this.view);
    });
    root.querySelector(".ac-gallery__external")?.addEventListener("click", () => {
      const opened = window.open(galleryUrl(this.view), "_blank");
      if (opened) {
        try {
          opened.opener = null;
        } catch {
          // Cross-origin windows still open fine without this hardening.
        }
      } else {
        this.host.notify(t(this.host, "galleryExternalFailed"), "error");
      }
    });
    const importButton = root.querySelector(
      ".ac-gallery__import",
    ) as HTMLButtonElement | null;
    importButton?.addEventListener("click", () => {
      void (async () => {
        if (!importButton) return;
        importButton.disabled = true;
        try {
          const asset = await this.host.importProjectFile();
          if (asset) this.host.openAsset(asset);
        } finally {
          importButton.disabled = false;
        }
      })();
    });
  }
}
