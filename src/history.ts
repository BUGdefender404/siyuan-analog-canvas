import { Dialog } from "siyuan";
import { confirmDialog } from "./dialog";
import { t, type PluginHost } from "./host";
import type { AcAsset, AcVersion } from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function formatTime(value: number): string {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function renderVersions(versions: AcVersion[], host: PluginHost): string {
  if (versions.length === 0) {
    return `<div class="ac-history__empty">${escapeHtml(t(host, "noHistory"))}</div>`;
  }
  return versions
    .map(
      (version) => `<div class="ac-history__row">
  <span class="ac-history__time">${escapeHtml(formatTime(version.savedAt))}</span>
  <span class="ac-history__actions">
    <button type="button" class="b3-button b3-button--outline ac-history__restore" data-id="${escapeHtml(
      version.id,
    )}">${escapeHtml(t(host, "restoreVersion"))}</button>
    <button type="button" class="b3-button b3-button--text ac-history__branch" data-id="${escapeHtml(
      version.id,
    )}">${escapeHtml(t(host, "branchVersion"))}</button>
  </span>
</div>`,
    )
    .join("");
}

export async function openHistoryDialog(host: PluginHost, asset: AcAsset): Promise<void> {
  let versions: AcVersion[];
  try {
    versions = await host.assetStore.versions(asset.path);
  } catch (error) {
    host.notify(error instanceof Error ? error.message : String(error), "error");
    return;
  }
  return new Promise((resolve) => {
    const dialog = new Dialog({
      title: `${t(host, "history")} · ${asset.title}`,
      content: `<div class="b3-dialog__content ac-history">
  <p class="ac-history__hint">${escapeHtml(t(host, "historyHint"))}</p>
  <div class="ac-history__list">${renderVersions(versions, host)}</div>
</div>`,
      width: host.isMobile ? "92vw" : "540px",
      height: host.isMobile ? "70vh" : "auto",
      destroyCallback: () => resolve(),
    });
    const list = dialog.element.querySelector(".ac-history__list") as HTMLElement;
    list.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const restore = target.closest(".ac-history__restore") as HTMLElement | null;
      const branch = target.closest(".ac-history__branch") as HTMLElement | null;
      const button = restore ?? branch;
      const version = versions.find((item) => item.id === button?.dataset.id);
      if (!button || !version) return;
      if (restore) {
        void (async () => {
          const confirmed = await confirmDialog({
            title: t(host, "restoreVersion"),
            message: t(host, "confirmRestore").replace("{time}", formatTime(version.savedAt)),
            confirmText: t(host, "restoreVersion"),
            cancelText: t(host, "cancel"),
            isMobile: host.isMobile,
          });
          if (!confirmed) return;
          try {
            await host.restoreVersion(asset, version.id);
            dialog.destroy();
          } catch (error) {
            host.notify(error instanceof Error ? error.message : String(error), "error");
          }
        })();
        return;
      }
      void (async () => {
        try {
          const branched = await host.branchVersion(asset, version.id);
          dialog.destroy();
          host.openAsset(branched);
        } catch (error) {
          host.notify(error instanceof Error ? error.message : String(error), "error");
        }
      })();
    });
  });
}
