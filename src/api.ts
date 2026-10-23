import { fetchSyncPost } from "siyuan";
import type { DirEntry } from "./types";

function appId(): string | null {
  try {
    const id = (window as unknown as { siyuan?: { ws?: { app?: { appId?: string } } } }).siyuan?.ws?.app?.appId;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

export async function kernelPost<T>(url: string, data: unknown): Promise<T> {
  const response = await fetchSyncPost(url, data as never);
  if (response.code !== 0) {
    throw new Error(response.msg || `SiYuan API failed: ${url}`);
  }
  return response.data as T;
}

export async function readDir(path: string): Promise<DirEntry[]> {
  return kernelPost<DirEntry[]>("/api/file/readDir", { path });
}

function authHeaders(): Record<string, string> {
  try {
    const token = (window as unknown as { siyuan?: { config?: { api?: { token?: string } } } }).siyuan
      ?.config?.api?.token;
    return token ? { Authorization: `Token ${token}` } : {};
  } catch {
    return {};
  }
}

export async function readTextFile(path: string): Promise<string> {
  const response = await fetch("/api/file/getFile", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    throw new Error(`Cannot read ${path} (HTTP ${response.status})`);
  }
  return response.text();
}

export async function readBinaryFile(path: string): Promise<Uint8Array> {
  const response = await fetch("/api/file/getFile", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    throw new Error(`Cannot read ${path} (HTTP ${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function putTextFile(path: string, text: string, name: string): Promise<void> {
  const form = new FormData();
  form.append("path", path);
  form.append("isDir", "false");
  form.append("modTime", Date.now().toString());
  form.append("file", new File([text], name, { type: "application/json" }));
  const id = appId();
  if (id) form.append("app", id);
  await kernelPost("/api/file/putFile", form);
}

export async function putBinaryFile(path: string, bytes: Uint8Array, name: string, mediaType: string): Promise<void> {
  const form = new FormData();
  form.append("path", path);
  form.append("isDir", "false");
  form.append("modTime", Date.now().toString());
  const copy = new Uint8Array(bytes);
  form.append("file", new File([copy.buffer], name, { type: mediaType }));
  const id = appId();
  if (id) form.append("app", id);
  await kernelPost("/api/file/putFile", form);
}

export async function removeFile(path: string): Promise<void> {
  const data: Record<string, string> = { path };
  const id = appId();
  if (id) data.app = id;
  await kernelPost("/api/file/removeFile", data);
}

export async function renameFile(path: string, newPath: string): Promise<void> {
  await kernelPost("/api/file/renameFile", { path, newPath });
}

export function assetFsPath(assetPath: string): string {
  return `/data/${assetPath.replace(/^\/+/, "")}`;
}
