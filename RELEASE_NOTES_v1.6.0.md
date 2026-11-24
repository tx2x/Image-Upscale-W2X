# Image Upscale W2X v1.6.0

More ways to save your results: **AVIF**, **JPEG XL**, **OxiPNG-optimized PNG**, a **metadata** switch, and a clear indication while big files are being saved.

## What's new

### 🖼 New output formats
- **AVIF** and **JPEG XL** join PNG, JPEG and WebP.
- **PNG is now optimized with OxiPNG** for noticeably smaller files. Choose *Fast*, *Balanced* or *Maximum* in **Advanced → PNG optimization**.
- **Output format** now sits in the main settings panel, right above *Color profile*.

### 🏷 Metadata
- New **Keep metadata** switch: copies EXIF and XMP from the original into the result in every format (with the orientation already applied), or removes them for privacy.
- Color profiles keep working as before and are controlled separately by *Color profile*.

### ⏳ No more “is it frozen?”
- When the upscale is done and the file is being saved, the row shows an **animated bar**, the current step (*Optimizing PNG*, *Encoding AVIF*, …) and a **running timer**.

### ⭐ Recommended models
- `realesr-general-wdn-x4v3` is no longer marked as recommended. The recommended models are `Universal-FastV2-W2xEX`, `Photo-Small-W2xEX` and `Anime-HQ-W4xEX`.

## Upgrading from 1.5.0
Unpack the new version over the old one; `bin/`, `models/` and `output/` are kept. OxiPNG and the JPEG XL encoder are downloaded by the setup on a fresh install; when upgrading, pick the format and press the **Install** button that appears (OxiPNG is optional, JPEG XL needs the encoder).

## Good to know
- Official JPEG XL encoder downloads exist for **Windows x64 and Linux x64**. On other systems, put `cjxl` in your `PATH`.
- JPEG XL is not displayed by every browser or app yet. The compare viewer uses a lossless preview for it. For maximum compatibility choose AVIF or PNG.
- AVIF and JPEG XL encoding, and Maximum PNG optimization, can take a while on large images.
- WebP is limited to 16 383 px and JPEG to 65 535 px per side; the app tells you before upscaling if a result would not fit.
- **This project does not contain any models.** They are downloaded on request and belong to their authors; check each model's license before use, especially commercially.
- The engine has no native CPU mode. A software Vulkan driver (e.g. Mesa `llvmpipe`) is listed as `CPU (software)` and works, but is very slow.

See the [CHANGELOG](CHANGELOG.md) for the full list.
