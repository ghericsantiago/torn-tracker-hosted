// ==UserScript==
// @name         Torn Market Pulse
// @namespace    torn-market-pulse
// @version      1.4.0
// @description  Quick market research drawer — Item Market, Bazaar & IMA price history
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.torn.com
// @connect      weav3r.dev
// @connect      torn-imarket-tracker.gvsantiago.com
// @connect      itrade.devs.surf
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const IMA_URL       = 'https://torn-imarket-tracker.gvsantiago.com';
  const WEAV3R        = 'https://weav3r.dev';
  const APP_URL       = 'https://itrade.devs.surf';
  const RECEIPT_TOKEN = '926cc7e6-5092-40cc-ba8a-a3f9b8070a6c';

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fmt(n) {
    if (n == null) return '—';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
    if (abs >= 1_000)     return '$' + (n / 1_000).toFixed(1) + 'K';
    return '$' + Number(n).toLocaleString('en-US');
  }
  function fmtFull(n) {
    return n == null ? '—' : '$' + Number(n).toLocaleString('en-US');
  }
  function fmtTs(unix) {
    if (!unix) return '—';
    const d = new Date(unix * 1000);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
           d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtIso(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
           d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDay(utcDate) {
    return utcDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function fmtHHMM(ms) {
    const d = new Date(ms);
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }
  function todayUTC() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  function sameDay(a, b) {
    return a.getUTCFullYear() === b.getUTCFullYear() &&
           a.getUTCMonth()    === b.getUTCMonth()    &&
           a.getUTCDate()     === b.getUTCDate();
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }
  function gmGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, headers, timeout: 12000,
        onload:    r => { try { resolve(JSON.parse(r.responseText)); } catch { reject(new Error('Parse error')); } },
        onerror:   () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let currentItem = null;
  let acTimer     = null;
  let imaChart    = null;
  let imaState    = { itemId: null, date: null, refPrice: null, catalogPrice: null };

  // ── Styles ────────────────────────────────────────────────────────────────
  GM_addStyle(`
    :root {
      --mp-accent:  #4ade80;
      --mp-bg:      #07080f;
      --mp-card:    rgba(255,255,255,0.035);
      --mp-border:  rgba(255,255,255,0.08);
      --mp-muted:   #64748b;
      --mp-dim:     #94a3b8;
      --mp-tr:      0.18s ease;
      --mp-mono:    'JetBrains Mono', monospace;
    }
    #mp-toggle {
      position: fixed; left: 0; top: 50%; transform: translateY(-50%);
      background: rgba(74,222,128,0.08); border: 1px solid rgba(74,222,128,0.22);
      border-left: none; color: var(--mp-accent);
      width: 18px; padding: 12px 0; border-radius: 0 6px 6px 0;
      cursor: pointer; z-index: 2147483638;
      writing-mode: vertical-rl; text-orientation: mixed;
      font: 700 8px/1 var(--mp-mono); letter-spacing: 2px;
      user-select: none; backdrop-filter: blur(12px);
      transition: background var(--mp-tr), opacity 0.2s;
    }
    #mp-toggle:hover { background: rgba(74,222,128,0.15); }
    #mp-toggle.open  { opacity: 0; pointer-events: none; }

    #mp-panel {
      position: fixed; top: 0; left: -540px; width: min(520px, 100vw);
      height: 100dvh; background: rgba(7,8,15,0.97);
      backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
      border-right: 1px solid var(--mp-border);
      box-shadow: 12px 0 60px rgba(0,0,0,0.8);
      z-index: 2147483643; display: flex; flex-direction: column;
      transition: left 0.32s cubic-bezier(.4,0,.2,1);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      font-size: 13px; color: #dde2e8; overflow: hidden;
    }
    #mp-panel.open { left: 0; }

    #mp-hdr {
      padding: 13px 16px 11px; border-bottom: 1px solid var(--mp-border);
      background: rgba(74,222,128,0.03); flex-shrink: 0;
      display: flex; align-items: center; gap: 10px;
    }
    #mp-hdr h2 { margin: 0; font-size: 13px; font-weight: 700; color: #e2e8f0; flex: 1; line-height: 1.4; }
    #mp-item-tag { display: block; font-size: 10px; color: var(--mp-accent); font-family: var(--mp-mono); font-weight: 400; }
    .mp-icon-btn {
      background: none; border: 1px solid var(--mp-border); color: var(--mp-muted);
      width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 13px;
      display: flex; align-items: center; justify-content: center;
      transition: color var(--mp-tr); flex-shrink: 0;
    }
    .mp-icon-btn:hover { color: #e2e8f0; }

    #mp-search-wrap {
      padding: 11px 14px; border-bottom: 1px solid var(--mp-border);
      flex-shrink: 0; position: relative;
    }
    #mp-search {
      width: 100%; box-sizing: border-box;
      background: rgba(255,255,255,0.06); border: 1px solid rgba(74,222,128,0.25);
      border-radius: 8px; padding: 8px 32px 8px 12px; color: #e2e8f0;
      font-size: 13px; outline: none; transition: border-color var(--mp-tr);
    }
    #mp-search:focus { border-color: rgba(74,222,128,0.5); }
    #mp-search::placeholder { color: var(--mp-muted); }
    #mp-search-clear {
      position: absolute; right: 22px; top: 50%; transform: translateY(-50%);
      background: none; border: none; color: var(--mp-muted);
      cursor: pointer; padding: 4px 6px; font-size: 11px; line-height: 1;
      display: none; align-items: center; justify-content: center;
      transition: color var(--mp-tr); border-radius: 4px;
    }
    #mp-search-clear:hover { color: #e2e8f0; background: rgba(255,255,255,0.06); }
    #mp-search-clear.visible { display: flex; }
    #mp-ac {
      position: absolute; top: calc(100% - 2px); left: 14px; right: 14px;
      background: #0d1020; border: 1px solid rgba(74,222,128,0.25);
      border-top: none; border-radius: 0 0 8px 8px;
      z-index: 10; max-height: 220px; overflow-y: auto; display: none;
    }
    #mp-ac.show { display: block; }
    .mp-ac-row {
      padding: 8px 12px; cursor: pointer; font-size: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      display: flex; justify-content: space-between; align-items: center;
      transition: background var(--mp-tr);
    }
    .mp-ac-row:hover, .mp-ac-row.focused { background: rgba(74,222,128,0.08); }
    .mp-ac-row:last-child { border-bottom: none; }
    .mp-ac-id { color: var(--mp-muted); font-size: 10px; font-family: var(--mp-mono); }

    #mp-body { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
    #mp-empty { text-align: center; color: var(--mp-muted); padding: 60px 0; font-size: 12px; line-height: 2.2; }

    /* Receipt strip */
    #mp-receipt-strip {
      display: flex; gap: 1px; background: var(--mp-border);
      border: 1px solid rgba(74,222,128,0.18); border-radius: 10px; overflow: hidden;
    }
    .rs-cell { flex: 1; background: var(--mp-bg); padding: 9px 12px; display: flex; flex-direction: column; gap: 2px; }
    .rs-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--mp-muted); }
    .rs-val { font-size: 14px; font-weight: 700; font-family: var(--mp-mono); color: #e2e8f0; }
    .rs-val.green { color: #4ade80; }
    .rs-val.cyan  { color: #22d3ee; }
    .rs-sub { font-size: 9px; color: var(--mp-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Markets side-by-side */
    #mp-markets-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

    /* Section cards */
    .mp-sec { background: var(--mp-card); border: 1px solid var(--mp-border); border-radius: 10px; overflow: hidden; min-width: 0; }
    .mp-sec-hdr {
      padding: 7px 10px; border-bottom: 1px solid var(--mp-border);
      font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--mp-muted);
      display: flex; align-items: center; gap: 6px; flex-shrink: 0;
    }
    .mp-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
    .mp-dot.green  { background: #4ade80; }
    .mp-dot.yellow { background: #fbbf24; }
    .mp-dot.cyan   { background: #22d3ee; }

    /* IMA date navigation */
    .mp-date-nav { margin-left: auto; display: flex; align-items: center; gap: 4px; }
    .mp-nav-btn {
      background: rgba(255,255,255,0.06); border: 1px solid var(--mp-border);
      color: var(--mp-dim); width: 18px; height: 18px; border-radius: 4px;
      cursor: pointer; font-size: 11px; display: flex; align-items: center;
      justify-content: center; padding: 0; line-height: 1;
      transition: background var(--mp-tr), color var(--mp-tr);
    }
    .mp-nav-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); color: #e2e8f0; }
    .mp-nav-btn:disabled { opacity: 0.3; cursor: default; }
    #mp-ima-date { font-size: 9px; font-weight: 400; color: #94a3b8; min-width: 72px; text-align: center; font-family: var(--mp-mono); }

    /* Chart legend */
    .mp-chart-legend {
      display: flex; gap: 12px; padding: 4px 10px 0;
      font-size: 9px; color: var(--mp-muted);
    }
    .mp-legend-item { display: flex; align-items: center; gap: 4px; }
    .mp-legend-line { width: 14px; height: 2px; border-radius: 1px; }

    /* Key stat inside narrow card */
    .mp-key-stat {
      padding: 7px 10px; border-bottom: 1px solid var(--mp-border);
      display: flex; flex-direction: column; gap: 1px;
    }
    .mp-key-lbl { font-size: 8px; text-transform: uppercase; color: var(--mp-muted); letter-spacing: 0.06em; }
    .mp-key-val { font-size: 14px; font-weight: 700; font-family: var(--mp-mono); }
    .mp-key-val.green  { color: #4ade80; }
    .mp-key-val.yellow { color: #fbbf24; }
    .mp-key-sub { font-size: 9px; color: var(--mp-muted); }

    .mp-price-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 5px 10px; border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .mp-price-row:last-child { border-bottom: none; }
    .mp-price-row.cheapest   .mp-pr-price { color: #4ade80; font-weight: 700; }
    .mp-price-row.cheapest-y .mp-pr-price { color: #fbbf24; font-weight: 700; }
    .mp-pr-price { font-family: var(--mp-mono); font-size: 11px; }
    .mp-pr-right { font-size: 10px; color: var(--mp-dim); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 55%; }
    .mp-more { padding: 5px 10px; font-size: 9px; color: var(--mp-muted); border-top: 1px solid rgba(255,255,255,0.03); }

    /* IMA stats row */
    .mp-stats4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 1px; background: var(--mp-border); }
    .mp-stat4 { background: var(--mp-bg); padding: 7px 10px; display: flex; flex-direction: column; gap: 2px; }
    .mp-stat4-lbl { font-size: 8px; text-transform: uppercase; color: var(--mp-muted); letter-spacing: 0.06em; }
    .mp-stat4-val { font-size: 12px; font-weight: 700; font-family: var(--mp-mono); color: #e2e8f0; }
    .mp-stat4-val.green { color: #4ade80; }
    .mp-stat4-val.cyan  { color: #22d3ee; }
    .mp-stat4-val.red   { color: #f87171; }
    .mp-stat4-sub { font-size: 8px; color: var(--mp-muted); }

    /* Chart */
    .mp-chart-wrap { position: relative; height: 180px; padding: 8px 10px 6px; }

    .mp-loading { padding: 16px 10px; text-align: center; color: var(--mp-muted); font-size: 11px; }
    .mp-err     { padding: 10px; color: #f87171; font-size: 10px; word-break: break-word; }

    #mp-footer {
      padding: 9px 14px; border-top: 1px solid var(--mp-border);
      flex-shrink: 0; display: flex; align-items: center; gap: 8px;
      background: rgba(0,0,0,0.3);
    }
    #mp-footer label { font-size: 9px; color: var(--mp-muted); white-space: nowrap; text-transform: uppercase; letter-spacing: 0.06em; }
    #mp-key-input {
      flex: 1; background: rgba(255,255,255,0.05); border: 1px solid var(--mp-border);
      border-radius: 6px; padding: 5px 9px; color: #94a3b8;
      font-size: 10px; font-family: var(--mp-mono); outline: none;
    }
    #mp-key-input:focus { border-color: rgba(74,222,128,0.3); color: #e2e8f0; }
    #mp-key-save {
      background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.25);
      color: #4ade80; border-radius: 6px; padding: 5px 10px;
      font-size: 10px; cursor: pointer; white-space: nowrap;
    }
    #mp-key-save:hover { background: rgba(74,222,128,0.18); }
  `);

  // ── Build DOM ─────────────────────────────────────────────────────────────
  function buildUI() {
    const toggle = document.createElement('button');
    toggle.id = 'mp-toggle';
    toggle.textContent = 'MARKET';

    const panel = document.createElement('div');
    panel.id = 'mp-panel';
    panel.innerHTML = `
      <div id="mp-hdr">
        <h2>Market Pulse<span id="mp-item-tag"></span></h2>
        <button class="mp-icon-btn" id="mp-close">✕</button>
      </div>
      <div id="mp-search-wrap">
        <input id="mp-search" placeholder="Search item name…" autocomplete="off" spellcheck="false" />
        <button id="mp-search-clear" title="Clear">✕</button>
        <div id="mp-ac"></div>
      </div>
      <div id="mp-body">
        <div id="mp-empty">Search for an item above<br>to see live market data</div>
      </div>
      <div id="mp-footer">
        <label for="mp-key-input">Torn API Key</label>
        <input id="mp-key-input" type="password" placeholder="Enter key…" />
        <button id="mp-key-save">Save</button>
      </div>
    `;

    document.body.appendChild(toggle);
    document.body.appendChild(panel);

    const keyInput = panel.querySelector('#mp-key-input');
    keyInput.value = GM_getValue('tornApiKey', '');
    panel.querySelector('#mp-key-save').addEventListener('click', () => {
      GM_setValue('tornApiKey', keyInput.value.trim());
      keyInput.blur();
    });

    toggle.addEventListener('click', openPanel);
    panel.querySelector('#mp-close').addEventListener('click', closePanel);

    const searchEl  = panel.querySelector('#mp-search');
    const acEl      = panel.querySelector('#mp-ac');
    const clearBtn  = panel.querySelector('#mp-search-clear');

    function syncClearBtn() {
      clearBtn.classList.toggle('visible', searchEl.value.length > 0);
    }

    clearBtn.addEventListener('click', () => {
      searchEl.value = '';
      syncClearBtn();
      closeAC(acEl);
      searchEl.focus();
    });

    searchEl.addEventListener('input', () => {
      clearTimeout(acTimer);
      syncClearBtn();
      const q = searchEl.value.trim();
      if (q.length < 2) { closeAC(acEl); return; }
      acTimer = setTimeout(() => fetchAC(q, acEl), 280);
    });

    searchEl.addEventListener('keydown', e => {
      const rows = [...acEl.querySelectorAll('.mp-ac-row')];
      if (!rows.length) return;
      const fi = rows.findIndex(r => r.classList.contains('focused'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (fi >= 0) rows[fi].classList.remove('focused');
        rows[Math.min(fi + 1, rows.length - 1)].classList.add('focused');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (fi > 0) { rows[fi].classList.remove('focused'); rows[fi - 1].classList.add('focused'); }
      } else if (e.key === 'Enter' && fi >= 0) {
        e.preventDefault(); pickItem(rows[fi], acEl, searchEl);
      } else if (e.key === 'Escape') {
        closeAC(acEl);
      }
    });

    document.addEventListener('click', e => {
      if (!panel.querySelector('#mp-search-wrap').contains(e.target)) closeAC(acEl);
    });
  }

  function openPanel() {
    document.getElementById('mp-panel').classList.add('open');
    document.getElementById('mp-toggle').classList.add('open');
    document.getElementById('mp-search').focus();
  }
  function closePanel() {
    document.getElementById('mp-panel').classList.remove('open');
    document.getElementById('mp-toggle').classList.remove('open');
  }
  function closeAC(el) { el.innerHTML = ''; el.classList.remove('show'); }

  // ── Autocomplete ──────────────────────────────────────────────────────────
  async function fetchAC(q, acEl) {
    try {
      const items = await gmGet(`${IMA_URL}/api/search?q=${encodeURIComponent(q)}`);
      const list  = Array.isArray(items) ? items : [];
      if (!list.length) { closeAC(acEl); return; }
      acEl.innerHTML = list.slice(0, 14).map(it =>
        `<div class="mp-ac-row" data-id="${it.item_id}" data-name="${esc(it.name)}">
          <span>${esc(it.name)}</span>
          <span class="mp-ac-id">#${it.item_id}</span>
        </div>`
      ).join('');
      acEl.classList.add('show');
      acEl.querySelectorAll('.mp-ac-row').forEach(row =>
        row.addEventListener('mousedown', e => { e.preventDefault(); pickItem(row, acEl, document.getElementById('mp-search')); })
      );
    } catch { closeAC(acEl); }
  }

  function pickItem(row, acEl, searchEl) {
    searchEl.value = row.dataset.name;
    const cb = document.getElementById('mp-search-clear');
    if (cb) cb.classList.add('visible');
    closeAC(acEl);
    selectItem(Number(row.dataset.id), row.dataset.name);
  }

  // ── Select Item ───────────────────────────────────────────────────────────
  function selectItem(id, name) {
    currentItem = { id, name };
    document.getElementById('mp-item-tag').textContent = `${name}  #${id}`;

    if (imaChart) { imaChart.destroy(); imaChart = null; }

    const today  = todayUTC();
    imaState = { itemId: id, date: today, refPrice: null, catalogPrice: null };

    document.getElementById('mp-body').innerHTML = `
      <div id="mp-receipt-strip">
        <div class="rs-cell"><div class="rs-lbl">Receipt Price</div><div class="rs-val">—</div><div class="rs-sub">loading…</div></div>
        <div class="rs-cell"><div class="rs-lbl">Market Ref</div><div class="rs-val">—</div><div class="rs-sub">—</div></div>
        <div class="rs-cell"><div class="rs-lbl">Torn Market</div><div class="rs-val">—</div><div class="rs-sub">—</div></div>
      </div>
      <div id="mp-markets-row">
        <div class="mp-sec" id="mp-sec-torn">
          <div class="mp-sec-hdr"><span class="mp-dot green"></span>Item Market</div>
          <div class="mp-loading">Loading…</div>
        </div>
        <div class="mp-sec" id="mp-sec-weav">
          <div class="mp-sec-hdr"><span class="mp-dot yellow"></span>Bazaar</div>
          <div class="mp-loading">Loading…</div>
        </div>
      </div>
      <div class="mp-sec" id="mp-sec-ima">
        <div class="mp-sec-hdr">
          <span class="mp-dot cyan"></span>Price History (IMA)
          <div class="mp-date-nav">
            <button class="mp-nav-btn" id="mp-ima-prev">‹</button>
            <span id="mp-ima-date">${fmtDay(today)}</span>
            <button class="mp-nav-btn" id="mp-ima-next" disabled>›</button>
          </div>
        </div>
        <div id="mp-ima-content"><div class="mp-loading">Loading…</div></div>
      </div>
    `;

    document.getElementById('mp-ima-prev').addEventListener('click', () => navigateIma(-1));
    document.getElementById('mp-ima-next').addEventListener('click', () => navigateIma(1));

    // Receipt first so ref prices are ready when the chart draws
    loadReceiptThenIma(id);
    loadTornMarket(id);
    loadWeav3r(id);
  }

  async function loadReceiptThenIma(id) {
    await loadReceiptData(id);
    loadImaForDate(id);
  }

  // ── IMA date navigation ───────────────────────────────────────────────────
  function navigateIma(dir) {
    if (imaChart) { imaChart.destroy(); imaChart = null; }

    const d = new Date(imaState.date);
    d.setUTCDate(d.getUTCDate() + dir);
    imaState.date = d;

    const dateEl = document.getElementById('mp-ima-date');
    const nextBtn = document.getElementById('mp-ima-next');
    if (dateEl) dateEl.textContent = fmtDay(d);
    if (nextBtn) nextBtn.disabled = sameDay(d, todayUTC());

    const content = document.getElementById('mp-ima-content');
    if (content) content.innerHTML = '<div class="mp-loading">Loading…</div>';

    loadImaForDate(imaState.itemId);
  }

  // ── Receipt Price Strip ───────────────────────────────────────────────────
  async function loadReceiptData(itemId) {
    try {
      const d = await gmGet(
        `${APP_URL}/api/item-offering/${itemId}`,
        { 'X-Receipt-Token': RECEIPT_TOKEN }
      );
      imaState.refPrice     = d.market_reference_price ?? null;
      imaState.catalogPrice = d.catalog_price ?? null;
      renderReceiptStrip(d);
    } catch {
      const strip = document.getElementById('mp-receipt-strip');
      if (strip) strip.innerHTML = `<div class="rs-cell" style="flex:1"><span style="font-size:10px;color:#64748b">Pricing unavailable</span></div>`;
    }
  }

  function renderReceiptStrip(d) {
    const strip = document.getElementById('mp-receipt-strip');
    if (!strip) return;
    const pctStr  = d.resolved_pct != null ? Math.round(d.resolved_pct * 100) + '% mkt' : '';
    const modeStr = d.price_mode === 'fixed' ? 'fixed' : pctStr;
    strip.innerHTML = `
      <div class="rs-cell">
        <div class="rs-lbl">Receipt Price</div>
        <div class="rs-val green">${d.catalog_price != null ? fmtFull(d.catalog_price) : '—'}</div>
        <div class="rs-sub">${d.in_catalog ? modeStr : (modeStr ? modeStr + ' · not in catalog' : 'not in catalog')}</div>
      </div>
      <div class="rs-cell">
        <div class="rs-lbl">Market Ref</div>
        <div class="rs-val cyan">${d.market_reference_price != null ? fmtFull(d.market_reference_price) : '—'}</div>
        <div class="rs-sub">${d.market_reference_date ? 'ceiling ' + d.market_reference_date : 'no ceiling data'}</div>
      </div>
      <div class="rs-cell">
        <div class="rs-lbl">Torn Market</div>
        <div class="rs-val">${d.market_price != null ? fmt(d.market_price) : '—'}</div>
        <div class="rs-sub">IMA: ${d.latest_lowest_price != null ? fmt(d.latest_lowest_price) : '—'}</div>
      </div>
    `;
  }

  // ── Torn Item Market ──────────────────────────────────────────────────────
  async function loadTornMarket(itemId) {
    const sec = document.getElementById('mp-sec-torn');
    const key = GM_getValue('tornApiKey', '');
    if (!key) { replaceLoading(sec, `<div class="mp-err">No API key in footer.</div>`); return; }
    try {
      const data = await gmGet(`https://api.torn.com/v2/market/${itemId}/itemmarket?key=${key}`);
      renderTornMarket(sec, data);
    } catch (e) {
      replaceLoading(sec, `<div class="mp-err">${esc(e.message)}</div>`);
    }
  }

  function renderTornMarket(sec, data) {
    if (data.error) {
      replaceLoading(sec, `<div class="mp-err">${esc(data.error?.error ?? JSON.stringify(data.error))}</div>`);
      return;
    }
    const im       = data.itemmarket ?? {};
    const listings = im.listings ?? [];
    const total    = data._metadata?.total ?? listings.length;
    if (!listings.length) { replaceLoading(sec, `<div class="mp-loading">No listings</div>`); return; }

    const sorted    = [...listings].sort((a, b) => a.price - b.price);
    const lowestAsk = sorted[0].price;
    const totalAmt  = listings.reduce((s, l) => s + (l.amount || 0), 0);

    sec.querySelector('.mp-sec-hdr').insertAdjacentHTML('beforeend',
      `<span style="margin-left:auto;font-weight:400;font-size:9px;color:var(--mp-muted)">${total}</span>`
    );
    const rows = sorted.slice(0, 10).map((l, i) =>
      `<div class="mp-price-row ${i === 0 ? 'cheapest' : ''}">
        <span class="mp-pr-price">${fmtFull(l.price)}</span>
        <span class="mp-pr-right">×${l.amount}</span>
      </div>`
    ).join('');
    replaceLoading(sec, `
      <div class="mp-key-stat">
        <div class="mp-key-lbl">Lowest Ask</div>
        <div class="mp-key-val green">${fmtFull(lowestAsk)}</div>
        <div class="mp-key-sub">avg ${fmt(im.item?.average_price)} · ${totalAmt.toLocaleString()} units</div>
      </div>
      <div>${rows}</div>
      ${total > 10 ? `<div class="mp-more">+${total - 10} more</div>` : ''}
    `);
  }

  // ── Weav3r Bazaar ─────────────────────────────────────────────────────────
  async function loadWeav3r(itemId) {
    const sec = document.getElementById('mp-sec-weav');
    try {
      const data = await gmGet(`${WEAV3R}/api/marketplace/${itemId}?limit=100`);
      renderWeav3r(sec, data);
    } catch (e) {
      replaceLoading(sec, `<div class="mp-err">${esc(e.message)}</div>`);
    }
  }

  function renderWeav3r(sec, data) {
    const listings = data.listings ?? [];
    if (!listings.length) { replaceLoading(sec, `<div class="mp-loading">No listings</div>`); return; }

    const sorted    = [...listings].sort((a, b) => a.price - b.price);
    const lowestBaz = sorted[0].price;

    sec.querySelector('.mp-sec-hdr').insertAdjacentHTML('beforeend',
      `<span style="margin-left:auto;font-weight:400;font-size:9px;color:var(--mp-muted)">${listings.length}</span>`
    );
    const rows = sorted.slice(0, 10).map((l, i) =>
      `<div class="mp-price-row ${i === 0 ? 'cheapest-y' : ''}">
        <span class="mp-pr-price">${fmt(l.price)}</span>
        <span class="mp-pr-right">×${l.quantity} ${esc(l.player_name)}</span>
      </div>`
    ).join('');
    replaceLoading(sec, `
      <div class="mp-key-stat">
        <div class="mp-key-lbl">Lowest Offer</div>
        <div class="mp-key-val yellow">${fmtFull(lowestBaz)}</div>
        <div class="mp-key-sub">avg ${fmt(data.bazaar_average)} · ${fmtTs(data.generated_at)}</div>
      </div>
      <div>${rows}</div>
      ${listings.length > 10 ? `<div class="mp-more">+${listings.length - 10} more</div>` : ''}
    `);
  }

  // ── IMA Price History ─────────────────────────────────────────────────────
  async function loadImaForDate(itemId) {
    const d    = imaState.date;
    const from = new Date(d); // already UTC midnight
    const to   = new Date(d); to.setUTCHours(23, 59, 59, 999);

    const url = `${IMA_URL}/api/market/${itemId}` +
      `?from=${from.toISOString()}&to=${to.toISOString()}&limit=500`;

    try {
      const data = await gmGet(url);
      renderImaContent(Array.isArray(data) ? data : [], from, to);
    } catch (e) {
      const content = document.getElementById('mp-ima-content');
      if (content) content.innerHTML = `<div class="mp-err">${esc(e.message)}</div>`;
    }
  }

  function renderImaContent(records, from, to) {
    const content = document.getElementById('mp-ima-content');
    if (!content) return;

    const xMin = from.getTime();
    const xMax = to.getTime();

    if (!records.length) {
      content.innerHTML = `<div class="mp-loading">No data for this day</div>`;
      // Still draw reference lines even with no data
      if (imaState.refPrice || imaState.catalogPrice) {
        content.innerHTML += `<div class="mp-chart-wrap"><canvas id="mp-ima-chart"></canvas></div>`;
        drawChart(content, [], xMin, xMax);
      }
      return;
    }

    const prices = records.map(r => Number(r.price)).filter(p => !isNaN(p));
    const lo     = Math.min(...prices);
    const hi     = Math.max(...prices);
    const avg    = prices.length ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : null;
    const latest = records[records.length - 1];

    const legendItems = [
      `<div class="mp-legend-item"><div class="mp-legend-line" style="background:#22d3ee"></div>Price</div>`,
      `<div class="mp-legend-item"><div class="mp-legend-line" style="background:transparent;border-top:1.5px dashed rgba(148,163,184,0.55)"></div>Avg</div>`,
      imaState.refPrice     ? `<div class="mp-legend-item"><div class="mp-legend-line" style="background:transparent;border-top:1.5px dashed rgba(248,113,113,0.85)"></div>Mkt Ref</div>` : '',
      imaState.catalogPrice ? `<div class="mp-legend-item"><div class="mp-legend-line" style="background:transparent;border-top:1.5px dashed rgba(74,222,128,0.75)"></div>Receipt</div>` : '',
    ].filter(Boolean).join('');

    content.innerHTML = `
      <div class="mp-stats4">
        <div class="mp-stat4">
          <div class="mp-stat4-lbl">Latest</div>
          <div class="mp-stat4-val cyan">${fmt(latest?.price)}</div>
          <div class="mp-stat4-sub">${fmtHHMM(new Date(latest?.created_at).getTime())} TCT</div>
        </div>
        <div class="mp-stat4">
          <div class="mp-stat4-lbl">Avg (${records.length})</div>
          <div class="mp-stat4-val">${fmt(avg)}</div>
        </div>
        <div class="mp-stat4">
          <div class="mp-stat4-lbl">Low</div>
          <div class="mp-stat4-val green">${fmt(lo)}</div>
        </div>
        <div class="mp-stat4">
          <div class="mp-stat4-lbl">High</div>
          <div class="mp-stat4-val red">${fmt(hi)}</div>
        </div>
      </div>
      <div class="mp-chart-legend">${legendItems}</div>
      <div class="mp-chart-wrap"><canvas id="mp-ima-chart"></canvas></div>
    `;

    drawChart(content, records, xMin, xMax);
  }

  function drawChart(container, records, xMin, xMax) {
    setTimeout(() => {
      const canvas = container.querySelector('#mp-ima-chart');
      if (!canvas || typeof Chart === 'undefined') return;
      if (imaChart) { imaChart.destroy(); imaChart = null; }

      const points = records
        .filter(r => r.price != null && r.created_at)
        .map(r => ({ x: new Date(r.created_at).getTime(), y: Number(r.price) }))
        .filter(p => !isNaN(p.y));

      const avgPrice = points.length
        ? Math.round(points.reduce((s, p) => s + p.y, 0) / points.length)
        : null;

      const datasets = [
        {
          data: points,
          borderColor: '#22d3ee',
          backgroundColor: 'rgba(34,211,238,0.07)',
          borderWidth: 1.5,
          pointRadius: points.length > 50 ? 0 : 3,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: true,
          order: 1,
        },
      ];

      // Average price — gray dashed horizontal lane (non-interactive)
      if (avgPrice != null) {
        datasets.push({
          data: [{ x: xMin, y: avgPrice }, { x: xMax, y: avgPrice }],
          borderColor: 'rgba(148,163,184,0.55)',
          borderWidth: 1,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: false,
          tension: 0,
          order: 3,
        });
      }

      // Market reference price — red dashed horizontal lane
      if (imaState.refPrice != null) {
        datasets.push({
          data: [{ x: xMin, y: imaState.refPrice }, { x: xMax, y: imaState.refPrice }],
          borderColor: 'rgba(248,113,113,0.85)',
          borderWidth: 1.5,
          borderDash: [5, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
          order: 2,
        });
      }

      // Receipt/catalog price — green dashed horizontal lane
      if (imaState.catalogPrice != null) {
        datasets.push({
          data: [{ x: xMin, y: imaState.catalogPrice }, { x: xMax, y: imaState.catalogPrice }],
          borderColor: 'rgba(74,222,128,0.75)',
          borderWidth: 1.5,
          borderDash: [5, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
          order: 2,
        });
      }

      imaChart = new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              filter: item => item.datasetIndex === 0,
              callbacks: {
                title: ctx => fmtHHMM(ctx[0].parsed.x) + ' TCT',
                label: ctx => fmtFull(ctx.parsed.y),
              },
            },
          },
          scales: {
            x: {
              type: 'linear',
              min: xMin,
              max: xMax,
              ticks: {
                color: '#64748b', maxTicksLimit: 6, font: { size: 9 },
                callback: v => fmtHHMM(v),
              },
              grid: { color: 'rgba(255,255,255,0.04)' },
            },
            y: {
              ticks: {
                color: '#64748b', maxTicksLimit: 5, font: { size: 9 },
                callback: v => fmt(v),
              },
              grid: { color: 'rgba(255,255,255,0.04)' },
            },
          },
        },
      });
    }, 40);
  }

  // ── Util ──────────────────────────────────────────────────────────────────
  function replaceLoading(sec, html) {
    const el = sec.querySelector('.mp-loading');
    if (el) el.outerHTML = html;
    else sec.querySelector('.mp-sec-hdr').insertAdjacentHTML('afterend', html);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    buildUI();
  }
})();
