# Marketplace release checklist

This plugin is distributed through the SiYuan community bazaar. The bazaar only
reads the **Latest GitHub Release** of the listed repository and expects a
`package.zip` at its root.

## One-time listing

1. Create a public GitHub repository named `siyuan-analog-canvas` under
   `BUGdefender404` (the name must match `plugin.json.name`).
2. Push this source and make sure the repository license is AGPL-3.0.
3. Create a tag and push it:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

   The `Release` workflow builds the plugin and the bundled editor and uploads
   `package.zip` to the GitHub Release. Wait for the workflow to finish and
   check that the release contains `package.zip`.
4. Fork `siyuan-note/bazaar`, add exactly one line to `plugins.txt`:

   ```text
   BUGdefender404/siyuan-analog-canvas
   ```

   Open a PR to `main`. The PR check validates the release manifest, icon,
   preview, readme files and zip layout.
5. After the PR is merged, the bazaar index updates within a few hours.
   Restart SiYuan if the plugin does not appear immediately.

## Publishing an update

1. Bump `version` in **both** `plugin.json` and `package.json`.
2. Commit, tag `vX.Y.Z`, push the tag.
3. Wait for the Release workflow to publish the new `package.zip`.
4. No bazaar PR is needed; the index picks up the new Latest Release.

## Package rules

- `package.zip` root must contain `plugin.json`, `index.js`, `icon.png`,
  `preview.png`, `README.md` and the declared `README_zh_CN.md`.
- `icon.png` must be PNG/JPEG/WebP/AVIF and ≤ 64 KiB; `preview.png` ≤ 512 KiB.
- The zip must not contain a wrapper directory, backslash paths or symlinks.
- The bundle includes `editor/` (≈8 MB); do not exclude it — it is the
  offline editor. The package is about 3 MB.
- The source of the AGPL editor is the public upstream commit recorded in
  `THIRD_PARTY_NOTICES.md`; keep the build script and shim in this repository.
