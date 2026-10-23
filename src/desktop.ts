interface ElectronModule {
  ipcRenderer?: {
    invoke(channel: string, payload: Record<string, unknown>): Promise<unknown>;
  };
}

interface FsModule {
  writeFileSync(path: string, data: Uint8Array): void;
}

interface SaveDialogResult {
  canceled?: boolean;
  filePath?: string;
}

interface OpenDialogResult {
  canceled?: boolean;
  filePaths?: string[];
}

interface WritableFile {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

interface SaveHandle {
  name: string;
  createWritable(): Promise<WritableFile>;
}

type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<SaveHandle>;

function requireModule<T>(name: string): T | null {
  const request = (globalThis as { require?: (id: string) => unknown }).require;
  if (typeof request !== "function") return null;
  try {
    return request(name) as T;
  } catch {
    return null;
  }
}

function baseMediaType(mediaType: string): string {
  return mediaType.split(";")[0].trim().toLowerCase();
}

function extensionFor(mediaType: string, name: string): string {
  const known: Record<string, string> = {
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/jpeg": "jpg",
    "application/pdf": "pdf",
    "application/json": "json",
    "text/plain": "txt",
    "text/csv": "csv",
  };
  const media = baseMediaType(mediaType);
  const expected = known[media];
  const fromName = /\.([a-z0-9]{1,8})$/iu.exec(name)?.[1]?.toLowerCase();
  if (fromName && (!expected || expected === fromName || media === "text/plain" || media === "application/octet-stream")) {
    return fromName;
  }
  return expected ?? fromName ?? "bin";
}

export function exportFileName(name: string, mediaType: string): string {
  const extension = extensionFor(mediaType, name);
  const stem = name
    .replace(/\.[a-z0-9]{1,8}$/iu, "")
    .replace(/[\\/:*?"<>|]/gu, "_")
    .replace(/\s+/gu, " ")
    .replace(/^[.\s]+|[.\s]+$/gu, "")
    .slice(0, 120);
  return `${stem || "circuit"}.${extension}`;
}

function joinPath(directory: string, name: string): string {
  const trimmed = directory.trim().replace(/[\\/]+$/u, "");
  if (!trimmed) return name;
  const separator = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  return `${trimmed}${separator}${name}`;
}

function filtersFor(name: string, mediaType: string): Array<{ name: string; extensions: string[] }> {
  const extension = extensionFor(mediaType, name);
  return [{ name: extension.toUpperCase(), extensions: [extension] }];
}

export async function chooseDirectory(options: {
  title: string;
  defaultPath?: string;
}): Promise<string | null> {
  const electron = requireModule<ElectronModule>("electron");
  if (!electron?.ipcRenderer) return null;
  try {
    const result = (await electron.ipcRenderer.invoke("siyuan-get", {
      cmd: "showOpenDialog",
      title: options.title,
      defaultPath: options.defaultPath?.trim() || undefined,
      properties: ["openDirectory", "createDirectory"],
    })) as OpenDialogResult | undefined;
    if (!result || result.canceled || !result.filePaths?.length) return null;
    return result.filePaths[0] ?? null;
  } catch {
    return null;
  }
}

export type SaveFileResult =
  | { status: "saved"; path: string }
  | { status: "downloaded"; path: string }
  | { status: "cancelled"; path: "" };

export async function saveFileAs(options: {
  name: string;
  defaultDir: string;
  bytes: Uint8Array;
  mediaType: string;
  title: string;
}): Promise<SaveFileResult> {
  const fileName = exportFileName(options.name, options.mediaType);
  const electron = requireModule<ElectronModule>("electron");
  const fs = requireModule<FsModule>("fs");
  if (electron?.ipcRenderer && fs) {
    try {
      const result = (await electron.ipcRenderer.invoke("siyuan-get", {
        cmd: "showSaveDialog",
        title: options.title,
        defaultPath: joinPath(options.defaultDir, fileName),
        filters: filtersFor(fileName, options.mediaType),
      })) as SaveDialogResult | undefined;
      if (!result || result.canceled || !result.filePath) {
        return { status: "cancelled", path: "" };
      }
      fs.writeFileSync(result.filePath, options.bytes);
      return { status: "saved", path: result.filePath };
    } catch {
      // Fall through to the browser save picker when the desktop bridge is unavailable.
    }
  }

  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const extension = extensionFor(options.mediaType, fileName);
      const handle = await picker({
        suggestedName: fileName,
        types: [
          {
            description: extension.toUpperCase(),
            accept: { [baseMediaType(options.mediaType) || "application/octet-stream"]: [`.${extension}`] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(options.bytes);
      await writable.close();
      return { status: "saved", path: handle.name };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { status: "cancelled", path: "" };
      }
    }
  }

  const blob = new Blob([options.bytes.slice().buffer], {
    type: options.mediaType || "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { status: "downloaded", path: fileName };
}
