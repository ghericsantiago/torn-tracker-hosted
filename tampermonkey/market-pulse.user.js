// ==UserScript==
// @name         Torn Market Pulse
// @namespace    torn-market-pulse
// @version      1.2.0
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
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d.getDate()} ${mo[d.getMonth()]}`;
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

    /* ── Toggle ── */
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

    /* ── Panel ── */
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

    /* ── Header ── */
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

    /* ── Search ── */
    #mp-search-wrap {
      padding: 11px 14px; border-bottom: 1px solid var(--mp-border);
      flex-shrink: 0; position: relative;
    }
    #mp-search {
      width: 100%; box-sizing: border-box;
      background: rgba(255,255,255,0.06); border: 1px solid rgba(74,222,128,0.25);
      border-radius: 8px; padding: 8px 12px; color: #e2e8f0;
      font-size: 13px; outline: none; transition: border-color var(--mp-tr);
    }
    #mp-search:focus { border-color: rgba(74,222,128,0.5); }
    #mp-search::placeholder { color: var(--mp-muted); }
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

    /* ── Body ── */
    #mp-body { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
    #mp-empty { text-align: center; color: var(--mp-muted); padding: 60px 0; font-size: 12px; line-height: 2.2; }

    /* ── Receipt Strip ── */
    #mp-receipt-strip {
      display: flex; gap: 1px; background: var(--mp-border);
      border: 1px solid rgba(74,222,128,0.18); border-radius: 10px; overflow: hidden;
    }
    .rs-cell {
      flex: 1; background: var(--mp-bg); padding: 9px 12px;
      display: flex; flex-direction: column; gap: 2px;
    }
    .rs-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--mp-muted); }
    .rs-val { font-size: 14px; font-weight: 700; font-family: var(--mp-mono); color: #e2e8f0; }
    .rs-val.green  { color: #4ade80; }
    .rs-val.cyan   { color: #22d3ee; }
    .rs-sub { font-size: 9px; color: var(--mp-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* ── Markets Row (side-by-side) ── */
    #mp-markets-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

    /* ── Section Cards ── */
    .mp-sec { background: var(--mp-card); border: 1px solid var(--mp-border); border-radius: 10px; overflow: hidden; min-width: 0; }
    .mp-sec-hdr {
      padding: 7px 10px; border-bottom: 1px solid var(--mp-border);
      font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--mp-muted);
      display: flex; align-items: center; gap: 6px;
    }
    .mp-sec-hdr .mp-sub { margin-left: auto; font-weight: 400; font-size: 9px; }
    .mp-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
    .mp-dot.green  { background: #4ade80; }
    .mp-dot.yellow { background: #fbbf24; }
    .mp-dot.cyan   { background: #22d3ee; }

    /* Compact key-stat inside narrow card */
    .mp-key-stat {
      padding: 7px 10px; border-bottom: 1px solid var(--mp-border);
      display: flex; flex-direction: column; gap: 1px;
    }
    .mp-key-lbl { font-size: 8px; text-transform: uppercase; color: var(--mp-muted); letter-spacing: 0.06em; }
    .mp-key-val { font-size: 14px; font-weight: 700; font-family: var(--mp-mono); }
    .mp-key-val.green  { color: #4ade80; }
    .mp-key-val.yellow { color: #fbbf24; }
    .mp-key-sub { font-size: 9px; color: var(--mp-muted); }

    /* Price list rows */
    .mp-price-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 5px 10px; border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .mp-price-row:last-child { border-bottom: none; }
    .mp-price-row.cheapest  .mp-pr-price { color: #4ade80; font-weight: 700; }
    .mp-price-row.cheapest-y .mp-pr-price { color: #fbbf24; font-weight: 700; }
    .mp-pr-price { font-family: var(--mp-mono); font-size: 11px; }
    .mp-pr-right { font-size: 10px; color: var(--mp-dim); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 55%; }
    .mp-more { padding: 5px 10px; font-size: 9px; color: var(--mp-muted); border-top: 1px solid rgba(255,255,255,0.03); }

    /* Full-width stats for IMA section */
    .mp-stats4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 1px; background: var(--mp-border); }
    .mp-stat4 { background: var(--mp-bg); padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
    .mp-stat4-lbl { font-size: 8px; text-transform: uppercase; color: var(--mp-muted); letter-spacing: 0.06em; }
    .mp-stat4-val { font-size: 12px; font-weight: 700; font-family: var(--mp-mono); color: #e2e8f0; }
    .mp-stat4-val.green { color: #4ade80; }
    .mp-stat4-val.cyan  { color: #22d3ee; }
    .mp-stat4-val.red   { color: #f87171; }
    .mp-stat4-sub { font-size: 8px; color: var(--mp-muted); }

    /* Chart */
    .mp-chart-wrap { position: relative; height: 190px; padding: 10px 10px 6px; }

    /* Loading / error */
    .mp-loading { padding: 16px 10px; text-align: center; color: var(--mp-muted); font-size: 11px; }
    .mp-err     { padding: 10px; color: #f87171; font-size: 10px; word-break: break-word; }

    /* ── Footer ── */
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
        <button class="mp-icon-btn" id="mp-close" title="Close">✕</button>
      </div>
      <div id="mp-search-wrap">
        <input id="mp-search" placeholder="Search item name…" autocomplete="off" spellcheck="false" />
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

    const searchEl = panel.querySelector('#mp-search');
    const acEl     = panel.querySelector('#mp-ac');

    searchEl.addEventListener('input', () => {
      clearTimeout(acTimer);
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
  function closeAC(acEl) { acEl.innerHTML = ''; acEl.classList.remove('show'); }

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
    closeAC(acEl);
    selectItem(Number(row.dataset.id), row.dataset.name);
  }

  // ── Select Item ───────────────────────────────────────────────────────────
  function selectItem(id, name) {
    currentItem = { id, name };
    document.getElementById('mp-item-tag').textContent = `${name}  #${id}`;

    if (imaChart) { imaChart.destroy(); imaChart = null; }

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
        <div class="mp-sec-hdr"><span class="mp-dot cyan"></span>Price History (IMA)</div>
        <div class="mp-loading">Loading…</div>
      </div>
    `;

    loadReceiptData(id);
    loadTornMarket(id);
    loadWeav3r(id);
    loadImaHistory(id);
  }

  // ── Receipt Price Strip ───────────────────────────────────────────────────
  async function loadReceiptData(itemId) {
    try {
      const d = await gmGet(
        `${APP_URL}/api/item-offering/${itemId}`,
        { 'X-Receipt-Token': RECEIPT_TOKEN }
      );
      renderReceiptStrip(d);
    } catch {
      const strip = document.getElementById('mp-receipt-strip');
      if (strip) strip.innerHTML = `<div class="rs-cell" style="flex:1"><span style="font-size:10px;color:#64748b">Our pricing unavailable</span></div>`;
    }
  }

  function renderReceiptStrip(d) {
    const strip = document.getElementById('mp-receipt-strip');
    if (!strip) return;

    const pctStr = d.resolved_pct != null ? Math.round(d.resolved_pct * 100) + '% mkt' : '';
    const modeStr = d.price_mode === 'fixed' ? 'fixed' : pctStr;

    strip.innerHTML = `
      <div class="rs-cell">
        <div class="rs-lbl">Receipt Price</div>
        <div class="rs-val green">${d.catalog_price != null ? fmtFull(d.catalog_price) : '—'}</div>
        <div class="rs-sub">${d.in_catalog ? modeStr : modeStr + ' · not in catalog'}</div>
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
    const avgPrice = im.item?.average_price;

    if (!listings.length) {
      replaceLoading(sec, `<div class="mp-loading">No listings</div>`);
      return;
    }

    const sorted   = [...listings].sort((a, b) => a.price - b.price);
    const lowestAsk = sorted[0].price;
    const totalAmt  = listings.reduce((s, l) => s + (l.amount || 0), 0);

    // Update header subtitle
    sec.querySelector('.mp-sec-hdr').insertAdjacentHTML('beforeend',
      `<span class="mp-sub" style="color:var(--mp-muted)">${total} listings</span>`
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
        <div class="mp-key-sub">avg ${fmt(avgPrice)} · ${totalAmt.toLocaleString()} units</div>
      </div>
      <div class="mp-price-list">${rows}</div>
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
    if (!listings.length) {
      replaceLoading(sec, `<div class="mp-loading">No listings</div>`);
      return;
    }

    const sorted    = [...listings].sort((a, b) => a.price - b.price);
    const lowestBaz = sorted[0].price;
    const genAt     = fmtTs(data.generated_at);

    sec.querySelector('.mp-sec-hdr').insertAdjacentHTML('beforeend',
      `<span class="mp-sub" style="color:var(--mp-muted)">${listings.length} sellers</span>`
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
        <div class="mp-key-sub">avg ${fmt(data.bazaar_average)} · ${genAt}</div>
      </div>
      <div class="mp-price-list">${rows}</div>
      ${listings.length > 10 ? `<div class="mp-more">+${listings.length - 10} more</div>` : ''}
    `);
  }

  // ── IMA Price History Chart ───────────────────────────────────────────────
  async function loadImaHistory(itemId) {
    const sec = document.getElementById('mp-sec-ima');
    try {
      const data = await gmGet(`${IMA_URL}/api/market/${itemId}?limit=200`);
      renderImaHistory(sec, data);
    } catch (e) {
      replaceLoading(sec, `<div class="mp-err">${esc(e.message)}</div>`);
    }
  }

  function renderImaHistory(sec, data) {
    const records = Array.isArray(data) ? data : [];
    if (!records.length) {
      replaceLoading(sec, `<div class="mp-loading">No price history tracked</div>`);
      return;
    }

    const prices  = records.map(r => r.price).filter(p => p != null);
    const lo      = Math.min(...prices);
    const hi      = Math.max(...prices);
    const avg     = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
    const latest  = records[records.length - 1];

    // Use ms timestamps for x-axis (no adapter required)
    const points = records
      .filter(r => r.price != null && r.created_at)
      .map(r => ({ x: new Date(r.created_at).getTime(), y: r.price }));

    replaceLoading(sec, `
      <div class="mp-stats4">
        <div class="mp-stat4">
          <div class="mp-stat4-lbl">Latest</div>
          <div class="mp-stat4-val cyan">${fmt(latest?.price)}</div>
          <div class="mp-stat4-sub">${fmtDate(latest?.created_at)}</div>
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
      <div class="mp-chart-wrap">
        <canvas id="mp-ima-chart"></canvas>
      </div>
    `);

    // Small delay so canvas is laid out before Chart.js reads dimensions
    setTimeout(() => {
      const canvas = sec.querySelector('#mp-ima-chart');
      if (!canvas || typeof Chart === 'undefined') return;
      if (imaChart) { imaChart.destroy(); imaChart = null; }

      imaChart = new Chart(canvas, {
        type: 'line',
        data: {
          datasets: [{
            data: points,
            borderColor: '#22d3ee',
            backgroundColor: 'rgba(34,211,238,0.07)',
            borderWidth: 1.5,
            pointRadius: points.length > 60 ? 0 : 2,
            pointHoverRadius: 4,
            tension: 0.3,
            fill: true,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: ctx => fmtIso(new Date(ctx[0].parsed.x).toISOString()),
                label: ctx => fmtFull(ctx.parsed.y),
              },
            },
          },
          scales: {
            x: {
              type: 'linear',
              ticks: {
                color: '#64748b', maxTicksLimit: 5, font: { size: 9 },
                callback: v => fmtDate(new Date(v).toISOString()),
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
    }, 30);
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
