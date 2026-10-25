# Changelog

## 0.2.2 — 2026-10-25

- **Marketplace README cleanup**: removed the duplicated `preview.png` at the
  top of both READMEs; the bazaar already renders the package preview.
- **Gallery screenshots in the docs**: added community-gallery and sign-in
  screenshots under `docs/images/` and documented them in the Online Gallery
  section. The images use the `gcore.jsdelivr.net` mirror so they are not
  rewritten to the blocked `cdn.jsdelivr.net` host in the bazaar detail page.
- No plugin code changes; this is a documentation-only patch release.

## 0.2.1 — 2026-10-24

- **Online Gallery sign-in inside SiYuan**: the Gallery now opens a first-party
  Electron sign-in window so its session cookie can be used by the sidebar.
  Email codes work there, and GitHub/Google sign-in opens in the same window.
  Browser login state is intentionally not shared (separate cookie stores).
- **OAuth from the embedded Gallery**: clicking GitHub or Google in the
  sidebar's Gallery sign-in panel now opens the in-app sign-in window instead
  of trying to load the provider inside the cross-origin iframe.
- **Session cookie compatibility**: the Gallery session cookie is rewritten to
  `SameSite=None; Secure` for the embedded sidebar and the frame reloads when
  the sign-in completes.
- **Configurable chrome**: Settings can show or hide the **Open Analog Canvas**
  top-bar button and the **Online Gallery** right-sidebar icon. The separate
  Gallery top-bar button was removed.
- Loading state fixes for the Gallery panel; the i18n hint now explains that a
  browser sign-in is not shared with SiYuan.

## 0.2.0 — 2026-10-24

- **Common circuit templates**: blank, common-source amplifier, current-mirror
  differential pair, two-stage op-amp and five-transistor OTA (Sky130) are
  available from **New** in the picker and dock.
- **Autosave every 15 seconds** while the editor is open (configurable in
  Settings); manual saves still work as before.
- **Version snapshots**: the previous file is kept in
  `assets/analog-canvas/.history` before each save (20 by default), with a
  **Version history** action in the image, picker and dock menus to restore or
  branch a version.
- **Close protection**: closing a dirty editor tab, pressing Ctrl/Cmd+W, or
  quitting SiYuan asks whether to save, discard or cancel.
- **High-quality PNG**: configurable 1×–6× export scale (default 3×) for note
  images and exports.
- **Copy to clipboard**: copy PNG or SVG from the note image menu or the
  editor's floating action bar.
- **Online Gallery sidebar**: browse the hosted Analog Canvas Gallery from a
  resizable SiYuan sidebar (top bar, picker, dock, editor floating bar or
  Settings), with quick links to the Gallery and online editor, refresh,
  browser fallback and project import. The empty-tab fallback is fixed.
- **Insert a circuit from the clipboard**: copy a whole circuit or a selection
  in the online Gallery, then use **Insert circuit** (or
  `Ctrl/Cmd+Shift+V`) in the local editor to place it on the current drawing.
  The payload is validated as an Analog Canvas circuit envelope first.
- **Import `.icproj.json`**: load a project exported from the online editor
  into `assets/analog-canvas` from the picker or the Gallery sidebar.
- **Slimmer bundle**: the static image preview replaces the bundled SVG
  renderer, PDF export and the RNL WebAssembly runtime are removed, and module
  preloading is disabled. The editor is about 8 MB (was 20 MB); the packaged
  plugin is about 3 MB (was 8 MB).
- Native save-dialog RPC timeout extended from 2 minutes to 15 minutes.

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
