#!/usr/bin/env node
'use strict';
/**
 * One-time setup: downloads the Real-ESRGAN-ncnn-vulkan engine into bin/, plus the optional
 * helpers OxiPNG (PNG optimization) and cjxl (JPEG XL output).
 * Models are NOT downloaded here: pick the ones you want in the web interface.
 *
 *   node scripts/setup.js            download whatever is missing
 *   node scripts/setup.js --force    download everything again
 *   node scripts/setup.js --skip-tools   engine only
 */
const fs = require('fs');
const path = require('path');
const { BIN_DIR, TOOLS, exeName, findTool, installTool, installEngine } = require('../lib/install');

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const fmtMB = (n) => (n / 1048576).toFixed(1) + ' MB';

function progress(label) {
  let last = 0;
  return (got, total) => {
    const now = Date.now();
    if (!process.stdout.isTTY || now - last < 250) return;
    last = now;
    process.stdout.write(`\r  ${label}: ${fmtMB(got)}${total ? ' / ' + fmtMB(total) + ' ' + Math.round(got / total * 100) + '%' : ''}   `);
  };
}
const clear = () => process.stdout.isTTY && process.stdout.write('\r' + ' '.repeat(70) + '\r');

(async () => {
  if (Number(process.versions.node.split('.')[0]) < 18) { console.error('Node.js 18 or newer is required.'); process.exit(1); }
  try {
    const engine = path.join(BIN_DIR, exeName('realesrgan-ncnn-vulkan'));
    if (fs.existsSync(engine) && !force) console.log('Engine: already installed.');
    else { console.log('Engine: downloading Real-ESRGAN-ncnn-vulkan'); await installEngine(progress('engine')); clear(); console.log('Engine: installed to bin/'); }
  } catch (err) {
    console.error('\nSetup failed:', err.message);
    console.error('Check your internet connection and run "npm run setup" again.');
    process.exit(1);
  }
  if (!args.has('--skip-tools')) {
    for (const [id, tool] of Object.entries(TOOLS)) {
      const local = path.join(BIN_DIR, exeName(tool.exe));
      if (fs.existsSync(local) && !force) { console.log(`${tool.label}: already installed.`); continue; }
      if (!force && findTool(id)) { console.log(`${tool.label}: found in PATH.`); continue; }
      if (!tool.spec()) { console.log(`${tool.label}: no download for this platform (optional).`); continue; }
      try { console.log(`${tool.label}: downloading (~${tool.sizeMB} MB)`); await installTool(id, progress(tool.label)); clear(); console.log(`${tool.label}: installed.`); }
      catch (err) { clear(); console.warn(`${tool.label}: skipped (${err.message}). It is optional and can be installed later from the web interface.`); }
    }
  }
  console.log('\nReady. Start the tool with start.bat (Windows) or ./start.sh (Linux/macOS),');
  console.log('then download the models you want in the web interface.');
})();
