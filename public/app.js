(() => {
  'use strict';

  /* ───────────── helpers ───────────── */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  const fmtBytes = (n) => {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB';
  };
  const fmtDim = (w, h) => `${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')}`;
  const fmtScale = (s) => '×' + s;
  const shorten = (name, max = 42) => {
    if (name.length <= max) return name;
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : '';
    const stem = ext ? name.slice(0, dot) : name;
    const keep = max - ext.length - 1;
    const head = Math.ceil(keep * 0.65), tail = keep - head;
    return stem.slice(0, head) + '…' + (tail > 0 ? stem.slice(-tail) : '') + ext;
  };
  const ICON = {
    play: '<svg viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect width="14" height="14" x="5" y="5" rx="2"/></svg>',
    compare: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="m8 9-2 3 2 3"/><path d="m16 9 2 3-2 3"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
  };

  /* ───────────── state ───────────── */
  const S = {
    info: null,
    items: new Map(),
    jobs: [],
    uploads: { total: 0, done: 0 },
    settings: { model: '', scale: 2, device: '', format: 'png', tile: '0', tta: false, safe: false, profile: 'keep', metadata: true, pngOpt: 'balanced' },
    catalog: [],
  };
  const el = {
    model: $('#model'), modelDesc: $('#modelDesc'), scaleSeg: $('#scaleSeg'), scaleHint: $('#scaleHint'),
    profile: $('#profile'), profileHint: $('#profileHint'), manageModels: $('#manageModels'),
    device: $('#device'), deviceHint: $('#deviceHint'), rescan: $('#rescan'), format: $('#format'), pngOpt: $('#pngOpt'), pngOptField: $('#pngOptField'), metadata: $('#metadata'), metaHint: $('#metaHint'), formatHint: $('#formatHint'),
    toolNote: $('#toolNote'), toolText: $('#toolText'), toolInstall: $('#toolInstall'), toolBar: $('#toolBar'), tile: $('#tile'), tta: $('#tta'), safe: $('#safe'),
    warn: $('#warn'), outDir: $('#outDir'), openOut: $('#openOut'), drop: $('#drop'), toolbar: $('#toolbar'), count: $('#count'),
    list: $('#list'), runAll: $('#runAll'), stopAll: $('#stopAll'), clearAll: $('#clearAll'), netPill: $('#netPill'),
  };

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: { 'X-W2X': '1' } };
    if (opts.json) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
    if (opts.body) { init.body = opts.body; init.headers['Content-Type'] = 'application/octet-stream'; }
    const res = await fetch(path, init);
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }
  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    $('#toasts').append(t);
    setTimeout(() => t.remove(), type === 'error' ? 7000 : 3800);
  }

  /* ───────────── theme ───────────── */
  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
    else delete document.documentElement.dataset.theme;
    document.querySelectorAll('#themeSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.theme === mode)));
  }
  $('#themeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-theme]');
    if (!b) return;
    store.set('w2x.theme', b.dataset.theme);
    applyTheme(b.dataset.theme);
  });
  applyTheme(['light', 'dark'].includes(store.get('w2x.theme')) ? store.get('w2x.theme') : 'auto');

  /* ───────────── settings ───────────── */
  const modelById = (id) => S.info.models.find((m) => m.id === id);
  const modelLabel = (id) => (S.info && modelById(id) ? modelById(id).label : id);
  const saveSettings = () => store.set('w2x.settings', JSON.stringify(S.settings));

  function scaleHint() {
    const m = modelById(S.settings.model);
    if (!m) return '';
    const t = Number(S.settings.scale), n = m.scale;
    if (t === n) return `Runs at the model's native <b>${n}×</b>.`;
    if (t < n) return `The model runs at its native <b>${n}×</b>, then the result is downscaled to <b>${t}×</b> (Lanczos).` + (n === 4 && t <= 2 ? ' A 2× model is faster for this.' : '');
    let passes = 1, reach = n;
    while (reach < t - 1e-9) { reach *= n; passes++; }
    return `Needs <b>${passes} passes</b> of the native ${n}× model (${reach}×)` + (reach === t ? '.' : `, then downscales to <b>${t}×</b>.`);
  }

  function renderSettings() {
    const info = S.info;
    // models
    renderModelSelect();
    // scale
    el.scaleSeg.innerHTML = info.scales.map((s) => `<button role="radio" data-scale="${s}">${s}×</button>`).join('');
    if (!info.scales.includes(Number(S.settings.scale))) S.settings.scale = 2;
    // device
    renderDevices();
    // advanced
    if (!['png', 'jpg', 'webp', 'avif', 'jxl'].includes(S.settings.format)) S.settings.format = 'png';
    if (!['fast', 'balanced', 'max'].includes(S.settings.pngOpt)) S.settings.pngOpt = 'balanced';
    el.format.value = S.settings.format;
    el.pngOpt.value = S.settings.pngOpt;
    el.metadata.checked = S.settings.metadata !== false;
    el.tile.value = S.settings.tile;
    el.tta.checked = !!S.settings.tta;
    el.safe.checked = !!S.settings.safe;
    if (!['keep', 'srgb'].includes(S.settings.profile)) S.settings.profile = 'keep';
    el.profile.value = S.settings.profile;
    refreshSettingsView();
  }

  const starred = (m) => (m.recommended ? '* ' : '') + m.label;
  function renderModelSelect() {
    const models = S.info.models;
    if (!models.length) {
      el.model.innerHTML = '<option value="" disabled selected>No models yet – download one</option>';
      S.settings.model = '';
    } else {
      el.model.innerHTML = models.map((m) => `<option value="${esc(m.id)}">${esc(starred(m))} · native ${m.scale}×</option>`).join('');
      if (!modelById(S.settings.model)) S.settings.model = (modelById(S.info.defaultModel) || models[0]).id;
      el.model.value = S.settings.model;
    }
  }

  function renderDevices() {
    const devs = S.info.devices;
    let html = devs.map((d) => `<option value="${d.id}">${d.type === 'cpu' ? 'CPU (software)' : 'GPU ' + d.id} — ${esc(d.name)}</option>`).join('');
    if (!devs.length) html = '<option value="" disabled selected>No Vulkan device found</option>';
    if (devs.length && !devs.some((d) => d.type === 'cpu')) html += '<option value="" disabled>CPU — needs a software Vulkan driver (see README)</option>';
    el.device.innerHTML = html;
    const valid = devs.some((d) => String(d.id) === String(S.settings.device));
    if (!valid) {
      const pick = devs.find((d) => d.type === 'gpu' && d.discrete) || devs.find((d) => d.type === 'gpu') || devs[0];
      S.settings.device = pick ? String(pick.id) : '';
    }
    el.device.value = S.settings.device;
    const d = devs.find((x) => String(x.id) === String(S.settings.device));
    if (!devs.length) el.deviceHint.innerHTML = 'Install the latest graphics driver (Linux: a Vulkan driver such as <b>mesa-vulkan-drivers</b>), then click rescan.';
    else if (d && d.type === 'cpu') el.deviceHint.textContent = 'Software rendering on the CPU. Expect it to be very slow.';
    else el.deviceHint.textContent = '';
  }

  function refreshSettingsView() {
    el.scaleSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.scale) === Number(S.settings.scale))));
    const m = modelById(S.settings.model);
    const dev = S.info.devices.find((d) => String(d.id) === String(S.settings.device));
    const heavyNote = m && m.heavy && dev && !dev.discrete ? ' Note: this is a large model and may not fit into the shared memory of integrated graphics. Photo Small or Universal Fast V2 are lighter.' : '';
    el.modelDesc.textContent = (m ? m.description : '') + heavyNote;
    el.scaleHint.innerHTML = scaleHint();
    el.profileHint.textContent = S.settings.profile === 'srgb'
      ? 'Colors are converted to sRGB before upscaling and no profile is embedded. Safest for apps that ignore profiles.'
      : 'The upscaled file carries the same embedded profile (e.g. Display P3), so colors look identical in color-managed apps.';
    renderFormatArea();
    updateWarn();
    updateToolbar();
    updateAllStatuses();
  }

  function updateWarn() {
    const i = S.info;
    let msg = '';
    if (!i.engineReady) msg = 'The upscaling engine is not installed. Run <code>npm run setup</code> once (internet needed), then restart the tool.';
    else if (!i.models.length) msg = 'No models yet. Click <b>Download models…</b> and pick at least one (internet needed once).';
    else if (!i.devices.length) msg = 'No Vulkan-capable device was detected, so nothing can be processed yet. Update your graphics driver and rescan.';
    el.warn.hidden = !msg;
    el.warn.innerHTML = msg;
  }
  const canProcess = () => S.info && S.info.engineReady && S.info.models.length && S.settings.device !== '' && S.settings.model && formatReady();

  el.model.addEventListener('change', () => { S.settings.model = el.model.value; saveSettings(); refreshSettingsView(); });
  el.scaleSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-scale]');
    if (!b) return;
    S.settings.scale = Number(b.dataset.scale); saveSettings(); refreshSettingsView();
  });
  el.profile.addEventListener('change', () => { S.settings.profile = el.profile.value; saveSettings(); refreshSettingsView(); });
  el.device.addEventListener('change', () => { S.settings.device = el.device.value; saveSettings(); renderDevices(); refreshSettingsView(); });
  el.tile.addEventListener('change', () => { S.settings.tile = el.tile.value; saveSettings(); });
  el.safe.addEventListener('change', () => { S.settings.safe = el.safe.checked; saveSettings(); });
  el.tta.addEventListener('change', () => { S.settings.tta = el.tta.checked; saveSettings(); });

  /* ───────────── output format, metadata, optional tools ───────────── */
  const FORMAT_HINTS = {
    png: 'Lossless. Saved with OxiPNG optimization.',
    jpg: 'Quality 95, no transparency (flattened on white). Max 65535 px per side.',
    webp: 'Quality 95. Max 16383 px per side.',
    avif: 'Quality 80. Encoding large images can take a while.',
    jxl: 'Quality 90. Encoding large images can take a while. Not every browser or app can open JPEG XL yet.',
  };
  const toolInfo = (id) => (S.info.tools || []).find((t) => t.id === id);
  const needsTool = () => (S.settings.format === 'png' ? 'oxipng' : S.settings.format === 'jxl' ? 'cjxl' : null);
  const formatReady = () => { const id = needsTool(); return !(id === 'cjxl' && !(toolInfo(id) || {}).installed); };

  function renderFormatArea() {
    el.formatHint.textContent = FORMAT_HINTS[S.settings.format] || '';
    el.pngOptField.hidden = S.settings.format !== 'png';
    el.metaHint.textContent = 'Copies EXIF and XMP from the original. Turn it off to drop camera, location and other data. The color profile has its own setting below.';
    const id = needsTool(), t = id && toolInfo(id);
    if (!t || t.installed) { el.toolNote.hidden = true; return; }
    el.toolNote.hidden = false;
    const need = id === 'cjxl' ? 'JPEG XL output needs the <b>cjxl</b> encoder.' : '<b>OxiPNG</b> is not installed, so PNG files use standard compression.';
    const downloading = t.state === 'downloading';
    el.toolText.innerHTML = need + (!t.installable ? ' There is no download for this platform; put <b>cjxl</b> in your PATH and restart.' : '') + (t.state === 'error' ? `<br><span style="color:var(--danger)">${esc(t.error || 'Install failed')}</span>` : '');
    el.toolInstall.hidden = !t.installable || downloading;
    el.toolInstall.innerHTML = `${ICON.download}<span>Install (~${t.sizeMB < 1 ? t.sizeMB : Math.round(t.sizeMB)} MB)</span>`;
    el.toolBar.hidden = !downloading;
    if (downloading) el.toolBar.firstElementChild.style.width = (t.total ? Math.min(100, t.received / t.total * 100) : 0) + '%';
  }
  el.format.addEventListener('change', () => { S.settings.format = el.format.value; saveSettings(); refreshSettingsView(); });
  el.pngOpt.addEventListener('change', () => { S.settings.pngOpt = el.pngOpt.value; saveSettings(); });
  el.metadata.addEventListener('change', () => { S.settings.metadata = el.metadata.checked; saveSettings(); });
  el.toolInstall.addEventListener('click', async () => {
    const id = needsTool();
    if (!id) return;
    el.toolInstall.disabled = true;
    try { await api('/api/tools/install', { method: 'POST', json: { id } }); }
    catch (err) { toast(err.message, 'error'); }
    el.toolInstall.disabled = false;
  });
  function onToolEvent(t) {
    const list = S.info.tools || (S.info.tools = []);
    const i = list.findIndex((x) => x.id === t.id), was = i >= 0 && list[i].installed;
    if (i >= 0) list[i] = t; else list.push(t);
    if (t.installed && !was) { toast(`${t.label} installed.`); refreshSettingsView(); } else renderFormatArea();
  }

  el.rescan.addEventListener('click', async () => {
    el.rescan.disabled = true;
    try { S.info.devices = (await api('/api/devices/rescan', { method: 'POST' })).devices; renderDevices(); refreshSettingsView(); toast(`${S.info.devices.length} device(s) found`); }
    catch (err) { toast(err.message, 'error'); }
    el.rescan.disabled = false;
  });
  el.openOut.addEventListener('click', () => api('/api/open-output', { method: 'POST' }).catch((e) => toast(e.message, 'error')));

  /* ───────────── adding files ───────────── */
  const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'gif', 'avif']);
  const isImage = (f) => IMG_EXT.has((f.name.split('.').pop() || '').toLowerCase());

  async function walkEntry(entry, prefix, out) {
    if (entry.isFile) {
      await new Promise((res) => entry.file((f) => { out.push({ file: f, rel: prefix + entry.name }); res(); }, () => res()));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res) => reader.readEntries(res, () => res([])));
        if (!batch.length) break;
        for (const child of batch) await walkEntry(child, prefix + entry.name + '/', out);
      }
    }
  }

  async function addEntries(list) {
    const valid = list.filter((e) => isImage(e.file));
    const skipped = list.length - valid.length;
    if (skipped && valid.length) toast(`${skipped} non-image file(s) skipped`);
    if (!valid.length) { toast('No supported images found (JPEG, PNG, WebP, TIFF, GIF, AVIF).', 'error'); return; }
    S.uploads.total += valid.length;
    updateToolbar();
    const queue = [...valid];
    const worker = async () => {
      while (queue.length) {
        const { file, rel } = queue.shift();
        try {
          const it = await api(`/api/upload?name=${encodeURIComponent(file.name)}&rel=${encodeURIComponent(rel || '')}`, { method: 'POST', body: file });
          upsertItem(it);
        } catch (err) { toast(`${file.name}: ${err.message}`, 'error'); }
        S.uploads.done++;
        updateToolbar();
      }
    };
    await Promise.all([worker(), worker()]);
    S.uploads = { total: 0, done: 0 };
    updateToolbar();
  }

  $('#pickFiles').addEventListener('click', (e) => { e.stopPropagation(); $('#fileInput').click(); });
  $('#pickDir').addEventListener('click', (e) => { e.stopPropagation(); $('#dirInput').click(); });
  el.drop.addEventListener('click', () => $('#fileInput').click());
  el.drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); } });
  $('#fileInput').addEventListener('change', (e) => { addEntries([...e.target.files].map((file) => ({ file, rel: '' }))); e.target.value = ''; });
  $('#dirInput').addEventListener('change', (e) => { addEntries([...e.target.files].map((file) => ({ file, rel: file.webkitRelativePath || '' }))); e.target.value = ''; });

  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0; document.body.classList.remove('dragging');
    const dt = e.dataTransfer;
    // Entries must be grabbed synchronously, before any await.
    const roots = dt.items ? [...dt.items].filter((i) => i.kind === 'file').map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)) : [];
    const plain = [...dt.files];
    const out = [];
    if (roots.length && roots.every(Boolean)) for (const r of roots) await walkEntry(r, '', out);
    else plain.forEach((file) => out.push({ file, rel: '' }));
    if (out.length) addEntries(out);
  });

  /* ───────────── list rendering ───────────── */
  const rows = new Map();
  const finishSince = new Map(); // job id -> { label, since } for the saving timer
  setInterval(() => { for (const j of S.jobs) if (j.status === 'running' && j.stage === 'finish') updateStatus(j.itemId); }, 1000);
  const jobFor = (id) => S.jobs.find((j) => j.itemId === id);

  function upsertItem(it) {
    S.items.set(it.id, it);
    let li = rows.get(it.id);
    if (!li) {
      li = document.createElement('li');
      li.className = 'item';
      li.dataset.id = it.id;
      rows.set(it.id, li);
      el.list.append(li);
    }
    li.innerHTML = rowHTML(it);
    updateStatus(it.id);
    updateToolbar();
    if (cmp.open && cmp.id === it.id) refreshCompareOptions(false);
  }
  function removeRow(id) {
    S.items.delete(id);
    const li = rows.get(id);
    if (li) li.remove();
    rows.delete(id);
    if (cmp.open && cmp.id === id) $('#cmp').close();
    updateToolbar();
  }

  function rowHTML(it) {
    const results = [...it.results].sort((a, b) => a.at - b.at).map((r) => {
      const tip = `${r.name} · ${fmtBytes(r.size)} · ${(r.ms / 1000).toFixed(1)} s on ${r.device}${it.hasMetadata ? (r.metadata ? ' · metadata kept' : ' · metadata removed') : ''}`;
      return `<span class="chip" title="${esc(tip)}">
        <button class="chip-main" data-act="compare" data-key="${esc(r.key)}"><i class="dot"></i>${esc(modelLabel(r.model))} ${fmtScale(r.scale)}${r.profile === 'srgb' ? '<span class="srgb">sRGB</span>' : ''}<span class="dim">${esc(r.format.toUpperCase())} · ${fmtDim(r.width, r.height)} · ${fmtBytes(r.size)}</span></button>
        <a class="chip-dl" href="/api/items/${it.id}/result/${encodeURIComponent(r.key)}?download=1" download title="Download ${esc(r.name)}" aria-label="Download result">${ICON.download}</a>
        <button class="chip-del" data-act="delete-result" data-key="${esc(r.key)}" title="Delete this result file" aria-label="Delete this result">${ICON.trash}</button>
      </span>`;
    }).join('');
    const title = it.relPath || it.name;
    return `
      <img class="thumb" src="/api/items/${it.id}/thumb?v=${it.version}" alt="" loading="lazy" draggable="false">
      <div class="body">
        <div class="name" title="${esc(title)}">${esc(shorten(it.name))}</div>
        <div class="meta"><span class="tech">${fmtDim(it.width, it.height)}</span><span class="tech">${esc(it.format)}</span><span class="tech">${fmtBytes(it.size)}</span>${it.profile ? `<span class="tech icc" title="Embedded color profile: ${esc(it.profile)}">ICC: ${esc(it.profile)}</span>` : ''}</div>
        <div class="results">${results}</div>
        <div class="status" hidden><span class="stext"></span><div class="bar" hidden><i></i></div><div class="serr"></div></div>
      </div>
      <div class="actions">
        <button class="btn tone-green" data-act="run"></button>
        <button class="btn tone-blue" data-act="compare" title="Compare with the original or another result" ${it.results.length ? '' : 'hidden'}>${ICON.compare}<span>Compare</span></button>
        <button class="btn tone-red" data-act="remove" title="Remove from list">${ICON.trash}<span>Remove</span></button>
      </div>`;
  }

  function updateStatus(id) {
    const li = rows.get(id), it = S.items.get(id);
    if (!li || !it) return;
    const job = jobFor(id);
    const status = li.querySelector('.status'), run = li.querySelector('[data-act="run"]');
    const stext = status.querySelector('.stext'), bar = status.querySelector('.bar'), fill = bar.firstElementChild, serr = status.querySelector('.serr');
    const running = !!job && job.status === 'running';
    li.classList.toggle('busy', running);
    status.classList.toggle('err', !job && !!it.error);
    status.hidden = !job && !it.error;
    // The progress bar element is created once and only its width changes (no re-creation on every update).
    const finishing = running && job.stage === 'finish';
    bar.hidden = !running;
    bar.classList.toggle('indet', finishing);
    if (finishing) {
      // Saving can take long (PNG optimization, AVIF / JPEG XL encoding): animated bar + a ticking timer show that it is alive.
      let f = finishSince.get(job.id);
      if (!f || f.label !== job.label) { f = { label: job.label, since: Date.now() }; finishSince.set(job.id, f); }
      const secs = Math.floor((Date.now() - f.since) / 1000);
      stext.innerHTML = `<span class="spin"></span>${esc(job.label)}… ${secs} s`;
    } else if (running) {
      const pass = job.passes > 1 ? ` · pass ${job.pass}/${job.passes}` : '';
      stext.textContent = `Processing with ${modelLabel(job.model)} ${fmtScale(job.scale)}${pass} · ${Math.round(job.percent)}%`;
      fill.style.width = job.percent + '%';
    } else if (job) stext.textContent = 'Waiting in queue…';
    else stext.textContent = '';
    if (!job && it.error) {
      const sig = it.error + '|' + (it.errorDetail || '');
      if (serr.dataset.sig !== sig) {
        serr.dataset.sig = sig;
        serr.innerHTML = esc(it.error) + (it.errorDetail ? `<details class="errd"><summary>Engine output</summary><pre>${esc(it.errorDetail)}</pre></details>` : '');
      }
    } else if (serr.dataset.sig) { serr.dataset.sig = ''; serr.innerHTML = ''; }
    run.classList.toggle('tone-amber', !!job);
    run.classList.toggle('tone-green', !job);
    const mode = job ? 'cancel' : 'run';
    if (run.dataset.mode !== mode || run.dataset.scale !== String(S.settings.scale)) {
      run.dataset.mode = mode; run.dataset.scale = String(S.settings.scale);
      run.innerHTML = job ? `${ICON.stop}<span>Cancel</span>` : `${ICON.play}<span>Upscale ${fmtScale(S.settings.scale)}</span>`;
    }
    run.disabled = job ? false : !canProcess();
  }
  function updateAllStatuses() { for (const id of S.items.keys()) updateStatus(id); }

  function updateToolbar() {
    const n = S.items.size;
    el.toolbar.hidden = n === 0;
    el.drop.classList.toggle('compact', n > 0);
    const busy = S.jobs.length;
    let text = `<b>${n}</b> image${n === 1 ? '' : 's'}`;
    if (S.uploads.total) text += ` · adding ${S.uploads.done}/${S.uploads.total}…`;
    else if (busy) text += ` · ${busy} in queue`;
    el.count.innerHTML = text;
    el.runAll.disabled = !n || !canProcess();
    el.stopAll.hidden = !busy;
    el.runAll.querySelector('span').textContent = `Upscale all ${fmtScale(S.settings.scale)}`;
  }

  async function startJobs(ids, force) {
    if (!canProcess()) { toast('Pick a model and a device first.', 'error'); return; }
    try {
      const s = S.settings;
      const r = await api('/api/process', { method: 'POST', json: { ids, force, model: s.model, scale: s.scale, device: Number(s.device), format: s.format, tile: Number(s.tile), tta: s.tta, profile: s.profile, safe: s.safe, metadata: s.metadata, pngOpt: s.pngOpt } });
      if (!r.queued) toast('Nothing to do – these images already have this result. Change a setting or process one image on its own to redo it.');
      else if (ids.length > 1) toast(`Queued ${r.queued} of ${ids.length} image(s)`);
    } catch (err) { toast(err.message, 'error'); }
  }

  el.list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('.item').dataset.id;
    const act = b.dataset.act;
    if (act === 'run') {
      if (b.dataset.mode === 'cancel') api('/api/cancel', { method: 'POST', json: { itemId: id } });
      else startJobs([id], true);
    } else if (act === 'compare') openCompare(id, b.dataset.key);
    else if (act === 'delete-result') {
      const r = S.items.get(id).results.find((x) => x.key === b.dataset.key);
      if (!r) return;
      if (!confirm(`Delete this result from the output folder?\n\n${r.name}\n${r.format.toUpperCase()} · ${fmtDim(r.width, r.height)} · ${fmtBytes(r.size)}\n\nThis cannot be undone.`)) return;
      api(`/api/items/${id}/result/${encodeURIComponent(r.key)}`, { method: 'DELETE' }).then(() => toast('Result deleted.')).catch((err) => toast(err.message, 'error'));
    }
    else if (act === 'remove') {
      const had = S.items.get(id).results.length;
      api(`/api/items/${id}`, { method: 'DELETE' }).then(() => { if (had) toast('Removed from the list. Result files stay in the output folder.'); });
    }
  });
  el.runAll.addEventListener('click', () => startJobs([...S.items.keys()], false));
  el.stopAll.addEventListener('click', () => api('/api/cancel', { method: 'POST', json: { all: true } }));
  el.clearAll.addEventListener('click', () => {
    if (!S.items.size) return;
    api('/api/items', { method: 'DELETE' }).then(() => toast('List cleared. Result files stay in the output folder.'));
  });

  /* ───────────── compare viewer ───────────── */
  const cmp = { native: store.get('w2x.cmpnative', '0') === '1', open: false, id: null, a: 'orig', b: null, mode: store.get('w2x.cmpmode', 'slider'), split: 0.5, s: 1, tx: 0, ty: 0, fit: 1, W: 1, H: 1, atFit: true };
  const dlg = $('#cmp'), view = $('#cmpView');
  const paneA = view.querySelector('.pane-a'), paneB = view.querySelector('.pane-b');
  const layerA = paneA.querySelector('.layer'), layerB = paneB.querySelector('.layer');
  const imgA = layerA.querySelector('img'), imgB = layerB.querySelector('img');
  const selA = $('#cmpA'), selB = $('#cmpB');

  function sourcesOf(it) {
    const list = [{ key: 'orig', label: 'Original', w: it.width, h: it.height, size: it.size, url: `/api/items/${it.id}/input?v=${it.version}` }];
    for (const r of [...it.results].sort((a, b) => a.at - b.at)) {
      list.push({ key: r.key, label: `${modelLabel(r.model)} ${fmtScale(r.scale)} (${r.format.toUpperCase()}${r.profile === 'srgb' ? ', sRGB' : ''})`, w: r.width, h: r.height, size: r.size, url: `/api/items/${it.id}/result/${encodeURIComponent(r.key)}?v=${r.at}${r.format === 'jxl' ? '&preview=1' : ''}` });
    }
    return list;
  }
  const srcOf = (key) => sourcesOf(S.items.get(cmp.id)).find((s) => s.key === key);

  function openCompare(id, bKey) {
    const it = S.items.get(id);
    if (!it) return;
    if (!it.results.length) { toast('Upscale this image first, then compare.'); return; }
    cmp.id = id;
    cmp.a = 'orig';
    cmp.b = bKey && it.results.some((r) => r.key === bKey) ? bKey : [...it.results].sort((a, b) => b.at - a.at)[0].key;
    cmp.split = 0.5;
    cmp.atFit = true;
    cmp.open = true;
    if (!dlg.open) dlg.showModal();
    refreshCompareOptions(true);
  }

  function refreshCompareOptions(reset) {
    const it = S.items.get(cmp.id);
    if (!it) return;
    if (!it.results.length) { dlg.close(); return; }
    const list = sourcesOf(it);
    if (!list.some((s) => s.key === cmp.a)) cmp.a = 'orig';
    if (!list.some((s) => s.key === cmp.b)) cmp.b = list[list.length - 1].key;
    const opts = list.map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('');
    selA.innerHTML = opts; selB.innerHTML = opts;
    selA.value = cmp.a; selB.value = cmp.b;
    renderCompare(reset);
  }

  function renderCompare(refit) {
    const it = S.items.get(cmp.id);
    if (!it) return;
    const a = srcOf(cmp.a), b = srcOf(cmp.b);
    cmp.W = Math.max(a.w, b.w); cmp.H = Math.max(a.h, b.h);
    // "Native size": the original keeps its own pixel size (centered in the stage) instead of being stretched.
    const shown = (s) => (cmp.native && s.key === 'orig' ? { w: s.w, h: s.h } : { w: cmp.W, h: cmp.H });
    for (const [layer, img, s] of [[layerA, imgA, a], [layerB, imgB, b]]) {
      const d = shown(s);
      layer.style.width = cmp.W + 'px'; layer.style.height = cmp.H + 'px';
      img.style.width = d.w + 'px'; img.style.height = d.h + 'px';
      img.style.left = (cmp.W - d.w) / 2 + 'px'; img.style.top = (cmp.H - d.h) / 2 + 'px';
      if (img.dataset.src !== s.url) { img.dataset.src = s.url; img.src = s.url; }
    }
    $('#cmpNative').checked = cmp.native;
    $('#cmpNative').disabled = !(a.key === 'orig' || b.key === 'orig');
    $('#tagA').innerHTML = `<b>A</b>${esc(a.label)}`;
    $('#tagB').innerHTML = `<b>B</b>${esc(b.label)}`;
    view.dataset.mode = cmp.mode;
    document.querySelectorAll('#cmpMode button').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.mode === cmp.mode)));
    const stretched = (s) => {
      if (s.key === 'orig' && cmp.native) return s.w !== cmp.W || s.h !== cmp.H ? ' <span class="note">shown at native size</span>' : '';
      return s.w !== cmp.W || s.h !== cmp.H ? ` <span class="note">stretched to ${fmtDim(cmp.W, cmp.H)}</span>` : '';
    };
    $('#cmpFoot').innerHTML =
      `<span><b>A</b> ${esc(a.label)} · <span class="mono">${fmtDim(a.w, a.h)}</span> · ${fmtBytes(a.size)}${stretched(a)}</span>` +
      `<span><b>B</b> ${esc(b.label)} · <span class="mono">${fmtDim(b.w, b.h)}</span> · ${fmtBytes(b.size)}${stretched(b)}</span>`;
    if (refit) cmp.atFit = true;
    layout();
  }

  function paneSize() { return { w: paneA.clientWidth || 1, h: paneA.clientHeight || 1 }; }
  function layout() {
    const { w, h } = paneSize();
    cmp.fit = Math.min(w / cmp.W, h / cmp.H);
    if (cmp.atFit) { cmp.s = cmp.fit; }
    cmp.s = clamp(cmp.s, cmp.fit, 24);
    if (cmp.atFit) { cmp.tx = (w - cmp.W * cmp.s) / 2; cmp.ty = (h - cmp.H * cmp.s) / 2; }
    clampPan();
    applyView();
  }
  function clampPan() {
    const { w, h } = paneSize();
    const iw = cmp.W * cmp.s, ih = cmp.H * cmp.s;
    cmp.tx = iw <= w ? (w - iw) / 2 : clamp(cmp.tx, w - iw, 0);
    cmp.ty = ih <= h ? (h - ih) / 2 : clamp(cmp.ty, h - ih, 0);
  }
  function applyView() {
    const t = `translate(${cmp.tx}px, ${cmp.ty}px) scale(${cmp.s})`;
    layerA.style.transform = t; layerB.style.transform = t;
    const pct = cmp.split * 100;
    paneB.style.clipPath = cmp.mode === 'slider' ? `inset(0 0 0 ${pct}%)` : 'none';
    $('#divider').style.left = pct + '%';
    $('#divider .handle').setAttribute('aria-valuenow', String(Math.round(pct)));
    $('#zLabel').textContent = cmp.atFit || Math.abs(cmp.s - cmp.fit) < 1e-4 ? 'Fit' : Math.round(cmp.s * 100) + '%';
  }
  function zoomAt(factor, px, py) {
    const ns = clamp(cmp.s * factor, cmp.fit, 24);
    if (ns === cmp.s) return;
    cmp.tx = px - (px - cmp.tx) * (ns / cmp.s);
    cmp.ty = py - (py - cmp.ty) * (ns / cmp.s);
    cmp.s = ns;
    cmp.atFit = Math.abs(ns - cmp.fit) < 1e-4;
    clampPan(); applyView();
  }
  const zoomCenter = (f) => { const { w, h } = paneSize(); zoomAt(f, w / 2, h / 2); };
  function setActual() {
    const { w, h } = paneSize();
    zoomAt(Math.max(1, cmp.fit) / cmp.s, w / 2, h / 2);
    applyView();
  }

  // interactions
  let drag = null;
  view.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.handle')) { drag = { type: 'split' }; }
    else { drag = { type: 'pan', x: e.clientX, y: e.clientY, tx: cmp.tx, ty: cmp.ty }; view.classList.add('panning'); }
    view.setPointerCapture(e.pointerId);
  });
  view.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.type === 'split') {
      const r = view.getBoundingClientRect();
      cmp.split = clamp((e.clientX - r.left) / r.width, 0, 1);
    } else {
      cmp.tx = drag.tx + (e.clientX - drag.x); cmp.ty = drag.ty + (e.clientY - drag.y);
      cmp.atFit = false; clampPan();
    }
    applyView();
  });
  const endDrag = () => { drag = null; view.classList.remove('panning'); };
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const pane = e.target.closest('.pane') || paneA;
    const r = pane.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  view.addEventListener('dblclick', (e) => {
    if (e.target.closest('.handle')) return;
    if (cmp.atFit) setActual(); else { cmp.atFit = true; layout(); }
  });
  view.querySelector('.handle').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { cmp.split = clamp(cmp.split + (e.key === 'ArrowLeft' ? -0.02 : 0.02), 0, 1); applyView(); e.preventDefault(); }
  });
  new ResizeObserver(() => { if (cmp.open) layout(); }).observe(view);

  selA.addEventListener('change', () => { cmp.a = selA.value; renderCompare(false); });
  selB.addEventListener('change', () => { cmp.b = selB.value; renderCompare(false); });
  $('#cmpSwap').addEventListener('click', () => { [cmp.a, cmp.b] = [cmp.b, cmp.a]; selA.value = cmp.a; selB.value = cmp.b; renderCompare(false); });
  $('#cmpMode').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    cmp.mode = b.dataset.mode; store.set('w2x.cmpmode', cmp.mode); cmp.atFit = true; renderCompare(true);
  });
  $('#cmpNative').addEventListener('change', (e) => { cmp.native = e.target.checked; store.set('w2x.cmpnative', cmp.native ? '1' : '0'); renderCompare(false); });
  $('#zIn').addEventListener('click', () => zoomCenter(1.5));
  $('#zOut').addEventListener('click', () => zoomCenter(1 / 1.5));
  $('#zLabel').addEventListener('click', () => { cmp.atFit = true; layout(); });
  $('#z100').addEventListener('click', setActual);
  $('#cmpClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { cmp.open = false; imgA.removeAttribute('src'); imgB.removeAttribute('src'); delete imgA.dataset.src; delete imgB.dataset.src; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.target.closest('select')) return;
    if (e.key === '+' || e.key === '=') zoomCenter(1.5);
    else if (e.key === '-') zoomCenter(1 / 1.5);
    else if (e.key === '0') { cmp.atFit = true; layout(); }
    else if (e.key === '1') setActual();
  });


  /* ───────────── models dialog ───────────── */
  const mdl = $('#models'), mdlList = $('#mdlList');
  const fmtSize = (mb) => (mb < 1 ? Math.max(1, Math.round(mb * 1024)) + ' KB' : mb < 10 ? mb.toFixed(1) + ' MB' : Math.round(mb) + ' MB');

  function modelRowHTML(m) {
    const name = m.label;
    let act;
    if (m.installed) act = '<div class="badge-ok"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>Downloaded</div>';
    else if (m.state === 'downloading') {
      const pct = m.total ? Math.min(100, m.received / m.total * 100) : 0;
      act = `<div class="bar"><i style="width:${pct}%"></i></div><div class="small-note">${Math.round(pct)}%</div>`;
    } else {
      act = `<button class="btn tone-green small" data-dl="${esc(m.id)}">${ICON.download}<span>Download · ${fmtSize(m.sizeMB)}</span></button>`;
      if (m.state === 'error') act += `<div class="err-note">${esc(m.error || 'Download failed')}</div>`;
    }
    return `<div class="mrow ${m.installed ? 'ok' : ''} ${m.state === 'error' ? 'err' : ''}" data-id="${esc(m.id)}">
      <div>
        <div class="mname"><span>${esc(name)}</span>${m.recommended ? '<span class="rec">Recommended</span>' : ''}<span class="tech">native ${m.scale}×</span>${m.heavy ? '<span class="tech" title="Large model: needs about 1 GB of video memory">heavy</span>' : ''}<span class="mid">${esc(m.id)}</span></div>
        <div class="mdesc">${esc(m.description)}</div>
        <div class="mlic"><b>Author:</b> ${esc(m.author)}<br><b>License:</b> ${esc(m.license)}</div>
      </div>
      <div class="mact">${act}</div>
    </div>`;
  }
  function renderCatalog() {
    mdlList.innerHTML = S.catalog.map(modelRowHTML).join('');
  }
  async function loadCatalog() {
    try { S.catalog = (await api('/api/models')).models; renderCatalog(); } catch (err) { toast(err.message, 'error'); }
  }
  function openModels() { mdl.showModal(); loadCatalog(); }
  async function refreshInstalled() {
    S.info.models = (await api('/api/info')).models;
    renderModelSelect();
    refreshSettingsView();
  }
  el.manageModels.addEventListener('click', openModels);
  $('#mdlClose').addEventListener('click', () => mdl.close());
  mdl.addEventListener('click', (e) => { if (e.target === mdl) mdl.close(); });
  mdlList.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dl]');
    if (!b) return;
    b.disabled = true;
    try { await api('/api/models/download', { method: 'POST', json: { id: b.dataset.dl } }); }
    catch (err) { toast(err.message, 'error'); b.disabled = false; }
  });
  function onModelEvent(m) {
    const was = S.catalog.find((x) => x.id === m.id);
    const idx = S.catalog.findIndex((x) => x.id === m.id);
    if (idx >= 0) S.catalog[idx] = m; else S.catalog.push(m);
    if (mdl.open) {
      const row = mdlList.querySelector(`.mrow[data-id="${CSS.escape(m.id)}"]`);
      if (row) row.outerHTML = modelRowHTML(m); else renderCatalog();
    }
    if (m.installed && !(was && was.installed)) {
      toast(`Model downloaded: ${(m.recommended ? '* ' : '') + m.label}`);
      refreshInstalled();
    } else if (m.state === 'error') toast(`${m.label}: ${m.error}`, 'error');
  }

  /* ───────────── live updates ───────────── */
  function connectEvents() {
    const es = new EventSource('/api/events');
    es.addEventListener('item', (e) => upsertItem(JSON.parse(e.data)));
    es.addEventListener('model', (e) => onModelEvent(JSON.parse(e.data)));
    es.addEventListener('tool', (e) => onToolEvent(JSON.parse(e.data)));
    es.addEventListener('remove', (e) => removeRow(JSON.parse(e.data).id));
    es.addEventListener('queue', (e) => {
      const before = new Set(S.jobs.map((j) => j.itemId));
      S.jobs = JSON.parse(e.data).jobs;
      for (const id of new Set([...before, ...S.jobs.map((j) => j.itemId)])) updateStatus(id);
      updateToolbar();
    });
    es.addEventListener('progress', (e) => {
      const p = JSON.parse(e.data);
      const j = S.jobs.find((x) => x.id === p.jobId);
      if (j) { j.percent = p.percent; j.pass = p.pass; j.passes = p.passes; if (p.stage) { j.stage = p.stage; j.label = p.label; } updateStatus(p.itemId); }
    });
    es.addEventListener('open', syncState);
  }
  async function syncState() {
    try {
      const st = await api('/api/state');
      S.jobs = st.jobs;
      const seen = new Set(st.items.map((i) => i.id));
      for (const id of [...S.items.keys()]) if (!seen.has(id)) removeRow(id);
      st.items.forEach(upsertItem);
      updateToolbar();
    } catch { /* server not reachable */ }
  }

  /* ───────────── init ───────────── */
  (async function init() {
    try {
      S.info = await api('/api/info');
    } catch (err) {
      document.body.innerHTML = '<p style="padding:40px;font:16px system-ui">Cannot reach the Image Upscale W2X server. Start it again with start.bat / start.sh.</p>';
      return;
    }
    try { Object.assign(S.settings, JSON.parse(store.get('w2x.settings', '{}'))); } catch { /* ignore */ }
    el.outDir.textContent = S.info.outputDir;
    el.openOut.hidden = !S.info.canOpenFolder;
    el.netPill.hidden = S.info.mode !== 'network';
    renderSettings();
    connectEvents();
    await syncState();
    if (S.info.engineReady && !S.info.models.length) openModels();
  })();
})();
