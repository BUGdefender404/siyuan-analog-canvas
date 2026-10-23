import type { AssetStore } from "./assets";
import { t } from "./host";
import type { AcAsset } from "./types";

const MAX_PROJECT_BYTES = 32 * 1024 * 1024;

export interface ProjectImportHost {
  assetStore: AssetStore;
  i18n: Record<string, string>;
  notify(message: string, type?: "info" | "error"): void;
}

function chooseProjectFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.icproj.json,application/json";
    input.style.display = "none";
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearTimeout(focusTimer);
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(file);
    };
    // Some mobile pickers fire neither change nor cancel; treat the next
    // window focus without a selection as a cancel instead of hanging.
    let focusTimer = 0;
    const onFocus = () => {
      focusTimer = window.setTimeout(() => {
        if (!input.files?.length) finish(null);
      }, 1200);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    window.addEventListener("focus", onFocus);
    const timer = window.setTimeout(() => finish(null), 5 * 60 * 1000);
    document.body.appendChild(input);
    input.click();
  });
}

function projectTitle(fileName: string): string {
  const base = fileName
    .replace(/\.icproj\.json$/iu, "")
    .replace(/\.json$/iu, "")
    .trim();
  return base || "imported";
}

function isProjectFile(value: unknown): value is { schemaVersion: number; documents: unknown[] } {
  if (!value || typeof value !== "object") return false;
  const project = value as { schemaVersion?: unknown; documents?: unknown };
  return (
    Number.isInteger(project.schemaVersion) &&
    Number(project.schemaVersion) > 0 &&
    Array.isArray(project.documents)
  );
}

export async function importProjectFile(
  host: ProjectImportHost,
): Promise<AcAsset | null> {
  const file = await chooseProjectFile();
  if (!file) return null;
  if (file.size > MAX_PROJECT_BYTES) {
    host.notify(t(host, "invalidProjectFile"), "error");
    return null;
  }
  let text: string;
  let parsed: unknown;
  try {
    text = (await file.text()).replace(/^\uFEFF/u, "");
    parsed = JSON.parse(text) as unknown;
  } catch {
    host.notify(t(host, "invalidProjectFile"), "error");
    return null;
  }
  if (!isProjectFile(parsed)) {
    host.notify(t(host, "invalidProjectFile"), "error");
    return null;
  }
  try {
    const asset = await host.assetStore.create(projectTitle(file.name), text);
    host.notify(
      (host.i18n.projectImported ?? "Imported “{name}”").replace("{name}", asset.title),
      "info",
    );
    return asset;
  } catch (error) {
    host.notify(
      (host.i18n.projectImportFailed ?? "Could not import the project: {message}").replace(
        "{message}",
        error instanceof Error ? error.message : String(error),
      ),
      "error",
    );
    return null;
  }
}
