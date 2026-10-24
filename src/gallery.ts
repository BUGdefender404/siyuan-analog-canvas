import { Dialog, openTab } from "siyuan";
import {
  GALLERY_DOCK_TYPE,
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

const GALLERY_SESSION_COOKIE = "icm_session";

interface RemoteCookie {
  name: string;
  value: string;
  path: string;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite: string;
}

interface RemoteCookies {
  get(filter: { url: string; name: string }): Promise<RemoteCookie[]>;
  set(details: {
    url: string;
    name: string;
    value: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: string;
    expirationDate?: number;
  }): Promise<void>;
}

interface RemoteWindow {
  isDestroyed(): boolean;
  close(): void;
  focus(): void;
  loadURL(url: string): void;
}

interface FrameNavigateEvent {
  url: string;
  isMainFrame: boolean;
  preventDefault(): void;
}

interface RemoteWebContents {
  on(event: "will-frame-navigate", listener: (event: FrameNavigateEvent) => void): void;
  on(
    event: "did-start-navigation",
    listener: (details: { url: string; isMainFrame: boolean }) => void,
  ): void;
}

interface ElectronRemote {
  session?: { defaultSession?: { cookies?: RemoteCookies } };
  BrowserWindow?: new (options: Record<string, unknown>) => RemoteWindow;
  getCurrentWebContents?: () => RemoteWebContents;
}

function electronRemote(): ElectronRemote | null {
  const request = (globalThis as { require?: (id: string) => unknown }).require;
  if (typeof request !== "function") return null;
  try {
    return request("@electron/remote") as ElectronRemote;
  } catch {
    return null;
  }
}

function remoteCookies(): RemoteCookies | null {
  try {
    return electronRemote()?.session?.defaultSession?.cookies ?? null;
  } catch {
    return null;
  }
}

function canOpenLoginWindow(): boolean {
  try {
    return Boolean(electronRemote()?.BrowserWindow);
  } catch {
    return false;
  }
}

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
  private dockElement: HTMLElement | null = null;
  private tabId = "";
  private dialog?: Dialog;
  private view: GalleryView = "home";
  private sessionTimer = 0;
  private lastSessionCookie = "";
  private sessionCheckDisabled = false;
  private sessionErrorLogged = false;
  private loginWindow?: RemoteWindow;
  private oauthWatch = false;
  private lastLoginTarget = "";
  private lastLoginAt = 0;

  constructor(host: GalleryHost) {
    this.host = host;
  }

  open(): void {
    if (this.dialog) {
      this.dialog.element.style.zIndex = "9999";
      return;
    }
    if (this.host.isMobile) {
      this.openDialog();
      return;
    }
    if (this.activateDock()) return;
    if (this.element?.isConnected) {
      if (!this.focus()) {
        console.info("Analog Canvas online gallery is open in another tab");
      }
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
    this.prepare(element);
    this.watchOAuthNavigation();
    this.render(element);
  }

  mountDock(element: HTMLElement): void {
    this.dockElement = element;
    this.prepare(element);
    this.watchOAuthNavigation();
    this.render(element);
  }

  detach(tabId = ""): void {
    if (!tabId || tabId === this.tabId) {
      this.element = null;
      this.tabId = "";
      this.stopSessionWatch();
    }
  }

  detachDock(element?: HTMLElement): void {
    if (!element || element === this.dockElement) {
      this.dockElement = null;
      this.stopSessionWatch();
    }
  }

  private prepare(element: HTMLElement): void {
    element.classList.add("ac-gallery-host");
    element.style.display = "flex";
    element.style.flexDirection = "column";
    element.style.height = "100%";
    element.style.minHeight = "200px";
    element.style.overflow = "hidden";
  }

  private activateDock(): boolean {
    const item = document.querySelector(
      `.dock__item[data-type="${CSS.escape(GALLERY_DOCK_TYPE)}"]`,
    ) as HTMLElement | null;
    if (!item) return false;
    if (item.dataset.acGalleryHidden === "1") {
      item.style.display = "";
      if (!item.classList.contains("dock__item--active")) item.click();
      item.dataset.acGalleryHidden = "1";
      item.style.display = "none";
      return true;
    }
    if (item.offsetParent === null) return false;
    if (!item.classList.contains("dock__item--active")) item.click();
    return true;
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

  private isGalleryMounted(): boolean {
    return Boolean(this.element?.isConnected || this.dockElement?.isConnected);
  }

  private oauthTarget(url: string): string | null {
    if (
      /^https:\/\/analog-canvas\.tokenzhang\.com\/api\/auth\/(?:github|google)\/start(?:[?#]|$)/u.test(
        url,
      )
    ) {
      return url;
    }
    if (/^https:\/\/github\.com\/login\/oauth\/authorize(?:[?#]|$)/u.test(url)) {
      return `${GALLERY_HOME_URL}api/auth/github/start`;
    }
    if (/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth(?:[?#]|$)/u.test(url)) {
      return `${GALLERY_HOME_URL}api/auth/google/start`;
    }
    return null;
  }

  private watchOAuthNavigation(): void {
    if (this.oauthWatch) return;
    this.oauthWatch = true;
    try {
      const contents = electronRemote()?.getCurrentWebContents?.();
      if (!contents) return;
      contents.on("will-frame-navigate", (event) => {
        try {
          if (!this.isGalleryMounted() || event.isMainFrame) return;
          const target = this.oauthTarget(event.url);
          if (!target) return;
          event.preventDefault();
          this.openLoginWindow(target);
        } catch (error) {
          console.info("[siyuan-analog-canvas] could not redirect gallery OAuth navigation", error);
        }
      });
      contents.on("did-start-navigation", (details) => {
        try {
          if (!this.isGalleryMounted() || details.isMainFrame) return;
          const target = this.oauthTarget(details.url);
          if (target) this.openLoginWindow(target);
        } catch (error) {
          console.info("[siyuan-analog-canvas] could not open gallery OAuth window", error);
        }
      });
    } catch (error) {
      console.info("[siyuan-analog-canvas] could not watch gallery OAuth navigation", error);
    }
  }

  private startSessionWatch(frame: HTMLIFrameElement): void {
    this.stopSessionWatch();
    this.sessionTimer = window.setInterval(() => {
      void this.repairSessionCookie(frame);
    }, 3000);
  }

  private stopSessionWatch(): void {
    if (!this.sessionTimer) return;
    window.clearInterval(this.sessionTimer);
    this.sessionTimer = 0;
  }

  private async repairSessionCookie(frame: HTMLIFrameElement): Promise<void> {
    if (this.sessionCheckDisabled || !frame.isConnected) return;
    const cookies = remoteCookies();
    if (!cookies) {
      this.sessionCheckDisabled = true;
      return;
    }
    try {
      const found = await cookies.get({
        url: GALLERY_HOME_URL,
        name: GALLERY_SESSION_COOKIE,
      });
      const cookie = found.find((item) => item.sameSite !== "no_restriction");
      if (!cookie || cookie.value === this.lastSessionCookie) return;
      const current = frame.src || galleryUrl(this.view);
      await cookies.set({
        url: GALLERY_HOME_URL,
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || "/",
        secure: true,
        httpOnly: true,
        sameSite: "no_restriction",
        ...(typeof cookie.expirationDate === "number"
          ? { expirationDate: cookie.expirationDate }
          : {}),
      });
      this.lastSessionCookie = cookie.value;
      if (this.loginWindow && !this.loginWindow.isDestroyed()) {
        this.host.notify(t(this.host, "galleryLoginSynced"), "info");
      }
      // Navigating through about:blank forces a cross-origin reload.
      frame.src = "about:blank";
      window.setTimeout(() => {
        if (frame.isConnected) frame.src = current;
      }, 50);
    } catch (error) {
      if (!this.sessionErrorLogged) {
        this.sessionErrorLogged = true;
        console.info("[siyuan-analog-canvas] gallery session check failed", error);
      }
    }
  }

  private openLoginWindow(url?: string): void {
    if (!canOpenLoginWindow()) {
      this.host.notify(t(this.host, "galleryLoginUnavailable"), "error");
      return;
    }
    if (url) {
      const now = Date.now();
      if (url === this.lastLoginTarget && now - this.lastLoginAt < 2000) return;
      this.lastLoginTarget = url;
      this.lastLoginAt = now;
    }
    try {
      if (this.loginWindow && !this.loginWindow.isDestroyed()) {
        if (url) this.loginWindow.loadURL(url);
        this.loginWindow.focus();
        return;
      }
      const remote = electronRemote();
      if (!remote?.BrowserWindow) {
        this.host.notify(t(this.host, "galleryLoginUnavailable"), "error");
        return;
      }
      const win = new remote.BrowserWindow({
        width: 520,
        height: 780,
        title: "Analog Canvas",
        autoHideMenuBar: true,
        backgroundColor: "#ffffff",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      this.loginWindow = win;
      win.loadURL(url ?? GALLERY_HOME_URL);
      win.focus();
      this.host.notify(t(this.host, "galleryLoginHint"), "info");
    } catch (error) {
      console.info("[siyuan-analog-canvas] could not open the gallery login window", error);
      this.host.notify(t(this.host, "galleryLoginUnavailable"), "error");
    }
  }

  private render(element: HTMLElement): void {
    // A dock may be initialized more than once; only rebuild when its DOM was
    // actually cleared. A stale dataset flag previously left a blank tab.
    if (element.querySelector(".ac-gallery")) return;
    const home = galleryUrl("home");
    const loginAvailable = !this.host.isMobile && canOpenLoginWindow();
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
      ${
        loginAvailable
          ? `<button type="button" class="b3-button b3-button--outline ac-gallery__login">${escapeHtml(
              t(this.host, "galleryLogin"),
            )}</button>`
          : ""
      }
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
      void this.repairSessionCookie(frame);
    });
    this.startSessionWatch(frame);
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
    root.querySelector(".ac-gallery__login")?.addEventListener("click", () => {
      this.openLoginWindow();
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
