import { Menu } from "siyuan";
import { GALLERY_ICON_ID } from "./constants";
import { promptText } from "./dialog";
import { t, type PluginHost } from "./host";
import { openHistoryDialog } from "./history";
import { newFromTemplate, pickTemplate } from "./templates";
import type { AcAsset } from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

export class AssetDock {
  private host: PluginHost;
  private element: HTMLElement | null = null;
  private assets: AcAsset[] = [];
  private keyword = "";
  private bound = false;

  constructor(host: PluginHost) {
    this.host = host;
  }

  mount(element: HTMLElement): void {
    this.element = element;
    element.classList.add("ac-dock");
    if (!this.bound) {
      this.bind(element);
      this.bound = true;
    }
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.assets = await this.host.assetStore.list();
    } catch (error) {
      this.assets = [];
      this.host.notify(error instanceof Error ? error.message : String(error), "error");
    }
    this.render();
  }

  private bind(element: HTMLElement): void {
    element.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest(".ac-dock__new")) {
        void this.create();
        return;
      }
      if (target.closest(".ac-dock__refresh")) {
        void this.refresh();
        return;
      }
      if (target.closest(".ac-dock__gallery")) {
        this.host.openOnlineGallery();
        return;
      }
      const item = target.closest(".ac-dock__item") as HTMLElement | null;
      if (item?.dataset.path) {
        const asset = this.assets.find((entry) => entry.path === item.dataset.path);
        if (asset) this.host.openAsset(asset);
      }
    });
    element.addEventListener("input", (event) => {
      const target = event.target as HTMLElement;
      if (target.classList.contains("ac-dock__search")) {
        this.keyword = (target as HTMLInputElement).value;
        this.updateList();
      }
    });
    element.addEventListener("contextmenu", (event) => {
      const target = event.target as HTMLElement;
      const item = target.closest(".ac-dock__item") as HTMLElement | null;
      if (!item?.dataset.path) return;
      const asset = this.assets.find((entry) => entry.path === item.dataset.path);
      if (!asset) return;
      event.preventDefault();
      this.openMenu(asset, event);
    });
  }

  private openMenu(asset: AcAsset, event: MouseEvent): void {
    const menu = new Menu("ac-dock-menu");
    menu.addItem({
      icon: "iconEdit",
      label: t(this.host, "open"),
      click: () => this.host.openAsset(asset),
    });
    menu.addItem({
      icon: "iconCopy",
      label: t(this.host, "duplicate"),
      click: () => void this.host.duplicateAsset(asset.path).then(() => this.refresh()),
    });
    menu.addItem({
      icon: "iconEdit",
      label: t(this.host, "rename"),
      click: () => {
        void (async () => {
          const next = await promptText({
            title: t(this.host, "rename"),
            label: t(this.host, "namePlaceholder"),
            value: asset.title,
            confirmText: t(this.host, "save"),
            cancelText: t(this.host, "cancel"),
            isMobile: this.host.isMobile,
            validate: (value) => (value.trim() ? null : t(this.host, "nameRequired")),
          });
          if (!next) return;
          try {
            await this.host.renameAsset(asset, next);
            await this.refresh();
          } catch (error) {
            this.host.notify(error instanceof Error ? error.message : String(error), "error");
          }
        })();
      },
    });
    menu.addItem({
      icon: "iconClock",
      label: t(this.host, "history"),
      click: () => void openHistoryDialog(this.host, asset),
    });
    menu.addItem({
      icon: "iconLink",
      label: t(this.host, "copyLink"),
      click: () => void this.host.copyLink(asset),
    });
    menu.addSeparator();
    menu.addItem({
      icon: "iconTrashcan",
      label: t(this.host, "delete"),
      click: () => void this.host.deleteAsset(asset),
    });
    menu.open({ x: event.clientX, y: event.clientY });
  }

  private async create(): Promise<void> {
    const template = await pickTemplate(this.host);
    if (!template) return;
    const asset = await newFromTemplate(this.host, template);
    if (!asset) return;
    await this.refresh();
    this.host.openAsset(asset);
  }

  private visible(): AcAsset[] {
    const keyword = this.keyword.trim().toLowerCase();
    if (!keyword) return this.assets;
    return this.assets.filter(
      (asset) =>
        asset.title.toLowerCase().includes(keyword) ||
        asset.path.toLowerCase().includes(keyword),
    );
  }

  private updateList(): void {
    if (!this.element) return;
    const listElement = this.element.querySelector(".ac-dock__list");
    if (!listElement) return;
    const visible = this.visible();
    const list = visible
      .map(
        (asset) => `<button type="button" class="ac-dock__item" data-path="${escapeHtml(asset.path)}" title="${escapeHtml(asset.path)}">
  <span class="ac-dock__item-title">${escapeHtml(asset.title)}</span>
  <span class="ac-dock__item-meta">${new Date(asset.updated).toLocaleDateString()}</span>
</button>`,
      )
      .join("");
    listElement.innerHTML =
      list || `<div class="ac-dock__empty">${escapeHtml(t(this.host, "empty"))}</div>`;
    const footer = this.element.querySelector(".ac-dock__footer");
    if (footer) footer.textContent = `${visible.length} · assets/analog-canvas`;
  }

  private render(): void {
    if (!this.element) return;
    this.element.innerHTML = `<div class="ac-dock__header">
  <span class="ac-dock__title">${escapeHtml(t(this.host, "dockTitle"))}</span>
  <span class="ac-dock__actions">
    <button type="button" class="b3-tooltips ac-dock__gallery" aria-label="${escapeHtml(
      t(this.host, "onlineGallery"),
    )}" title="${escapeHtml(t(this.host, "onlineGallery"))}"><svg><use xlink:href="#${GALLERY_ICON_ID}"></use></svg></button>
    <button type="button" class="b3-tooltips ac-dock__refresh" aria-label="${escapeHtml(
      t(this.host, "refresh"),
    )}"><svg><use xlink:href="#iconRefresh"></use></svg></button>
    <button type="button" class="b3-tooltips ac-dock__new" aria-label="${escapeHtml(
      t(this.host, "newCircuit"),
    )}"><svg><use xlink:href="#iconAdd"></use></svg></button>
  </span>
</div>
<div class="ac-dock__search-wrap"><input class="b3-text-field ac-dock__search" type="text" placeholder="${escapeHtml(
      t(this.host, "searchPlaceholder"),
    )}" value="${escapeHtml(this.keyword)}" /></div>
<div class="ac-dock__list"></div>
<div class="ac-dock__footer"></div>`;
    this.updateList();
  }
}
