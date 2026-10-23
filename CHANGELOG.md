# Changelog

## 0.1.0 — 2026-10-23

Initial release.

- Bundle the offline Analog Canvas editor (upstream commit
  `729cfb1ed7e01f3ba5e56bd1aca41ae03731aab4`).
- Insert circuits from the slash menu (`/ac` / “插入电路图”), the top bar, or
  the circuit dock.
- **Insert the finished drawing as a normal PNG/SVG image** after the block
  where `/ac` was typed; the source `.icproj.json` is saved first.
- **One-click “插入到笔记” button** in the editor: saves the source, exports the
  image and inserts it.
- **Re-edit from the note**: right-click an inserted image → 编辑电路图.
  Exporting again updates the existing image asset.
- Optional interactive preview mode (live iframe instead of a static image).
- Searchable asset picker with a per-item management menu: open, duplicate,
  rename, delete.
- Circuit dock with open, duplicate, rename, copy link and delete.
- Save projects as `.icproj.json` under `assets/analog-canvas`.
- Editor exports open a native Save As dialog instead of silently writing into
  the workspace; the default export folder is configurable in Settings.
- Export SVG/PNG/PDF/SPICE/Spectre to any chosen location.
- Chinese and English plugin UI; image format, preview-height, and default
  export-folder settings.
- AGPL-3.0-only source and marketplace release workflow.
