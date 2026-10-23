import type { Protyle } from "siyuan";
import type { AssetStore } from "./assets";
import type { AcAsset, AcSettings } from "./types";

export interface PluginHost {
  i18n: Record<string, string>;
  settings: AcSettings;
  isMobile: boolean;
  assetStore: AssetStore;
  insertAsset(asset: AcAsset, protyle?: Protyle, targetBlockId?: string): Promise<void>;
  openAsset(asset: AcAsset): void;
  deleteAsset(asset: AcAsset): Promise<void>;
  renameAsset(asset: AcAsset, newTitle: string): Promise<void>;
  duplicateAsset(path: string): Promise<AcAsset>;
  restoreVersion(asset: AcAsset, version: string): Promise<void>;
  branchVersion(asset: AcAsset, version: string): Promise<AcAsset>;
  copyLink(asset: AcAsset): Promise<void>;
  importProjectFile(): Promise<AcAsset | null>;
  openOnlineGallery(): void;
  notify(message: string, type?: "info" | "error"): void;
  refreshDock(): void;
}

export function t(host: Pick<PluginHost, "i18n">, key: string): string {
  return host.i18n[key] ?? key;
}
