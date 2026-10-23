# Analog Canvas for SiYuan

[中文说明](./README_zh_CN.md)

Draw professional analog schematics inside SiYuan with the open-source
[Analog Canvas](https://github.com/cascode-ai/analog-canvas) editor. The editor
is bundled with the plugin, so it works offline and saves projects into your
SiYuan workspace — no cloud account is required.

![Analog Canvas in SiYuan](./preview.png)

## Features

- **Insert the finished drawing as a normal image** in the note — PNG by
  default, SVG optional. It behaves like any other SiYuan image and is part of
  the document.
- **The source stays editable**: each image is backed by an
  `assets/analog-canvas/*.icproj.json` file. Right-click the image →
  **编辑电路图** to reopen it.
- **One-click insert**: in the editor, click the floating **插入到笔记** button.
  The plugin saves the source, exports the image, and inserts it after the block
  where you typed `/ac`.
- **Full editor in a SiYuan tab** with the complete Analog Canvas toolset:
  devices, hierarchical cells, wires, labels, properties, and netlist editing.
- **Ctrl/Cmd+S saves directly** into `assets/analog-canvas` as
  `.icproj.json`.
- **Export SVG / PNG / PDF / SPICE / Spectre** through the editor's File menu.
  A native Save As dialog lets you choose the destination, and Settings has a
  default export folder.
- **Circuit management**: the picker's **⋯** menu and the circuit dock support
  open, duplicate, rename and delete.
- **Optional interactive preview mode**: insert a live preview block instead of
  a static image (Settings → Insert as).
- **Asset-based storage** so circuits and images travel with SiYuan sync,
  export and backups.

## Requirements

- SiYuan **3.1.0** or newer.
- About **20 MB** of disk space for the bundled editor.
- Desktop is recommended. The preview works on mobile; the full editor also
  opens in a full-screen dialog on mobile but is heavy.

## Usage

1. Install and enable the plugin.
2. In a note, type `/ac` (or “插入电路图”) and choose **新建电路图** or an
   existing project.
3. Draw the schematic in the editor tab. When done, click the floating
   **插入到笔记** button (PNG by default). The plugin saves the source, exports
   the image, and inserts it after the block where `/ac` was typed.
   To export a file instead, use **File → Export → Drawing as PNG/SVG**; the
   plugin opens a native Save As dialog so you can choose the destination.
4. Right-click the inserted image → **编辑电路图** to edit it again. After
   editing, click the floating **更新笔记图片** button; both the source
   `.icproj.json` and the image in the note are updated. Set the default
   folder for the export dialog under **Settings → Default export folder**;
   leave it empty to use the last system location.
5. The picker's **⋯** menu manages circuits (open, duplicate, rename, delete).
   The left circuit dock offers the same actions.

You can also open the asset picker from the top-bar button, the circuit dock,
or the command palette (`Open Analog Canvas`, `Alt+Cmd+A` on macOS). Opening an
existing project from those entry points does not insert it; use `/ac` in a
note when you want the image in the document.

## Storage and portability

```text
<workspace>/data/assets/analog-canvas/
├── five-transistor-ota-20261023123000-ab12cde.icproj.json   # source
├── five-transistor-ota-20261023123000-ab12cde.png            # inserted image
└── ...
```

Because projects and images are normal SiYuan assets, they are included in
workspace export, sync and backup. The image block stores the source path in
its `custom-data-assets` attribute and the image path in
`custom-ac-image-path`.

> Do not rename or move the `.icproj.json` files outside SiYuan while notes
> reference them; use the plugin's rename action, which updates the references.

## What is bundled

- The **offline desktop composition** of Analog Canvas was built from the
  upstream repository at commit `729cfb1ed7e01f3ba5e56bd1aca41ae03731aab4`.
- The upstream source is **not modified**. The plugin injects a small host shim
  that maps the editor's `/desktop/*` file bridge to the SiYuan plugin.
- The editor's cloud features (account, Cloud Projects, Community Gallery,
  Agent, hosted simulation) are not included; the offline editor does not need
  them.
- Local user-component library is currently disabled.

## Build from source

Requirements: Node.js 24+, pnpm via Corepack, Git.

```bash
pnpm install
pnpm build          # builds the plugin, the editor bundle, and the SVG preview
pnpm package        # creates package.zip
pnpm make-link      # link dist/ into a SiYuan workspace (see --force)
```

`pnpm build` fetches the pinned upstream commit from GitHub (with a mirror
fallback) and builds it. Set `AC_SKIP_EDITOR_BUILD=1` to reuse an existing
`dist/editor` while iterating on plugin code.

## Known limitations

- The bundled editor UI is English; the plugin's own dialogs are Chinese/English.
- Cloud Projects, Community Gallery, Agent, hosted simulation and the local
  user-component library are not included. Local SPICE/Spectre netlist export,
  hierarchy and SVG/PNG/PDF export work offline.
- Use one circuit per editor tab. The editor can open several project tabs
  internally, but the SiYuan tab tracks the first project for its title and
  export metadata.
- After updating an image, the note may keep the old bitmap cached; reopen the
  note to be sure. The source is always up to date.
- Renaming a circuit that is open in the editor is refused; close the editor
  first. Renaming updates image references, but an optional interactive preview
  block created earlier must be re-inserted.
- Interactive preview mode is available in settings but the default is a static
  image.
- The native Save As dialog is desktop-only; browsers and mobile fall back to
  the browser save/download flow.
- The full editor is heavy on mobile. The image insertion and the full-screen
  mobile editor work, but desktop is recommended.

## Marketplace

The plugin is submitted to the official SiYuan community bazaar. See
[docs/marketplace.md](./docs/marketplace.md) for the release checklist and the
`plugins.txt` PR instructions.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

This plugin is licensed under **AGPL-3.0-only**, because it distributes a build
of Analog Canvas, which is also AGPL-3.0-only. The complete corresponding source
is this repository plus the pinned upstream commit listed in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

Copyright (C) 2026 Ray Zhang and contributors.

Analog Canvas is created by TokenZhang and the Analog Canvas contributors:
<https://github.com/cascode-ai/analog-canvas>.
