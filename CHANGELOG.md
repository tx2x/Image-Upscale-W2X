# Changelog

All notable changes to **Image Upscale W2X** are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.6.0] - 2026-11-24

### Added
- **AVIF** and **JPEG XL** output formats (AVIF quality 80, JPEG XL quality 90).
- **OxiPNG** optimization for PNG output, with a *PNG optimization* level in Advanced (Fast, Balanced, Maximum). Falls back to standard PNG compression when OxiPNG is missing.
- **Keep metadata** switch: copies EXIF and XMP of the original into PNG, JPEG, WebP, AVIF and JPEG XL results, with the EXIF orientation reset because the pixels are already rotated. With the switch off, no camera or location data is written (the color profile still follows its own setting).
- **Saving indicator**: after the upscale finishes, the file row shows an animated bar, the current step (resizing, optimizing PNG, encoding AVIF/JPEG XL, saving) and a running timer, so long saves no longer look frozen.
- On-demand **install of OxiPNG and the JPEG XL encoder** from the web interface, with a progress bar. The first-run setup now downloads them too (`--skip-tools` to skip).
- Early, readable errors when a result would exceed a format's size limit (WebP 16 383 px, JPEG 65 535 px).
- Compare mode shows a lossless preview for JPEG XL results, since browsers cannot reliably display the format.

### Fixed
- Layout of the *Keep metadata* switch in the settings panel: it no longer overlaps its label, and its on/off state is clear (outlined when off, accent color when on, with an On/Off label).

### Changed
- **Output format** moved out of *Advanced* to the main settings panel, above *Color profile*.
- `realesr-general-wdn-x4v3` is no longer marked as recommended (three recommended models remain).
- Encoding pipeline rebuilt: the color profile, EXIF and XMP are re-attached to a lossless intermediate PNG and carried into the chosen format without touching pixel values.
- Release notes of earlier versions moved to `docs/release-notes/`.

## [1.5.0] - 2026-11-23

### Added
- **Model manager** in the web interface: download models on demand into `models/`, with a progress bar. The catalog lists 18 models with description, native scale, size, author and license.
- **Recommended** badge. The four recommended models (`Universal-FastV2-W2xEX`, `Photo-Small-W2xEX`, `Anime-HQ-W4xEX`, `realesr-general-wdn-x4v3`) are shown at the top of the flat list; they carry a `*` in the model drop-down. Already downloaded models are highlighted in green. The dialog opens automatically when no model is installed.
- **Color profile handling**: embedded ICC profiles (e.g. *Display P3*) are detected and shown as a badge in the file row. New setting **Color profile**: *Keep the original profile* (default; the profile is embedded in PNG, JPEG and WebP results) or *Convert to sRGB* (converted before upscaling; results get an `_srgb` suffix and an *sRGB* tag).
- **Compare mode**: option **Original at native size** to show the original at its own resolution instead of stretching it to the result.
- **Result details**: each result chip shows the output **format**, resolution and **file size**.
- **Delete a result**: a trash button on every result chip removes that variant from the `output/` folder (with confirmation).
- **Compatibility mode** (Advanced): runs the engine with one thread and small tiles.
- **Automatic safe retry**: if the engine fails with a Vulkan error, the job is retried once with safe settings; the device is remembered for the session.
- **Engine output** is shown (expandable) under error messages and printed in the console.
- **Console timing**: every finished, failed or canceled job prints its duration, model, resolution and device.
- Colored outline buttons in file rows: green *Upscale*, blue *Compare*, red *Remove*, amber *Cancel*.
- `CHANGELOG.md`, and a README section dedicated to compare mode, color profiles, model licenses and result management.

### Changed
- Models are **no longer downloaded at startup or by `npm run setup`**; setup fetches only the engine. Models are chosen in the UI.
- The model list is **flat** (no categories); recommended models first.
- New default model: `Universal-FastV2-W2xEX`.
- Model downloads use a different host; the README no longer names any model host and states clearly that the project contains no models, with authors and licenses listed per model.
- `start.bat` runs the server in its own console window (via `cmd /c`), so **Ctrl+C stops it immediately** with no "Terminate batch job (Y/N)?" question. If the server crashes the window stays open.
- Console messages use plain ASCII so they display correctly in any Windows console.
- In network mode, models can only be downloaded from the computer that runs the server.
- Result file names get an `_srgb` suffix when converted to sRGB.

### Fixed
- **Washed-out colors** after upscaling images with an embedded color profile (the profile was dropped while the pixels were left in the wide gamut).
- **Misleading "GPU ran out of memory" message.** Vulkan error codes are now told apart (out of memory, device lost, other), which exposed and fixed failures on **integrated AMD graphics** (verified on Ryzen 5700G).
- **Progress bar sweeping from 0 to 100% many times** on some systems. The bar element is now created once and only its width changes; progress never goes backwards, stays below 100% until the file is finished, and updates are throttled.
- Failed jobs no longer leave stale error details when they are restarted.

### Removed
- Model categories in the download list.

## [1.0.0]

### Added
- Web interface served by a local Node.js server (zero-config, no build step, no CDN, fonts bundled).
- Upscaling with Real-ESRGAN-ncnn-vulkan and the W2xEX models at **×1.5, ×2 (default), ×3 and ×4**, combining native-scale passes with a Lanczos resize.
- Model drop-down, upscale factor selector, Vulkan device picker with device names.
- Drag & drop of images and folders, plus file and folder pickers.
- File list with thumbnail, shortened name, resolution, format and size; upscale one image or all in sequence, with progress and cancel.
- Compare viewer: slider and side-by-side modes, synchronized zoom and pan, any two versions (including different models).
- Auto / Light / Dark theme.
- PNG, JPEG and WebP output; tile size and TTA options.
- Windows and Linux launchers (`start.bat`, `start.sh`); one-time setup that downloads the engine into the project folder; fully offline afterwards.
- Local-only by default, with a `--network` option for LAN access.
