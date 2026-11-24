'use strict';
/**
 * Downloads and unpacks the external programs into bin/:
 *   engine  – Real-ESRGAN-ncnn-vulkan (required)
 *   oxipng  – PNG optimizer (optional)
 *   cjxl    – JPEG XL encoder from libjxl (optional)
 * Used by scripts/setup.js and by the server (on-demand install from the UI).
 * No external tools needed: zip and tar.gz are unpacked in plain Node.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const ROOT = path.join(__dirname, '..');
const BIN_DIR = path.join(ROOT, 'bin');
const isWin = process.platform === 'win32';
const exeName = (n) => (isWin ? n + '.exe' : n);

const ENGINE_TAG = 'v0.2.0';
const OXIPNG_VER = '10.2.1';
const LIBJXL_TAG = 'v0.11.1';

function engineSpec() {
  const plat = { win32: 'windows', linux: 'ubuntu', darwin: 'macos' }[process.platform];
  if (!plat) throw new Error(`Unsupported platform: ${process.platform}`);
  return {
    url: `https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases/download/${ENGINE_TAG}/realesrgan-ncnn-vulkan-${ENGINE_TAG}-${plat}.zip`,
    kind: 'zip',
  };
}

// Optional tools: label, approximate download size and the archive to fetch for this platform (null = none).
const TOOLS = {
  oxipng: {
    label: 'OxiPNG', exe: 'oxipng', sizeMB: 0.6,
    spec() {
      const x64 = process.arch === 'x64', arm = process.arch === 'arm64';
      const base = `https://github.com/oxipng/oxipng/releases/download/v${OXIPNG_VER}/oxipng-${OXIPNG_VER}-`;
      if (isWin && x64) return { url: base + 'x86_64-pc-windows-msvc.zip', kind: 'zip' };
      if (process.platform === 'linux' && x64) return { url: base + 'x86_64-unknown-linux-musl.tar.gz', kind: 'tgz' };
      if (process.platform === 'linux' && arm) return { url: base + 'aarch64-unknown-linux-musl.tar.gz', kind: 'tgz' };
      if (process.platform === 'darwin') return { url: base + (arm ? 'aarch64' : 'x86_64') + '-apple-darwin.tar.gz', kind: 'tgz' };
      return null;
    },
  },
  cjxl: {
    label: 'JPEG XL encoder (cjxl)', exe: 'cjxl', sizeMB: isWin ? 39 : 17,
    spec() {
      const base = `https://github.com/libjxl/libjxl/releases/download/${LIBJXL_TAG}/`;
      if (isWin && process.arch === 'x64') return { url: base + 'jxl-x64-windows-static.zip', kind: 'zip' };
      if (process.platform === 'linux' && process.arch === 'x64') return { url: base + `jxl-linux-x86_64-static-${LIBJXL_TAG}.tar.gz`, kind: 'tgz' };
      return null; // no official build: a cjxl found in PATH is used instead
    },
  },
};

/** Path of an installed tool: bin/ first, then PATH. Returns null when not found. */
function findTool(id) {
  const name = exeName(TOOLS[id].exe);
  const local = path.join(BIN_DIR, name);
  if (fs.existsSync(local)) return local;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* keep looking */ }
  }
  return null;
}

async function download(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} while downloading ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  const src = Readable.fromWeb(res.body);
  src.on('data', (c) => { got += c.length; if (onProgress) onProgress(got, total); });
  await pipeline(src, fs.createWriteStream(dest + '.part'));
  fs.renameSync(dest + '.part', dest);
  return got;
}

/** Reads one file (matched by base name) out of a .tar.gz, in memory. */
function extractFromTgz(file, baseName) {
  const tar = zlib.gunzipSync(fs.readFileSync(file));
  let longName = null;
  for (let off = 0; off + 512 <= tar.length;) {
    const cstr = (a, b) => { const s = tar.subarray(a, b); const z = s.indexOf(0); return s.subarray(0, z < 0 ? s.length : z).toString('utf8'); };
    let name = cstr(off, off + 100);
    if (!name) break; // end of archive
    const prefix = cstr(off + 345, off + 500);
    if (prefix) name = prefix + '/' + name;
    const size = parseInt(cstr(off + 124, off + 136).trim() || '0', 8);
    const type = String.fromCharCode(tar[off + 156] || 48);
    const data = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0+$/, ''); continue; }
    if (longName) { name = longName; longName = null; }
    if ((type === '0' || type === '\0') && path.posix.basename(name) === baseName) return Buffer.from(data);
  }
  return null;
}

function extractFromZip(file, baseName) {
  const AdmZip = require('adm-zip');
  const entry = new AdmZip(file).getEntries().find((e) => !e.isDirectory && path.posix.basename(e.entryName) === baseName);
  return entry ? entry.getData() : null;
}

async function installTool(id, onProgress) {
  const tool = TOOLS[id];
  const spec = tool && tool.spec();
  if (!spec) throw new Error(`${tool ? tool.label : id} has no download for this platform.`);
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const archive = path.join(BIN_DIR, `${id}-download.${spec.kind === 'zip' ? 'zip' : 'tar.gz'}`);
  try {
    await download(spec.url, archive, onProgress);
    const name = exeName(tool.exe);
    const data = spec.kind === 'zip' ? extractFromZip(archive, name) : extractFromTgz(archive, name);
    if (!data) throw new Error(`${name} was not found inside the downloaded archive.`);
    const out = path.join(BIN_DIR, name);
    fs.writeFileSync(out, data);
    if (!isWin) fs.chmodSync(out, 0o755);
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(archive + '.part', { force: true });
  }
}

async function installEngine(onProgress) {
  const AdmZip = require('adm-zip');
  const spec = engineSpec();
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const zipPath = path.join(BIN_DIR, 'engine.zip');
  await download(spec.url, zipPath, onProgress);
  const zip = new AdmZip(zipPath);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const rel = entry.entryName.split('/').slice(1).join('/');
    if (!rel || rel.split('/').includes('..')) continue;
    if (rel.startsWith('models/')) continue; // models are chosen in the UI
    const out = path.join(BIN_DIR, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, entry.getData());
  }
  fs.unlinkSync(zipPath);
  const exe = path.join(BIN_DIR, exeName('realesrgan-ncnn-vulkan'));
  if (!isWin) fs.chmodSync(exe, 0o755);
  fs.writeFileSync(path.join(BIN_DIR, 'VERSION'), ENGINE_TAG + '\n');
}

module.exports = { ROOT, BIN_DIR, TOOLS, ENGINE_TAG, exeName, findTool, installTool, installEngine };
