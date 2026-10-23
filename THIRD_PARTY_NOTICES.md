# Third-party notices

## Analog Canvas

- Project: **Analog Canvas**
- Upstream: https://github.com/cascode-ai/analog-canvas
- Pinned commit: `729cfb1ed7e01f3ba5e56bd1aca41ae03731aab4`
  (2026-10-22, version 0.9.2)
- License: **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`)
- Copyright: TokenZhang and the Analog Canvas contributors.

This plugin redistributes a production build of the upstream **offline desktop
composition** under `dist/editor/`. The upstream source receives small
build-time patches, all applied by `scripts/build-editor.mjs`:

- **PNG scale**: the SiYuan setting is passed to the upstream rasterizer
  (`__acExportScale`) instead of using the fixed 3× default.
- **PDF export removed**: the File-menu button and both dynamic imports of
  `@icm/exporters/browser-pdf` are removed, which also drops jsPDF,
  html2canvas and the embedded TTF fonts.
- **RNL runtime removed**: `loadRnlRuntime` returns `null`, so the 2.3 MB
  WebAssembly worker and its runtime are not bundled. SVG/PNG output and
  SPICE/Spectre netlists are unaffected.
- **Module preloading disabled** in the desktop Vite build to reduce startup
  memory.
- A build-time string rewrite that replaces the desktop single-window workspace
  id (`desktop-main`) with an asset-scoped id, so multiple SiYuan editor tabs do
  not share recovery state.

The following additive files are built into that bundle:

- `overlay/host/siyuan-host.js` — maps the editor's `/desktop/*` host contract
  to SiYuan plugin messages, and adds autosave/close-warning integration.
- `overlay/editor/siyuan-preview.html` — a dependency-free preview page that
  displays the exported image (it does not include the upstream renderer).

The complete corresponding source for the AGPL build is:

1. this repository (plugin source, shim, build scripts and patches), and
2. the pinned upstream commit above, obtainable from the upstream repository.

The upstream build is fetched and compiled by
`scripts/build-editor.mjs`; the exact pin is recorded in that script and in
`dist/editor/SOURCE.txt`. The plugin icon derives from the upstream NMOS mark;
the marketplace preview embeds an SVG rendered by the upstream renderer. The
bundled circuit templates are the upstream example projects (AGPL-3.0-only).

## Online Gallery

The optional Online Gallery sidebar links to
<https://analog-canvas.tokenzhang.com/>, the hosted Analog Canvas Community
Gallery. No Gallery page, account data or community circuit is bundled with
this plugin. Gallery circuits remain subject to their authors' terms; the
plugin only passes a circuit the user explicitly copies into the local editor.

## Fonts and other assets

The editor bundle contains the small schematic WebFont subsets and symbol
artwork that upstream Analog Canvas already redistributes: Metropolis, ICM
Serif, DejaVu Sans (schematic subsets), and the Razavi-style schematic symbol
set. The PDF-only TTF families (full DejaVu, Liberation Serif and Metropolis
TTFs) are not included. Licenses and provenance are documented in the upstream
repository. This plugin does not add or alter those assets.

## SiYuan

The plugin uses the public SiYuan plugin API. SiYuan is licensed under
AGPL-3.0 by its authors; it is not bundled in this package.

## No warranty

The plugin and the bundled editor are provided “as is”, without warranty of any
kind. See the AGPL-3.0 text in [LICENSE](./LICENSE).
