import { Dialog } from "siyuan";
import { DEFAULT_PREVIEW_HEIGHT } from "./constants";
import type { AcSettings } from "./types";

export interface SettingsHost {
  i18n: Record<string, string>;
  settings: AcSettings;
  isMobile: boolean;
  saveSettings(settings: AcSettings): Promise<void>;
  pickExportDir(): Promise<string | null>;
  notify(message: string, type?: "info" | "error"): void;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

export function openSettings(host: SettingsHost): void {
  const dialog = new Dialog({
    title: host.i18n.settingsTitle,
    content: `<div class="b3-dialog__content ac-settings">
  <label class="ac-settings__row">
    <span>${escapeHtml(host.i18n.insertMode)}</span>
    <select class="b3-select ac-settings__mode">
      <option value="image">${escapeHtml(host.i18n.insertModeImage)}</option>
      <option value="interactive">${escapeHtml(host.i18n.insertModeInteractive)}</option>
    </select>
  </label>
  <label class="ac-settings__row">
    <span>${escapeHtml(host.i18n.imageFormat)}</span>
    <select class="b3-select ac-settings__format">
      <option value="png">${escapeHtml(host.i18n.imageFormatPng)}</option>
      <option value="svg">${escapeHtml(host.i18n.imageFormatSvg)}</option>
    </select>
  </label>
  <label class="ac-settings__row">
    <span>${escapeHtml(host.i18n.defaultPreviewHeight)}</span>
    <input class="b3-text-field ac-settings__height" type="number" min="160" max="900" step="20" value="${host.settings.previewHeight}" />
  </label>
  <div class="ac-settings__row">
    <span>${escapeHtml(host.i18n.defaultExportDir)}</span>
    <div class="ac-settings__path">
      <input class="b3-text-field ac-settings__export-dir" type="text" spellcheck="false" value="${escapeHtml(host.settings.exportDir)}" placeholder="${escapeHtml(host.i18n.exportDirPlaceholder)}" />
      <button class="b3-button b3-button--outline ac-settings__browse">${escapeHtml(host.i18n.chooseFolder)}</button>
    </div>
  </div>
  <p class="ac-settings__note">${escapeHtml(host.i18n.insertModeHint)}</p>
  <p class="ac-settings__note">${escapeHtml(host.i18n.defaultExportDirHint)}</p>
  <p class="ac-settings__note">${escapeHtml(host.i18n.projectStorageHint)} · Analog Canvas ${escapeHtml(
    typeof __PLUGIN_VERSION__ === "string" ? __PLUGIN_VERSION__ : "",
  )}</p>
  <div class="ac-dialog__actions">
    <button class="b3-button b3-button--cancel">${escapeHtml(host.i18n.cancel)}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text">${escapeHtml(host.i18n.save)}</button>
  </div>
</div>`,
    width: host.isMobile ? "92vw" : "480px",
  });
  const content = dialog.element.querySelector(".b3-dialog__content") as HTMLElement;
  const mode = content.querySelector(".ac-settings__mode") as HTMLSelectElement;
  const format = content.querySelector(".ac-settings__format") as HTMLSelectElement;
  const exportDir = content.querySelector(".ac-settings__export-dir") as HTMLInputElement;
  const browse = content.querySelector(".ac-settings__browse") as HTMLButtonElement;
  mode.value = host.settings.insertMode;
  format.value = host.settings.imageFormat;
  content.querySelector(".b3-button--cancel")?.addEventListener("click", () => dialog.destroy());
  browse.addEventListener("click", async () => {
    browse.disabled = true;
    try {
      const directory = await host.pickExportDir();
      if (directory) exportDir.value = directory;
    } finally {
      browse.disabled = false;
    }
  });
  content.querySelector(".b3-button--text")?.addEventListener("click", async () => {
    const input = content.querySelector(".ac-settings__height") as HTMLInputElement;
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 160 || value > 900) {
      input.focus();
      return;
    }
    host.settings.insertMode = mode.value === "interactive" ? "interactive" : "image";
    host.settings.imageFormat = format.value === "svg" ? "svg" : "png";
    host.settings.previewHeight = Math.round(value) || DEFAULT_PREVIEW_HEIGHT;
    host.settings.exportDir = exportDir.value.trim();
    await host.saveSettings(host.settings);
    dialog.destroy();
    host.notify(host.i18n.saved, "info");
  });
}
