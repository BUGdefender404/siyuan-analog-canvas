export interface AcAsset {
  /** Workspace-relative path, e.g. assets/analog-canvas/ota-20261023123000-ab12cde.icproj.json */
  path: string;
  /** File name including the .icproj.json extension */
  fileName: string;
  /** Display name derived from the file name */
  title: string;
  updated: number;
}

export type InsertMode = "image" | "interactive";
export type ImageFormat = "png" | "svg";

export interface AcSettings {
  previewHeight: number;
  insertMode: InsertMode;
  imageFormat: ImageFormat;
  /** Absolute folder used as the default location of the export dialog. */
  exportDir: string;
  /** Raster scale used for PNG exports and note images. */
  exportScale: number;
  /** Save the project file periodically while the editor is open. */
  autosave: boolean;
  /** Number of history snapshots kept per project. */
  historyLimit: number;
}

export interface AcTemplate {
  id: string;
  file: string;
  blank?: boolean;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
}

export interface AcVersion {
  id: string;
  savedAt: number;
  text: string;
}

export interface DirEntry {
  name: string;
  isDir: boolean;
  updated?: number;
}

export interface SavedFile {
  id: string;
  revision: number;
  name: string;
  path: string;
}

export interface SaveProjectRequest {
  asset: string | null;
  text: string;
  name: string;
  saveAs: boolean;
}

export type BridgeResponse =
  | { __ac: 1; type: "response"; id: string; result: unknown }
  | { __ac: 1; type: "response"; id: string; error: string };

export type BridgeEvent = {
  __ac: 1;
  type: "event";
  event: string;
  payload?: Record<string, unknown>;
};
