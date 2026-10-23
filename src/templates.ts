import { Dialog } from "siyuan";
import { sanitizeTitle } from "./assets";
import { TEMPLATE_INDEX_URL } from "./constants";
import { promptText } from "./dialog";
import { t, type PluginHost } from "./host";
import { isChinese } from "./lang";
import type { AcAsset, AcTemplate } from "./types";

interface TemplateIndex {
  templates?: unknown;
}

let cached: AcTemplate[] | null = null;

function plain(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseTemplate(value: unknown): AcTemplate | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = plain(item.id);
  const file = plain(item.file);
  const name = item.name as Record<string, unknown> | undefined;
  const description = item.description as Record<string, unknown> | undefined;
  if (!id || !file || !name || !description) return null;
  return {
    id,
    file,
    blank: item.blank === true,
    name: { zh: plain(name.zh) || id, en: plain(name.en) || id },
    description: {
      zh: plain(description.zh) || "",
      en: plain(description.en) || "",
    },
  };
}

export async function loadTemplates(): Promise<AcTemplate[]> {
  if (cached) return cached;
  try {
    const response = await fetch(TEMPLATE_INDEX_URL, { cache: "no-store" });
    if (!response.ok) return [];
    const index = (await response.json()) as TemplateIndex;
    const templates = Array.isArray(index.templates)
      ? index.templates.map(parseTemplate).filter((item): item is AcTemplate => Boolean(item))
      : [];
    cached = templates;
    return templates;
  } catch {
    return [];
  }
}

export function templateName(template: AcTemplate): string {
  return isChinese() ? template.name.zh : template.name.en;
}

export function templateDescription(template: AcTemplate): string {
  return isChinese() ? template.description.zh : template.description.en;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

export async function pickTemplate(host: PluginHost): Promise<AcTemplate | null> {
  const templates = await loadTemplates();
  if (templates.length === 0) {
    host.notify(t(host, "templateLoadFailed"), "error");
    return null;
  }
  return new Promise((resolve) => {
    let settled = false;
    let dialog: Dialog | null = null;
    const finish = (value: AcTemplate | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
      dialog?.destroy();
    };
    const cards = templates
      .map(
        (template) => `<button type="button" class="ac-templates__card" data-template="${escapeHtml(
          template.id,
        )}">
  <span class="ac-templates__name">${escapeHtml(templateName(template))}</span>
  <span class="ac-templates__desc">${escapeHtml(templateDescription(template))}</span>
</button>`,
      )
      .join("");
    dialog = new Dialog({
      title: t(host, "templateLibrary"),
      content: `<div class="b3-dialog__content ac-templates">
  <p class="ac-templates__hint">${escapeHtml(t(host, "templateHint"))}</p>
  <div class="ac-templates__grid">${cards}</div>
</div>`,
      width: host.isMobile ? "92vw" : "620px",
      height: host.isMobile ? "70vh" : "auto",
      destroyCallback: () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    });
    dialog.element.querySelectorAll<HTMLElement>("[data-template]").forEach((card) => {
      card.addEventListener("click", () => {
        const template = templates.find((item) => item.id === card.dataset.template);
        if (template) finish(template);
      });
    });
  });
}

export async function newFromTemplate(
  host: PluginHost,
  template: AcTemplate,
): Promise<AcAsset | null> {
  const title = await promptText({
    title: t(host, "newCircuit"),
    label: t(host, "namePlaceholder"),
    value: template.blank ? t(host, "newProject") : templateName(template),
    confirmText: t(host, "create"),
    cancelText: t(host, "cancel"),
    isMobile: host.isMobile,
    validate: (value) => (value.trim() ? null : t(host, "nameRequired")),
  });
  if (!title) return null;
  try {
    const asset = await host.assetStore.createFromTemplate(sanitizeTitle(title), template);
    host.refreshDock();
    return asset;
  } catch (error) {
    host.notify(error instanceof Error ? error.message : String(error), "error");
    return null;
  }
}
