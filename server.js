#!/usr/bin/env node
'use strict';
/**
 * Image Upscale W2X – local server.
 * Zero-config HTTP server (Node built-ins + sharp) that wraps
 * Real-ESRGAN-ncnn-vulkan and serves the web UI from ./public.
 *
 * Flags:  --network        listen on all interfaces (LAN access, no auth!)
 *         --host <addr>    listen on a specific address
 *         --port <n>       port (default 7842)
 *         --no-open        do not open the browser automatically
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

let sharp;
try { sharp = require('sharp'); } catch {
  console.error('Missing dependency "sharp". Run:  npm install');
  process.exit(1);
}
sharp.cache(false);
const { TOOLS, findTool, installTool } = require('./lib/install');

/* ───────────────────────── configuration ───────────────────────── */
const argv = process.argv.slice(2);
const hasFlag = (n) => argv.includes(n);
const optVal = (n, d) => {
  const i = argv.findIndex((a) => a === n || a.startsWith(n + '='));
  if (i < 0) return d;
  return argv[i].includes('=') ? argv[i].split('=').slice(1).join('=') : (argv[i + 1] ?? d);
};
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
const HOST = optVal('--host', hasFlag('--network') || process.env.W2X_NETWORK === '1' ? '0.0.0.0' : '127.0.0.1');
const PORT = Number(optVal('--port', process.env.PORT || 7842));
const NETWORK_MODE = !LOOPBACK.includes(HOST);
const AUTO_OPEN = !hasFlag('--no-open');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const MODELS_DIR = path.join(ROOT, 'models');
const OUT_DIR = path.join(ROOT, 'output');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const BIN = process.env.W2X_BIN || path.join(ROOT, 'bin', process.platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan');
const VERSION = require('./package.json').version;

const SCALES = [1.5, 2, 3, 4];
const FORMATS = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', jxl: 'image/jxl' };
const FORMAT_NAMES = { png: 'PNG', jpg: 'JPEG', webp: 'WebP', avif: 'AVIF', jxl: 'JPEG XL' };
const PNG_LEVELS = { fast: '1', balanced: '3', max: '6' }; // OxiPNG -o levels
const MAX_SIDE = { webp: 16383, jpg: 65535 };

const MODEL_BASE = 'https://huggingface.co/rnsoc1/w2xex-model-mirror/resolve/main/models';
const AUTHOR_W2X = 'Aaron Feng (Waifu2x-Extension-GUI). Underlying training authorship not independently established.';
const AUTHOR_RE = 'Xintao Wang and Real-ESRGAN contributors';
const LIC_NONE = 'Not independently established';
const LIC_RE = 'Real-ESRGAN project: BSD 3-Clause. Licence of the weights not independently verified.';
const W = 'W2xEX series', R = 'Real-ESRGAN family';
// rec = recommended (shown with a leading "*"); size = download size in MB (.param + .bin)
const CATALOG = [
  { id: 'Universal-FastV2-W2xEX', label: 'Universal Fast V2', scale: 2, rec: true, group: W, size: 2.5, desc: 'Fast general-purpose model. Best first choice for mixed content.', author: AUTHOR_W2X, license: LIC_NONE },
  { id: 'Photo-Small-W2xEX', label: 'Photo Small', scale: 2, rec: true, group: W, size: 2.5, desc: 'Fast photo model: detail, clarity and compression-artifact removal.', author: AUTHOR_W2X, license: LIC_NONE },
  { id: 'Anime-HQ-W4xEX', label: 'Anime HQ', scale: 4, heavy: true, rec: true, group: W, size: 67, desc: 'High-quality anime and 2D art. Native 4×, slow.', author: AUTHOR_W2X, license: LIC_NONE },
  { id: 'Photo-HQ-W4xEX', label: 'Photo HQ', scale: 4, heavy: true, group: W, size: 67, desc: 'High-quality photos with strong denoising. Native 4×, slow.', author: AUTHOR_W2X, license: LIC_NONE },
  { id: 'Omni-Smallv2-W2xEX', label: 'Omni Small V2', scale: 2, group: W, size: 1.3, desc: 'General-purpose, small and quick.', author: AUTHOR_W2X, license: LIC_NONE },
  { id: 'Omni-TurboV1.5-W2xEX', label: 'Omni Turbo V1.5', scale: 2, group: W, size: 0.7, desc: 'Fast general-purpose model.', author: AUTHOR_W2X, license: LIC_NONE },
  { id: 'Omni-MiniV2-W2xEX', label: 'Omni Mini V2', scale: 2, group: W, size: 0.2, desc: 'Lightweight general-purpose model, extremely fast, lowest quality.', author: AUTHOR_W2X, license: LIC_NONE },
  { id: 'AnimeVideo-MiniV1.8-W2xEX', label: 'AnimeVideo Mini V1.8', scale: 2, group: W, size: 0.1, desc: 'Very fast anime model made for video.', author: AUTHOR_W2X, license: LIC_NONE },
  { id: 'realesr-general-wdn-x4v3', label: 'General WDN v3', scale: 4, group: R, size: 2.5, desc: 'General-purpose with extra denoising. Native 4×.', author: AUTHOR_RE, license: LIC_RE },
  { id: 'realesr-general-x4v3', label: 'General v3', scale: 4, group: R, size: 2.5, desc: 'General-purpose, keeps more texture than the WDN variant. Native 4×.', author: AUTHOR_RE, license: LIC_RE },
  { id: 'realesrgan-x4plus', label: 'x4plus', scale: 4, heavy: true, group: R, size: 33.5, desc: 'Classic general-purpose image model. Native 4×, slow.', author: AUTHOR_RE, license: LIC_RE },
  { id: 'realesrgan-x4plus-anime', label: 'x4plus Anime', scale: 4, group: R, size: 9, desc: 'Anime and illustration model. Native 4×.', author: AUTHOR_RE, license: LIC_RE },
  { id: 'Photo-Conservative-x4', label: 'Photo Conservative', scale: 4, heavy: true, group: R, size: 33.5, desc: 'Conservative photo upscaling that changes less. Native 4×, slow.', author: 'Introduced in Waifu2x-Extension-GUI (Aaron Feng). Upstream authorship not independently established.', license: LIC_NONE },
  { id: 'realesr-animevideov3-x2', label: 'AnimeVideo v3 ×2', scale: 2, group: R, size: 1.3, desc: 'Compact anime video model, native 2×.', author: AUTHOR_RE, license: LIC_RE },
  { id: 'realesr-animevideov3-x3', label: 'AnimeVideo v3 ×3', scale: 3, group: R, size: 1.3, desc: 'Compact anime video model, native 3×.', author: AUTHOR_RE, license: LIC_RE },
  { id: 'realesr-animevideov3-x4', label: 'AnimeVideo v3 ×4', scale: 4, group: R, size: 1.3, desc: 'Compact anime video model, native 4×.', author: AUTHOR_RE, license: LIC_RE },
  { id: 'RealESRGANv2-animevideo-xsx2', label: 'RealESRGANv2 AnimeVideo ×2', scale: 2, group: R, size: 1.3, desc: 'Compact anime video model (v2), native 2×.', author: AUTHOR_RE, license: LIC_RE },
  { id: 'RealESRGANv2-animevideo-xsx4', label: 'RealESRGANv2 AnimeVideo ×4', scale: 4, group: R, size: 1.3, desc: 'Compact anime video model (v2), native 4×.', author: AUTHOR_RE, license: LIC_RE },
];
const CATALOG_BY_ID = new Map(CATALOG.map((c) => [c.id, c]));
// Recommended models first (stable sort keeps the order above inside each part).
const CATALOG_ORDERED = [...CATALOG].sort((a, b) => Number(!!b.rec) - Number(!!a.rec));
const DEFAULT_MODEL = 'Universal-FastV2-W2xEX';

/* ───────────────────────── state ───────────────────────── */
const items = new Map();       // id -> item
const claimedOutputs = new Map(); // output path -> item id
const jobs = [];               // queued + running
let running = null;
let jobSeq = 0;
const sseClients = new Set();
let deviceCache = null;

/* ───────────────────────── helpers ───────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => fs.existsSync(p);
const mimeFor = (p) => ({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
}[path.extname(p).toLowerCase()] || 'application/octet-stream');

function sanitizeName(n) {
  const base = path.basename(String(n || 'image').replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
  return (base || 'image').slice(0, 200);
}
function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
async function readJson(req, limit = 1 << 20) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('Body too large'); chunks.push(c); }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) c.write(msg);
}
function scaleLabel(s) { return Number.isInteger(s) ? String(s) : String(s); }

/* ───────────────────────── models & devices ───────────────────────── */
function listModels() {
  if (!exists(MODELS_DIR)) return [];
  const names = new Set(fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith('.param')).map((f) => f.slice(0, -6)));
  const out = [];
  for (const name of names) {
    if (!exists(path.join(MODELS_DIR, name + '.bin'))) continue;
    const known = CATALOG_BY_ID.get(name);
    let scale = known?.scale;
    if (!scale) {
      const m = name.match(/[Ww]([234])x/) || name.match(/[xX]([234])(?![0-9])/) || name.match(/([234])[xX]/);
      scale = m ? Number(m[1]) : 4;
    }
    out.push({ id: name, label: known?.label || name, scale, recommended: !!known?.rec, heavy: !!known?.heavy, description: known?.desc || 'Custom model.', known: !!known });
  }
  const order = CATALOG_ORDERED.map((c) => c.id);
  out.sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.id.localeCompare(b.id);
  });
  return out;
}

function binaryReady() { return exists(BIN); }

async function detectDevices(force = false) {
  if (deviceCache && !force) return deviceCache;
  if (!binaryReady()) return (deviceCache = []);
  // The engine prints the Vulkan device list when it initialises, then bails out on the invalid GPU id.
  const out = await new Promise((resolve) => {
    let buf = '';
    const child = spawn(BIN, ['-i', '__probe__.png', '-o', '__probe__.png', '-m', 'models', '-n', '__probe__', '-g', '999'], { cwd: ROOT, windowsHide: true });
    const timer = setTimeout(() => child.kill(), 25000);
    child.stdout.on('data', (d) => (buf += d));
    child.stderr.on('data', (d) => (buf += d));
    child.on('error', () => { clearTimeout(timer); resolve(buf); });
    child.on('close', () => { clearTimeout(timer); resolve(buf); });
  });
  const devices = [];
  const seen = new Set();
  const re = /\[(\d+)\s+(.+?)\]\s+queueC=/g;
  let m;
  while ((m = re.exec(out))) {
    const id = Number(m[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    const name = m[2].trim();
    const software = /llvmpipe|lavapipe|swiftshader|software|basic render|microsoft basic|warp/i.test(name);
    const discrete = /nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|radeon vii|arc\b/i.test(name);
    devices.push({ id, name, type: software ? 'cpu' : 'gpu', discrete });
  }
  return (deviceCache = devices);
}

/* ───────────────────────── colour profiles ───────────────────────── */
function iccName(buf) {
  try {
    const n = buf.readUInt32BE(128);
    for (let i = 0; i < n; i++) {
      const off = 132 + i * 12;
      if (buf.toString('latin1', off, off + 4) !== 'desc') continue;
      const o = buf.readUInt32BE(off + 4);
      const type = buf.toString('latin1', o, o + 4);
      if (type === 'desc') {
        const len = buf.readUInt32BE(o + 8);
        return buf.toString('latin1', o + 12, o + 12 + Math.max(0, len - 1)).trim() || null;
      }
      if (type === 'mluc') {
        const len = buf.readUInt32BE(o + 20), rel = buf.readUInt32BE(o + 24);
        return Buffer.from(buf.subarray(o + rel, o + rel + len)).swap16().toString('utf16le').replace(/\0+$/, '').trim() || null;
      }
    }
  } catch { /* fall through */ }
  return null;
}
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// EXIF as stored in a PNG eXIf chunk: the bare TIFF block, with the orientation reset because we already rotated the pixels.
function exifToTiff(buf) {
  if (!buf) return null;
  let i = buf.indexOf(Buffer.from('II*\0'));
  if (i < 0) i = buf.indexOf(Buffer.from('MM\0*'));
  if (i < 0) return null;
  const t = Buffer.from(buf.subarray(i));
  try {
    const le = t.toString('latin1', 0, 2) === 'II';
    const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
    const u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
    const ifd = u32(4), n = u16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (u16(e) === 0x0112) { if (le) t.writeUInt16LE(1, e + 8); else t.writeUInt16BE(1, e + 8); }
    }
  } catch { return null; }
  return t;
}
const pngChunk = (type, data) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};
/**
 * The engine drops all metadata. We rebuild exactly what should survive (color profile, EXIF, XMP) as PNG chunks,
 * without touching the pixels; every encoder below then carries those chunks over into its own format.
 */
function buildTaggedPng(buf, { icc, iccLabel, exif, xmp }) {
  const chunks = [];
  for (let off = 8; off < buf.length;) {
    const len = buf.readUInt32BE(off);
    chunks.push({ type: buf.toString('latin1', off + 4, off + 8), data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  const kept = chunks.filter((c) => !['iCCP', 'sRGB', 'gAMA', 'cHRM', 'eXIf'].includes(c.type) && !(c.type === 'iTXt' && c.data.toString('latin1', 0, 17) === 'XML:com.adobe.xmp'));
  const add = [];
  if (icc) {
    const keyword = (iccLabel || 'ICC profile').replace(/[^\x20-\x7e]/g, '_').slice(0, 79);
    add.push(pngChunk('iCCP', Buffer.concat([Buffer.from(keyword + '\0', 'latin1'), Buffer.from([0]), zlib.deflateSync(icc)])));
  }
  if (exif) add.push(pngChunk('eXIf', exif));
  if (xmp) add.push(pngChunk('iTXt', Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\0\0\0\0', 'latin1'), xmp])));
  const first = kept.shift();
  return Buffer.concat([buf.subarray(0, 8), pngChunk(first.type, first.data), ...add, ...kept.map((c) => pngChunk(c.type, c.data))]);
}

/* ───────────────────────── items ───────────────────────── */
function publicItem(it) {
  return {
    id: it.id, name: it.name, relPath: it.relPath, width: it.width, height: it.height,
    format: it.format, size: it.size, version: it.version, error: it.error || null, errorDetail: it.errorDetail || null, hasMetadata: !!it.hasMeta, profile: it.profileName || null, profileUsable: !!it.profileUsable,
    results: Object.values(it.results).map((r) => ({
      key: r.key, model: r.model, scale: r.scale, format: r.format, width: r.width, height: r.height,
      size: r.size, name: r.name, ms: r.ms, device: r.device, at: r.at, profile: r.profile, metadata: !!r.metadata,
    })),
  };
}
function publicJobs() {
  return jobs.map((j) => ({
    id: j.id, itemId: j.itemId, status: j.status, percent: Math.round(j.percent * 10) / 10,
    pass: j.pass, passes: j.passes, model: j.params.model, scale: j.params.scale, stage: j.stage, label: j.label,
  }));
}
const emitItem = (it) => broadcast('item', publicItem(it));
const emitQueue = () => broadcast('queue', { jobs: publicJobs() });

async function removeItem(id) {
  const it = items.get(id);
  if (!it) return;
  for (const j of [...jobs]) if (j.itemId === id) cancelJob(j);
  items.delete(id);
  for (const r of Object.values(it.results)) claimedOutputs.delete(r.file);
  await fsp.rm(path.join(UPLOADS_DIR, id), { recursive: true, force: true });
  broadcast('remove', { id });
}

async function handleUpload(req, res, url) {
  const name = sanitizeName(url.searchParams.get('name'));
  const relPath = String(url.searchParams.get('rel') || '').slice(0, 400);
  const id = crypto.randomBytes(6).toString('hex');
  const dir = path.join(UPLOADS_DIR, id);
  await fsp.mkdir(dir, { recursive: true });
  const rawPath = path.join(dir, 'upload.bin');
  try {
    await pipeline(req, fs.createWriteStream(rawPath));
    const stat = await fsp.stat(rawPath);
    if (!stat.size) throw new Error('File is empty');
    const open = (p) => sharp(p, { limitInputPixels: false, failOn: 'none' });
    let meta;
    try { meta = await open(rawPath).metadata(); } catch { throw new Error('Unsupported or corrupted image'); }
    const fmt = meta.format;
    if (!['jpeg', 'png', 'webp', 'gif', 'tiff', 'heif'].includes(fmt) || !meta.width) throw new Error('Unsupported image format');

    const rotated = (meta.orientation || 1) >= 5;
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;
    const native = { jpeg: 'jpg', png: 'png', webp: 'webp' }[fmt];
    const icc = meta.icc && meta.icc.length > 132 ? meta.icc : null;
    const profileUsable = !!icc && icc.toString('latin1', 16, 20) === 'RGB ' && meta.space !== 'cmyk';
    let profileName = icc ? (iccName(icc) || 'Embedded profile') : null;
    if (icc && !profileUsable) profileName += ' (converted to sRGB)';
    const exifTiff = exifToTiff(meta.exif);
    const xmp = meta.xmp && meta.xmp.length ? Buffer.from(meta.xmp) : null;
    const needConvert = !native || (meta.orientation || 1) > 1 || meta.space === 'cmyk' || (meta.pages || 1) > 1;

    let inputPath;
    if (!needConvert) {
      inputPath = path.join(dir, 'input.' + native);
      await fsp.rename(rawPath, inputPath);
    } else {
      inputPath = path.join(dir, 'input.png');
      // Keep the pixel values and the profile together; without a usable RGB profile sharp converts to sRGB for us.
      let pipe = open(rawPath).rotate();
      if (profileUsable) pipe = pipe.keepIccProfile();
      await pipe.png({ compressionLevel: 1 }).toFile(inputPath);
      await fsp.rm(rawPath, { force: true });
    }
    await open(inputPath).resize(320, 320, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(dir, 'thumb.webp'));

    const ext = path.extname(name).toLowerCase();
    const display = fmt === 'heif' ? (ext === '.avif' ? 'AVIF' : 'HEIF') : fmt === 'jpeg' ? 'JPEG' : fmt.toUpperCase();
    const item = {
      id, name, relPath, width, height, format: display, size: stat.size, version: Date.now(),
      inputPath, thumbPath: path.join(dir, 'thumb.webp'), inputMime: mimeFor(inputPath), results: {}, error: null,
      profileName, profileUsable, exifTiff, xmp, hasMeta: !!(exifTiff || xmp),
    };
    items.set(id, item);
    emitItem(item);
    send(res, 200, publicItem(item));
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true });
    if (!res.headersSent) send(res, 400, { error: err.message });
  }
}

/* ───────────────────────── processing queue ───────────────────────── */
function validateParams(p) {
  const model = listModels().find((m) => m.id === p.model);
  if (!model) throw new Error('Unknown or not downloaded model');
  const scale = Number(p.scale);
  if (!SCALES.includes(scale)) throw new Error('Unsupported scale');
  const format = FORMATS[p.format] ? p.format : 'png';
  if (format === 'jxl' && !findTool('cjxl')) throw new Error('The JPEG XL encoder is not installed. Install it from the Output format section.');
  const device = Number(p.device);
  if (!Number.isInteger(device) || device < 0) throw new Error('Select a Vulkan device first');
  let tile = Number(p.tile) || 0;
  if (tile !== 0 && (tile < 32 || tile > 8192)) tile = 0;
  return { model: model.id, modelLabel: model.label, native: model.scale, scale, format, device, tile: Math.round(tile), tta: !!p.tta, profile: p.profile === 'srgb' ? 'srgb' : 'keep', safe: !!p.safe, metadata: p.metadata !== false, pngOpt: PNG_LEVELS[p.pngOpt] ? p.pngOpt : 'balanced' };
}
// 'none' = the image has no usable RGB profile, so the setting makes no difference.
const profileModeFor = (it, wanted) => (it.profileUsable ? wanted : 'none');

function enqueue(itemIds, rawParams, force) {
  if (!binaryReady()) throw new Error('Engine not installed. Run "npm run setup" first.');
  const params = validateParams(rawParams);
  let added = 0;
  for (const id of itemIds) {
    const it = items.get(id);
    if (!it) continue;
    const profileMode = profileModeFor(it, params.profile);
    const key = `${params.model}~${params.scale}~${params.format}~${profileMode}${it.hasMeta ? (params.metadata ? '~m' : '~n') : ''}`;
    if (jobs.some((j) => j.itemId === id && j.key === key)) continue;
    if (!force && it.results[key]) continue;
    it.error = null; it.errorDetail = null;
    jobs.push({ id: ++jobSeq, itemId: id, params, key, profileMode, status: 'queued', percent: 0, pass: 1, passes: 1, stage: 'engine', label: '', canceled: false, child: null, startedAt: 0 });
    emitItem(it);
    added++;
  }
  emitQueue();
  pump();
  return added;
}

function cancelJob(job) {
  job.canceled = true;
  if (job.status === 'queued') {
    jobs.splice(jobs.indexOf(job), 1);
  } else if (job.child) {
    job.child.kill();
  }
}

const fmtSec = (ms) => (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';

async function pump() {
  if (running) return;
  const job = jobs.find((j) => j.status === 'queued');
  if (!job) return;
  running = job;
  job.status = 'running';
  job.startedAt = Date.now();
  emitQueue();
  const it = items.get(job.itemId);
  const p = job.params;
  const what = it ? `${it.name} | ${p.modelLabel} x${p.scale}` : '(removed image)';
  try {
    if (!it) throw new Error('Image was removed');
    await runJob(job, it);
    const r = it.results[job.key];
    console.log(`  Done:     ${what} | ${it.width}x${it.height} -> ${r.width}x${r.height} | ${fmtSec(Date.now() - job.startedAt)} | ${r.device}`);
  } catch (err) {
    if (job.canceled) console.log(`  Canceled: ${what} (after ${fmtSec(Date.now() - job.startedAt)})`);
    else {
      if (it) { it.error = err.message; it.errorDetail = err.tail ? err.tail.trim().split(/\r?\n/).slice(-12).join('\n').slice(-1500) : null; }
      console.error(`  Failed:   ${what} | ${err.message} (after ${fmtSec(Date.now() - job.startedAt)})`);
      if (err.tail) console.error('    engine output:\n' + err.tail.trim().split(/\r?\n/).slice(-12).map((l) => '      ' + l).join('\n'));
    }
  } finally {
    const idx = jobs.indexOf(job);
    if (idx >= 0) jobs.splice(idx, 1);
    running = null;
    if (it && items.has(it.id)) emitItem(it);
    emitQueue();
    setImmediate(pump);
  }
}

// Turns the engine's raw output into a message that names the real cause.
function analyzeError(tail, code) {
  const t = tail.toLowerCase();
  const vk = [...t.matchAll(/(vk\w+) failed (-?\d+)/g)].map((m) => ({ fn: m[1], code: Number(m[2]) }));
  const has = (c) => vk.some((v) => v.code === c);
  if (/invalid gpu device/.test(t)) return { kind: 'device', message: 'The selected device is not available. Rescan devices and pick another one.' };
  if (has(-2) || has(-1) || /out of memory/.test(t)) return { kind: 'memory', message: 'The GPU ran out of memory. Try a smaller tile size (Advanced) or another device.' };
  if (has(-4) || /device lost/.test(t)) return { kind: 'lost', message: 'The GPU driver stopped responding (Vulkan "device lost"). Update the graphics driver, or turn on Compatibility mode in Advanced.' };
  if (vk.length) return { kind: 'vulkan', message: `Vulkan error ${vk[0].fn} (code ${vk[0].code}). Try Compatibility mode in Advanced, or another device.` };
  if (/decode image .* failed/.test(t)) return { kind: 'decode', message: 'The engine could not decode this image.' };
  if (/open failed|param.*failed|model/.test(t) && /fail/.test(t)) return { kind: 'model', message: 'The engine could not load the model files in models/.' };
  const last = tail.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0];
  return { kind: 'other', message: `Engine failed (exit code ${code})${last ? ': ' + last.slice(0, 160) : ''}` };
}
const RETRYABLE = new Set(['memory', 'lost', 'vulkan', 'blank']);

// Some drivers (seen on Intel UHD with large tiles) finish "successfully" but write a black picture. Detect it.
async function looksBlank(outFile, inputFile) {
  try {
    const small = (f) => sharp(f, { limitInputPixels: false }).resize(48, 48, { fit: 'inside' }).removeAlpha().stats();
    const [o, i] = await Promise.all([small(outFile), small(inputFile)]);
    const outMax = Math.max(...o.channels.map((c) => c.max));
    const inMean = i.channels.reduce((a, c) => a + c.mean, 0) / i.channels.length;
    return outMax <= 2 && inMean > 8;
  } catch { return false; }
}

// Memory errors that survive the safe settings mean the model itself does not fit: say so and offer ways out.
function modelTooBigMessage(p) {
  const devs = deviceCache || [];
  const dev = devs.find((d) => d.id === p.device);
  const others = devs.filter((d) => d.id !== p.device && d.type === 'gpu');
  const alt = others.find((d) => d.discrete) || others[0];
  const integrated = dev && dev.type === 'gpu' && !dev.discrete;
  return `${p.modelLabel} needs more video memory than ${dev ? dev.name : 'this device'} can provide. Choose a lighter model (for example Photo Small or Universal Fast V2)` +
    (alt ? `, or use ${alt.name}` : '') + (integrated ? ', or raise the video memory share of the integrated graphics (UMA Frame Buffer Size) in the BIOS' : '') + '.';
}
const safeDevices = new Map(); // device id -> tile size that worked in safe mode; reused for the rest of the session

function runEngine(args, job, onPercent) {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, args, { cwd: ROOT, windowsHide: true });
    job.child = child;
    let tail = '';
    const onData = (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-3000);
      const m = s.match(/(\d+(?:\.\d+)?)%/g);
      if (m) onPercent(parseFloat(m[m.length - 1]));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => { job.child = null; reject(new Error('Could not start the engine: ' + e.message)); });
    child.on('close', (code) => {
      job.child = null;
      if (job.canceled) return reject(new Error('Canceled'));
      if (code === 0) return resolve(tail);
      const a = analyzeError(tail, code);
      const e = new Error(a.message); e.kind = a.kind; e.tail = tail;
      reject(e);
    });
  });
}

function uniqueOutputPath(it, stem, key, ext) {
  let n = 1;
  for (;;) {
    const file = path.join(OUT_DIR, `${stem}${n > 1 ? '_' + n : ''}.${ext}`);
    const owner = claimedOutputs.get(file);
    const own = owner === it.id && it.results[key]?.file === file;
    if (own || (!owner && !exists(file))) return file;
    n++;
  }
}

const QUALITY = { jpg: 95, webp: 95, avif: 80, jxl: 90 };

// After the engine is done, saving can take a while (large PNG optimization, AVIF/JXL encoding): tell the UI what is going on.
function setStage(job, label) {
  job.stage = 'finish';
  job.label = label;
  broadcast('progress', { jobId: job.id, itemId: job.itemId, percent: 100, pass: job.passes, passes: job.passes, stage: 'finish', label });
  emitQueue();
}

function runTool(exe, args, job) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: ROOT, windowsHide: true });
    job.child = child;
    let out = '';
    child.stdout.on('data', (d) => { out = (out + d).slice(-2000); });
    child.stderr.on('data', (d) => { out = (out + d).slice(-2000); });
    child.on('error', (e) => { job.child = null; reject(new Error(`Could not start ${path.basename(exe)}: ${e.message}`)); });
    child.on('close', (code) => {
      job.child = null;
      if (job.canceled) return reject(new Error('Canceled'));
      if (code === 0) return resolve();
      const last = out.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || '';
      reject(new Error(`${path.basename(exe)} failed (exit code ${code})${last ? ': ' + last.slice(0, 160) : ''}`));
    });
  });
}

async function runJob(job, it) {
  const p = job.params;
  const key = job.key;
  const t0 = Date.now();
  const targetW = Math.max(1, Math.round(it.width * p.scale));
  const targetH = Math.max(1, Math.round(it.height * p.scale));
  if (MAX_SIDE[p.format] && Math.max(targetW, targetH) > MAX_SIDE[p.format]) {
    throw new Error(`The result (${targetW}×${targetH}) is too large for ${FORMAT_NAMES[p.format]} (maximum ${MAX_SIDE[p.format]} px per side). Choose PNG, AVIF or JPEG XL, or a smaller factor.`);
  }
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const tmp = path.join(TMP_DIR, String(job.id));
  await fsp.mkdir(tmp, { recursive: true });
  try {
    // Colour profile handling. The engine works on raw RGB values and ignores profiles.
    let engineInput = it.inputPath, icc = null, iccLabel = null;
    if (job.profileMode === 'srgb') {
      engineInput = path.join(tmp, 'srgb.png');
      await sharp(it.inputPath, { limitInputPixels: false }).withIccProfile('srgb', { attach: false }).png({ compressionLevel: 1 }).toFile(engineInput);
    } else if (job.profileMode === 'keep') {
      icc = (await sharp(it.inputPath, { limitInputPixels: false }).metadata()).icc || null;
      iccLabel = icc ? iccName(icc) : null;
    }

    // How many native-scale passes are needed to reach (at least) the target?
    let passes = 1, reach = p.native;
    while (reach < p.scale - 1e-9) { reach *= p.native; passes++; }
    job.passes = passes;

    const devInfo = (deviceCache || []).find((d) => d.id === p.device);
    const integrated = !!devInfo && devInfo.type === 'gpu' && !devInfo.discrete;
    let safe = p.safe || safeDevices.has(p.device);
    // Safe mode starts at tile 100 (or the user's smaller tile) and steps down to 64, then 32, when video memory runs out.
    let safeTile = safeDevices.get(p.device) || (p.tile >= 32 && p.tile < 100 ? p.tile : 100);
    let current = engineInput;
    for (let i = 1; i <= passes; i++) {
      job.pass = i;
      const out = path.join(tmp, `pass${i}.png`);
      let passMax = 0;
      for (;;) {
        const args = ['-i', current, '-o', out, '-s', String(p.native), '-m', 'models', '-n', p.model, '-g', String(p.device), '-f', 'png'];
        if (safe) args.push('-j', '1:1:1', '-t', String(safeTile));
        else if (p.tile) args.push('-t', String(p.tile));
        else if (integrated) args.push('-t', '100'); // integrated GPUs share system memory; the automatic tile size is too big for them
        if (p.tta) args.push('-x');
        try {
          await runEngine(args, job, (pct) => {
            // Never let the bar go backwards, and keep it below 100% until the file is really finished.
            passMax = Math.max(passMax, Math.min(pct, 100));
            job.percent = Math.min(99, ((i - 1) + passMax / 100) / passes * 100);
            const now = Date.now();
            if (now - (job.lastEmit || 0) >= 120) {
              job.lastEmit = now;
              broadcast('progress', { jobId: job.id, itemId: job.itemId, percent: Math.round(job.percent * 10) / 10, pass: i, passes });
            }
          });
          if (exists(out) && await looksBlank(out, current)) {
            const e = new Error('The engine produced a black image on this device (a driver problem). Turn on Compatibility mode or use another device.');
            e.kind = 'blank';
            throw e;
          }
          if (safe) safeDevices.set(p.device, safeTile);
          break;
        } catch (err) {
          if (safe && err.kind === 'memory' && safeTile > 32 && !job.canceled) {
            safeTile = safeTile > 64 ? 64 : 32;
            console.log(`  Retrying: ${it.name} | out of video memory, trying tile size ${safeTile} on device ${p.device}`);
            await fsp.rm(out, { force: true });
            passMax = 0;
            continue;
          }
          if (safe && err.kind === 'memory' && !job.canceled) err.message = modelTooBigMessage(p);
          if (safe && err.kind === 'blank' && !job.canceled) err.message = 'The engine still produced a black image on this device, even with safe settings. Update the graphics driver or use another device.';
          if (safe || job.canceled || !RETRYABLE.has(err.kind)) throw err;
          safe = true;
          safeDevices.set(p.device, safeTile);
          console.log(`  Retrying: ${it.name} | engine error (${err.kind}), trying safe settings (1 thread, small tiles) on device ${p.device}`);
          await fsp.rm(out, { force: true });
          passMax = 0;
        }
      }
      if (!exists(out)) throw new Error('The engine finished but produced no output. The image may be unsupported.');
      if (current !== it.inputPath) await fsp.rm(current, { force: true });
      current = out;
    }

    job.percent = 100;
    const stem = `${it.name.replace(/\.[^.]*$/, '') || 'image'}_${p.model}_x${p.scale}${job.profileMode === 'srgb' ? '_srgb' : ''}`.replace(/[\\/:*?"<>|]/g, '_');
    const finalPath = uniqueOutputPath(it, stem, key, p.format);
    const partPath = finalPath + '.part';
    const checkCanceled = () => { if (job.canceled) throw new Error('Canceled'); };

    // 1) bring the upscaled picture to the exact target size
    let png = await fsp.readFile(current);
    const meta = await sharp(png, { limitInputPixels: false }).metadata();
    if (meta.width !== targetW || meta.height !== targetH) {
      setStage(job, `Resizing to ${targetW}×${targetH}`);
      png = await sharp(png, { limitInputPixels: false }).resize(targetW, targetH, { kernel: 'lanczos3', fit: 'fill' }).png({ compressionLevel: 1 }).toBuffer();
      checkCanceled();
    }

    // 2) re-attach what should survive: color profile, EXIF, XMP (the engine drops all of it)
    const useMeta = p.metadata && it.hasMeta;
    const tagged = buildTaggedPng(png, { icc, iccLabel, exif: useMeta ? it.exifTiff : null, xmp: useMeta ? it.xmp : null });
    png = null;
    const taggedPath = path.join(tmp, 'tagged.png');
    await fsp.writeFile(taggedPath, tagged);
    checkCanceled();

    // 3) encode. Only keep what we put into the tagged PNG; keepMetadata() would add a technical EXIF stub of its own.
    const keepWanted = (img) => (useMeta ? img.keepMetadata() : icc ? img.keepIccProfile() : img);
    const fmtName = FORMAT_NAMES[p.format];
    let previewFile = null;
    if (p.format === 'png') {
      const oxipng = findTool('oxipng');
      let optimized = false;
      if (oxipng) {
        setStage(job, 'Optimizing PNG with OxiPNG');
        try { await runTool(oxipng, ['-o', PNG_LEVELS[p.pngOpt], '-q', '--out', partPath, taggedPath], job); optimized = true; }
        catch (err) { if (job.canceled) throw err; console.warn(`  OxiPNG failed (${err.message}); saving without optimization.`); }
      }
      if (!optimized) {
        setStage(job, 'Saving PNG');
        await keepWanted(sharp(taggedPath, { limitInputPixels: false })).png({ compressionLevel: 9 }).toFile(partPath);
      }
    } else if (p.format === 'jxl') {
      setStage(job, 'Encoding JPEG XL');
      previewFile = path.join(UPLOADS_DIR, it.id, `preview_${job.id}.png`); // browsers cannot show JPEG XL reliably
      await fsp.copyFile(taggedPath, previewFile);
      await runTool(findTool('cjxl'), [taggedPath, partPath, '-q', String(QUALITY.jxl), '-e', '7', '--quiet'], job);
    } else {
      setStage(job, `Encoding ${fmtName}`);
      let img = keepWanted(sharp(taggedPath, { limitInputPixels: false }));
      if (p.format === 'jpg') img = img.flatten({ background: '#ffffff' }).jpeg({ quality: QUALITY.jpg, chromaSubsampling: '4:4:4', mozjpeg: true });
      else if (p.format === 'webp') img = img.webp({ quality: QUALITY.webp });
      else img = img.avif({ quality: QUALITY.avif, effort: 4, chromaSubsampling: '4:4:4' });
      await img.toFile(partPath);
    }
    checkCanceled();
    setStage(job, 'Saving file');
    await fsp.rename(partPath, finalPath);

    const stat = await fsp.stat(finalPath);
    const prev = it.results[key];
    if (prev) {
      if (prev.file !== finalPath) claimedOutputs.delete(prev.file);
      if (prev.previewFile) await fsp.rm(prev.previewFile, { force: true });
    }
    claimedOutputs.set(finalPath, it.id);
    const dev = (deviceCache || []).find((d) => d.id === p.device);
    it.results[key] = {
      key, model: p.model, scale: p.scale, format: p.format, width: targetW, height: targetH, size: stat.size,
      file: finalPath, previewFile, name: path.basename(finalPath), ms: Date.now() - t0, at: Date.now(), profile: job.profileMode, metadata: useMeta,
      device: dev ? `${dev.type === 'cpu' ? 'CPU' : 'GPU ' + dev.id} (${dev.name})` : `Device ${p.device}`,
    };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

/* ───────────────────────── model downloads ───────────────────────── */
const downloads = new Map(); // id -> { state, received, total, error }
function modelState(c) {
  const installed = listModels().some((m) => m.id === c.id);
  const d = downloads.get(c.id);
  return {
    id: c.id, label: c.label, scale: c.scale, recommended: !!c.rec, heavy: !!c.heavy, group: c.group, description: c.desc,
    author: c.author, license: c.license, sizeMB: c.size, installed,
    state: d ? d.state : installed ? 'installed' : 'idle', received: d ? d.received : 0, total: d ? d.total : 0, error: d ? d.error : null,
  };
}
const emitModel = (c) => broadcast('model', modelState(c));

async function downloadModel(entry) {
  const st = { state: 'downloading', received: 0, total: Math.round(entry.size * 1048576), error: null };
  downloads.set(entry.id, st);
  emitModel(entry);
  const parts = [];
  try {
    await fsp.mkdir(MODELS_DIR, { recursive: true });
    let last = 0;
    for (const ext of ['param', 'bin']) {
      const res = await fetch(`${MODEL_BASE}/${entry.id}.${ext}?download=true`, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}). Check your internet connection.`);
      const dest = path.join(MODELS_DIR, `${entry.id}.${ext}`);
      parts.push([dest + '.part', dest]);
      if (ext === 'bin') { const len = Number(res.headers.get('content-length')); if (len) st.total = len; }
      const src = Readable.fromWeb(res.body);
      src.on('data', (chunk) => {
        if (ext !== 'bin') return;
        st.received += chunk.length;
        const now = Date.now();
        if (now - last > 250) { last = now; emitModel(entry); }
      });
      await pipeline(src, fs.createWriteStream(dest + '.part'));
    }
    const head = (await fsp.readFile(parts[0][0], 'latin1')).slice(0, 16);
    if (!head.startsWith('7767517')) throw new Error('The downloaded file is not a valid ncnn model.');
    if ((await fsp.stat(parts[1][0])).size < 1024) throw new Error('The downloaded model file is incomplete.');
    for (const [from, to] of parts) await fsp.rename(from, to);
    downloads.delete(entry.id);
    console.log(`  Model downloaded: ${entry.id}`);
  } catch (err) {
    st.state = 'error';
    st.error = err.message === 'fetch failed' ? 'Could not reach the download server. Check your internet connection and try again.' : err.message;
    console.error(`  Model download failed: ${entry.id} | ${err.message}`);
    for (const [from] of parts) await fsp.rm(from, { force: true });
  }
  emitModel(entry);
}

/* ───────────────────────── optional tools (OxiPNG, cjxl) ───────────────────────── */
const toolInstalls = new Map(); // id -> { state, received, total, error }
function toolState(id) {
  const t = TOOLS[id], d = toolInstalls.get(id), spec = t.spec();
  const installed = !!findTool(id);
  return {
    id, label: t.label, installed, installable: !!spec, sizeMB: t.sizeMB,
    state: d ? d.state : installed ? 'installed' : 'idle', received: d ? d.received : 0, total: d ? d.total : 0, error: d ? d.error : null,
  };
}
const emitTool = (id) => broadcast('tool', toolState(id));
async function installToolJob(id) {
  const st = { state: 'downloading', received: 0, total: Math.round(TOOLS[id].sizeMB * 1048576), error: null };
  toolInstalls.set(id, st);
  emitTool(id);
  let last = 0;
  try {
    await installTool(id, (got, total) => {
      st.received = got; if (total) st.total = total;
      const now = Date.now();
      if (now - last > 250) { last = now; emitTool(id); }
    });
    toolInstalls.delete(id);
    console.log(`  Tool installed: ${TOOLS[id].label}`);
  } catch (err) {
    st.state = 'error';
    st.error = err.message === 'fetch failed' ? 'Could not reach the download server. Check your internet connection and try again.' : err.message;
    console.error(`  Tool install failed: ${TOOLS[id].label} | ${st.error}`);
  }
  emitTool(id);
}

/* ───────────────────────── routes ───────────────────────── */
const routes = [];
const route = (method, re, fn) => routes.push({ method, re, fn });

route('GET', /^\/api\/info$/, async (req, res) => {
  const devices = await detectDevices(false);
  send(res, 200, {
    name: 'Image Upscale W2X', version: VERSION, mode: NETWORK_MODE ? 'network' : 'local',
    engineReady: binaryReady(), tools: Object.keys(TOOLS).map(toolState), defaultModel: DEFAULT_MODEL, models: listModels(), devices, scales: SCALES, outputDir: OUT_DIR,
    canOpenFolder: !NETWORK_MODE,
  });
});
route('POST', /^\/api\/devices\/rescan$/, async (req, res) => send(res, 200, { devices: await detectDevices(true) }));
route('GET', /^\/api\/state$/, async (req, res) => send(res, 200, { items: [...items.values()].map(publicItem), jobs: publicJobs() }));
route('POST', /^\/api\/upload$/, (req, res, m, url) => handleUpload(req, res, url));

route('POST', /^\/api\/process$/, async (req, res) => {
  const body = await readJson(req);
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
  try {
    const added = enqueue(ids, body, !!body.force);
    send(res, 200, { queued: added });
  } catch (err) { send(res, 400, { error: err.message }); }
});
route('POST', /^\/api\/cancel$/, async (req, res) => {
  const body = await readJson(req);
  for (const j of [...jobs]) {
    if (body.all || j.id === body.jobId || (body.itemId && j.itemId === body.itemId)) cancelJob(j);
  }
  emitQueue();
  send(res, 200, { ok: true });
});
route('DELETE', /^\/api\/items$/, async (req, res) => {
  for (const id of [...items.keys()]) await removeItem(id);
  send(res, 200, { ok: true });
});
route('DELETE', /^\/api\/items\/([a-f0-9]+)$/, async (req, res, m) => { await removeItem(m[1]); send(res, 200, { ok: true }); });

route('DELETE', /^\/api\/items\/([a-f0-9]+)\/result\/([^/]+)$/, async (req, res, m) => {
  const it = items.get(m[1]);
  const key = decodeURIComponent(m[2]);
  const r = it && it.results[key];
  if (!r) return send(res, 404, { error: 'Not found' });
  if (r.file.startsWith(OUT_DIR + path.sep)) await fsp.rm(r.file, { force: true });
  if (r.previewFile) await fsp.rm(r.previewFile, { force: true });
  claimedOutputs.delete(r.file);
  delete it.results[key];
  emitItem(it);
  send(res, 200, { ok: true });
});

function serveFile(req, res, file, mime, download) {
  if (!file || !exists(file)) return send(res, 404, { error: 'Not found' });
  const stat = fs.statSync(file);
  const headers = { 'Content-Type': mime, 'Content-Length': stat.size, 'Cache-Control': 'private, max-age=3600' };
  if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}
route('GET', /^\/api\/items\/([a-f0-9]+)\/(input|thumb)$/, (req, res, m) => {
  const it = items.get(m[1]);
  if (!it) return send(res, 404, { error: 'Not found' });
  if (m[2] === 'thumb') serveFile(req, res, it.thumbPath, 'image/webp');
  else serveFile(req, res, it.inputPath, it.inputMime);
});
route('GET', /^\/api\/items\/([a-f0-9]+)\/result\/([^/]+)$/, (req, res, m, url) => {
  const it = items.get(m[1]);
  const r = it && it.results[decodeURIComponent(m[2])];
  if (!r) return send(res, 404, { error: 'Not found' });
  if (url.searchParams.get('preview') === '1' && r.previewFile && exists(r.previewFile)) return serveFile(req, res, r.previewFile, 'image/png');
  serveFile(req, res, r.file, FORMATS[r.format], url.searchParams.get('download') === '1');
});

function openExternal(target) {
  const cmd = process.platform === 'win32' ? ['explorer.exe', [target]]
    : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  const c = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' });
  c.on('error', () => {});
  c.unref();
}
route('POST', /^\/api\/open-output$/, async (req, res) => {
  if (NETWORK_MODE) return send(res, 403, { error: 'Disabled in network mode' });
  await fsp.mkdir(OUT_DIR, { recursive: true });
  openExternal(OUT_DIR);
  send(res, 200, { ok: true });
});

const LOCAL_ADDR = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
route('GET', /^\/api\/tools$/, async (req, res) => send(res, 200, { tools: Object.keys(TOOLS).map(toolState) }));
route('POST', /^\/api\/tools\/install$/, async (req, res) => {
  if (!LOCAL_ADDR.has(req.socket.remoteAddress)) return send(res, 403, { error: 'Tools can only be installed from the computer that runs the server.' });
  const body = await readJson(req);
  if (!TOOLS[body.id]) return send(res, 400, { error: 'Unknown tool' });
  const cur = toolInstalls.get(body.id);
  if (!(cur && cur.state === 'downloading') && !findTool(body.id)) installToolJob(body.id);
  send(res, 200, { ok: true });
});
route('GET', /^\/api\/models$/, async (req, res) => send(res, 200, { models: CATALOG_ORDERED.map(modelState) }));
route('POST', /^\/api\/models\/download$/, async (req, res) => {
  if (!LOCAL_ADDR.has(req.socket.remoteAddress)) return send(res, 403, { error: 'Models can only be downloaded from the computer that runs the server.' });
  const body = await readJson(req);
  const entry = CATALOG_BY_ID.get(body.id);
  if (!entry) return send(res, 400, { error: 'Unknown model' });
  const cur = downloads.get(entry.id);
  if (!(cur && cur.state === 'downloading') && !listModels().some((m) => m.id === entry.id)) downloadModel(entry);
  send(res, 200, { ok: true });
});

route('GET', /^\/api\/events$/, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});
setInterval(() => { for (const c of sseClients) c.write(': ping\n\n'); }, 25000).unref();

/* ───────────────────────── http server ───────────────────────── */
function hostAllowed(req) {
  if (NETWORK_MODE) return true;
  const h = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return LOOPBACK.includes(h);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!hostAllowed(req)) return send(res, 403, 'Forbidden host');
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers['x-w2x'] !== '1') return send(res, 403, { error: 'Missing header' });
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = pathname.match(r.re);
        if (m) return await r.fn(req, res, m, url);
      }
      return send(res, 404, { error: 'Unknown endpoint' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !exists(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found');
    const cache = file.endsWith('.woff2') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': mimeFor(file), 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: err.message });
    else res.end();
  }
});

/* ───────────────────────── lifecycle ───────────────────────── */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}
async function cleanup() {
  for (const j of jobs) { j.canceled = true; if (j.child) j.child.kill(); }
  await fsp.rm(DATA_DIR, { recursive: true, force: true }).catch(() => {});
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => { console.log('\n  Stopping...'); cleanup().finally(() => process.exit(0)); });

(async () => {
  await fsp.rm(DATA_DIR, { recursive: true, force: true });
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(OUT_DIR, { recursive: true });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use. Start with another port:  node server.js --port ${PORT + 1}`);
    else console.error(err);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    const local = `http://localhost:${PORT}`;
    console.log(`\n  Image Upscale W2X ${VERSION}`);
    console.log(`  Local:    ${local}`);
    if (NETWORK_MODE) {
      for (const ip of lanAddresses()) console.log(`  Network:  http://${ip}:${PORT}`);
      console.log('\n  WARNING: network mode. Anyone on your network can open this page and use your GPU. There is no password.');
    } else {
      console.log('  Network:  off (listening on this computer only; use --network to share)');
    }
    if (!binaryReady()) console.log('\n  WARNING: engine not found in bin/. Run "npm run setup" once (needs internet).');
    else if (!listModels().length) console.log('\n  No models yet. Open the web interface and use "Download models" (needs internet once).');
    console.log('  Press Ctrl+C to stop.\n');
    if (AUTO_OPEN) openExternal(local);
    detectDevices(false).then((d) => d.length && console.log(`  Devices: ${d.map((x) => `[${x.id}] ${x.name}`).join(', ')}`));
  });
})();
