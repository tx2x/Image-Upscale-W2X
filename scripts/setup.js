#!/usr/bin/env node
'use strict';
/**
 * One-time setup: downloads the Real-ESRGAN-ncnn-vulkan executable into bin/.
 * Models are NOT downloaded here: pick the ones you want in the web interface
 * (Download models). After that the tool runs fully offline.
 *
 *   node scripts/setup.js            download the engine if it is missing
 *   node scripts/setup.js --force    re-download it
 */
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const ROOT = path.join(__dirname, '..');
const BIN_DIR = path.join(ROOT, 'bin');

const ENGINE_TAG = 'v0.2.0';
const ENGINE_BASE = `https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases/download/${ENGINE_TAG}`;
const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const isWin = process.platform === 'win32';
const exeName = isWin ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan';

function platformAsset() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'linux') return 'ubuntu';
  if (process.platform === 'darwin') return 'macos';
  throw new Error(`Unsupported platform: ${process.platform}`);
}

function fmtMB(n) { return (n / 1048576).toFixed(1) + ' MB'; }

async function download(url, dest, label) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${label}: HTTP ${res.status} (${url})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = dest + '.part';
  let got = 0, lastPrint = 0;
  const src = Readable.fromWeb(res.body);
  src.on('data', (chunk) => {
    got += chunk.length;
    const now = Date.now();
    if (now - lastPrint > 250 && process.stdout.isTTY) {
      lastPrint = now;
      const pct = total ? ` ${(got / total * 100).toFixed(0)}%` : '';
      process.stdout.write(`\r  ${label}: ${fmtMB(got)}${total ? ' / ' + fmtMB(total) : ''}${pct}   `);
    }
  });
  await pipeline(src, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(70) + '\r');
  console.log(`  ${label}: ${fmtMB(got)} done`);
}

async function setupBinary() {
  const exe = path.join(BIN_DIR, exeName);
  if (fs.existsSync(exe) && !force) {
    console.log('Engine: already installed (use --force to reinstall).');
    return;
  }
  const AdmZip = require('adm-zip');
  const asset = platformAsset();
  const url = `${ENGINE_BASE}/realesrgan-ncnn-vulkan-${ENGINE_TAG}-${asset}.zip`;
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const zipPath = path.join(BIN_DIR, 'engine.zip');
  console.log(`Engine: downloading Real-ESRGAN-ncnn-vulkan ${ENGINE_TAG} (${asset})`);
  await download(url, zipPath, 'engine');
  const zip = new AdmZip(zipPath);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const rel = entry.entryName.split('/').slice(1).join('/');
    if (!rel || rel.split('/').includes('..')) continue;
    // Some archives ship their own models; we do not use them.
    if (rel.startsWith('models/')) continue;
    const out = path.join(BIN_DIR, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, entry.getData());
  }
  fs.unlinkSync(zipPath);
  if (!isWin) fs.chmodSync(exe, 0o755);
  fs.writeFileSync(path.join(BIN_DIR, 'VERSION'), ENGINE_TAG + '\n');
  console.log('Engine: installed to bin/');
}

(async () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) { console.error('Node.js 18 or newer is required.'); process.exit(1); }
  try {
    await setupBinary();
    console.log('\nEngine ready. Start the tool with start.bat (Windows) or ./start.sh (Linux/macOS),');
    console.log('then download the models you want in the web interface.');
  } catch (err) {
    console.error('\nSetup failed:', err.message);
    console.error('Check your internet connection and run "npm run setup" again.');
    process.exit(1);
  }
})();
