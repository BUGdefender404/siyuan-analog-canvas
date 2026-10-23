# Third-party notices

## Analog Canvas

- Project: **Analog Canvas**
- Upstream: https://github.com/cascode-ai/analog-canvas
- Pinned commit: `729cfb1ed7e01f3ba5e56bd1aca41ae03731aab4`
  (2026-10-22, version 0.9.2)
- License: **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`)
- Copyright: TokenZhang and the Analog Canvas contributors.

This plugin redistributes a production build of the upstream **offline desktop
composition** under `dist/editor/`. The upstream source is not modified. The
following additive files are built into that bundle:

- `overlay/host/siyuan-host.js` — maps the editor's `/desktop/*` host contract
  to SiYuan plugin messages.
- `overlay/editor/siyuan-preview.html` and
  `overlay/editor/src/entries/siyuan-preview.ts` — a lightweight SVG preview
  entry built with the upstream renderer.
- `overlay/editor/vite.siyuan-preview.config.ts` — the preview build config.
- A build-time string rewrite that replaces the desktop single-window workspace
  id (`desktop-main`) with an asset-scoped id, so multiple SiYuan editor tabs do
  not share recovery state.

The complete corresponding source for the AGPL build is:

1. this repository (plugin source, shim and build scripts), and
2. the pinned upstream commit above, obtainable from the upstream repository.

The upstream build is fetched and compiled by
`scripts/build-editor.mjs`; the exact pin is recorded in that script and in
`dist/editor/SOURCE.txt`. The plugin icon derives from the upstream NMOS mark;
the marketplace preview embeds an SVG rendered by the upstream renderer.

## Fonts and other assets

The editor bundle contains fonts and symbol artwork that upstream Analog
Canvas already redistributes: Metropolis, ICM Serif (Liberation Serif), DejaVu
Sans, and the Razavi-style schematic symbol set. Their licenses and provenance
are documented in the upstream repository. This plugin does not add or alter
those assets.

## SiYuan

The plugin uses the public SiYuan plugin API. SiYuan is licensed under
AGPL-3.0 by its authors; it is not bundled in this package.

## No warranty

The plugin and the bundled editor are provided “as is”, without warranty of any
kind. See the AGPL-3.0 text in [LICENSE](./LICENSE).
