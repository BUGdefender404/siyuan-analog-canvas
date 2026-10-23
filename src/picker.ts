import { Dialog, Menu, type Protyle } from "siyuan";
import { promptText } from "./dialog";
import { t, type PluginHost } from "./host";
import { openHistoryDialog } from "./history";
import { newFromTemplate, pickTemplate } from "./templates";
import type { AcAsset } from "./types";

export type PickerMode = "insert" | "open";

interface PickerResult {
  asset: AcAsset;
  created: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function formatDate(value: number): string {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export class AssetPicker {
  private host: PluginHost;

  constructor(host: PluginHost) {
    this.host = host;
  }

  async pick(mode: PickerMode, protyle?: Protyle, targetBlockId?: string): Promise<void> {
    const result = await this.show();
    if (!result) return;
    if (mode === "insert") {
      await this.host.insertAsset(result.asset, protyle, targetBlockId);
      if (result.created && this.host.settings.insertMode === "interactive") {
        this.host.openAsset(result.asset);
      }
      return;
    }
    this.host.openAsset(result.asset);
  }

  async pickForEditor(): Promise<AcAsset | null> {
    return (await this.show())?.asset ?? null;
  }

  private show(): Promise<PickerResult | null> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: PickerResult | null) => {
        if (settled) return false;
        settled = true;
        resolve(value);
        return true;
      };
      const close = (value: PickerResult | null) => {
        if (settle(value)) dialog.destroy();
      };

      const dialog = new Dialog({
        title: t(this.host, "selectCircuit"),
        content: `<div class="ac-picker">
  <div class="ac-picker__toolbar">
    <input class="b3-text-field ac-picker__search" type="text" placeholder="${escapeHtml(t(this.host, "searchPlaceholder"))}" />
    <button class="b3-button b3-button--outline ac-picker__gallery" title="${escapeHtml(
      t(this.host, "openOnlineGallery"),
    )}">${escapeHtml(t(this.host, "galleryTab"))}</button>
    <button class="b3-button b3-button--outline ac-picker__import" title="${escapeHtml(
      t(this.host, "importProjectHint"),
    )}">${escapeHtml(t(this.host, "importProjectShort"))}</button>
    <button class="b3-button b3-button--outline ac-picker__new">${escapeHtml(t(this.host, "newCircuit"))}</button>
  </div>
  <div class="ac-picker__list" role="listbox"></div>
  <div class="ac-picker__hint">↑↓ / Enter · Esc</div>
</div>`,
        width: this.host.isMobile ? "92vw" : "680px",
        height: this.host.isMobile ? "78vh" : "540px",
        destroyCallback: () => settle(null),
      });

      (dialog.element.querySelector(".b3-dialog__content") as HTMLElement | null)?.classList.add(
        "ac-picker-content",
      );
      const root = dialog.element.querySelector(".ac-picker") as HTMLElement;
      const search = root.querySelector(".ac-picker__search") as HTMLInputElement;
      const list = root.querySelector(".ac-picker__list") as HTMLElement;
      let assets: AcAsset[] = [];
      let filtered: AcAsset[] = [];
      let active = 0;
      let busy = false;

      const loadAssets = async () => {
        assets = await this.host.assetStore.list();
        render();
        search.focus();
      };

      const render = () => {
        const keyword = search.value.trim().toLowerCase();
        filtered = keyword
          ? assets.filter(
              (asset) =>
                asset.title.toLowerCase().includes(keyword) ||
                asset.path.toLowerCase().includes(keyword),
            )
          : assets;
        active = Math.min(active, Math.max(0, filtered.length - 1));
        if (filtered.length === 0) {
          list.innerHTML = `<div class="ac-picker__empty">${escapeHtml(
            assets.length === 0 ? t(this.host, "empty") : t(this.host, "noMatch"),
          )}</div>`;
          return;
        }
        list.innerHTML = filtered
          .map(
            (asset, index) => `<div class="ac-picker__row">
  <button type="button" class="ac-picker__item${
    index === active ? " ac-picker__item--active" : ""
  }" data-path="${escapeHtml(asset.path)}">
    <span class="ac-picker__item-title">${escapeHtml(asset.title)}</span>
    <span class="ac-picker__item-meta">${escapeHtml(formatDate(asset.updated))} · ${escapeHtml(
      asset.fileName,
    )}</span>
  </button>
  <button type="button" class="ac-picker__more" data-path="${escapeHtml(asset.path)}" aria-label="${escapeHtml(
    t(this.host, "manage"),
  )}" title="${escapeHtml(t(this.host, "manage"))}">⋯</button>
</div>`,
          )
          .join("");
      };

      const choose = (asset: AcAsset, created: boolean) => {
        close({ asset, created });
      };

      const chooseActive = () => {
        const asset = filtered[active];
        if (asset) choose(asset, false);
      };

      const setActive = (next: number) => {
        if (filtered.length === 0) return;
        active = (next + filtered.length) % filtered.length;
        list.querySelectorAll(".ac-picker__item").forEach((item, index) => {
          item.classList.toggle("ac-picker__item--active", index === active);
        });
        const current = list.querySelectorAll(".ac-picker__item")[active] as HTMLElement | undefined;
        current?.scrollIntoView({ block: "nearest" });
      };

      const openMenu = (asset: AcAsset, event: MouseEvent) => {
        if (busy) return;
        const menu = new Menu("ac-picker-item-menu");
        menu.addItem({
          icon: "iconEdit",
          label: t(this.host, "edit"),
          click: () => {
            close(null);
            this.host.openAsset(asset);
          },
        });
        menu.addItem({
          icon: "iconCopy",
          label: t(this.host, "duplicate"),
          click: () => {
            void (async () => {
              busy = true;
              try {
                await this.host.duplicateAsset(asset.path);
                await loadAssets();
              } catch (error) {
                this.host.notify(error instanceof Error ? error.message : String(error), "error");
              } finally {
                busy = false;
              }
            })();
          },
        });
        menu.addItem({
          icon: "iconClock",
          label: t(this.host, "history"),
          click: () => {
            void openHistoryDialog(this.host, asset);
          },
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
              busy = true;
              try {
                await this.host.renameAsset(asset, next);
                await loadAssets();
              } catch (error) {
                this.host.notify(error instanceof Error ? error.message : String(error), "error");
              } finally {
                busy = false;
              }
            })();
          },
        });
        menu.addSeparator();
        menu.addItem({
          icon: "iconTrashcan",
          label: t(this.host, "delete"),
          click: () => {
            void (async () => {
              busy = true;
              try {
                await this.host.deleteAsset(asset);
                await loadAssets();
              } catch (error) {
                this.host.notify(error instanceof Error ? error.message : String(error), "error");
              } finally {
                busy = false;
              }
            })();
          },
        });
        menu.open({ x: event.clientX, y: event.clientY });
      };

      list.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const more = target.closest(".ac-picker__more") as HTMLElement | null;
        if (more?.dataset.path) {
          const asset = assets.find((item) => item.path === more.dataset.path);
          if (asset) {
            event.stopPropagation();
            openMenu(asset, event);
          }
          return;
        }
        const item = target.closest(".ac-picker__item") as HTMLElement | null;
        if (!item) return;
        const asset = assets.find((entry) => entry.path === item.dataset.path);
        if (asset) choose(asset, false);
      });

      search.addEventListener("input", () => {
        active = 0;
        render();
      });
      search.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive(active + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive(active - 1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          chooseActive();
        } else if (event.key === "Escape") {
          event.preventDefault();
          close(null);
        }
      });

      root.querySelector(".ac-picker__gallery")?.addEventListener("click", () => {
        close(null);
        this.host.openOnlineGallery();
      });

      root.querySelector(".ac-picker__import")?.addEventListener("click", async () => {
        if (busy) return;
        busy = true;
        try {
          const asset = await this.host.importProjectFile();
          if (asset) choose(asset, true);
        } finally {
          busy = false;
        }
      });

      root.querySelector(".ac-picker__new")?.addEventListener("click", async () => {
        const template = await pickTemplate(this.host);
        if (!template) return;
        const asset = await newFromTemplate(this.host, template);
        if (asset) choose(asset, true);
      });

      void loadAssets().catch((error) => {
        list.innerHTML = `<div class="ac-picker__empty">${escapeHtml(String(error))}</div>`;
      });
    });
  }
}
