// ==UserScript==
// @name         Torn Market Pulse
// @namespace    torn-market-pulse
// @version      1.0.0
// @description  Quick market research drawer — Item Market, Bazaar & IMA price history
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.torn.com
// @connect      weav3r.dev
// @connect      torn-imarket-tracker.gvsantiago.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const IMA_URL = 'https://torn-imarket-tracker.gvsantiago.com';
  const WEAV3R  = 'https://weav3r.dev';

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fmt(n) {
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
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }
  function gmGet(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, timeout: 12000,
        onload:    r => { try { resolve(JSON.parse(r.responseText)); } catch { reject(new Error('Parse error')); } },
        onerror:   () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let panelOpen   = false;
  let currentItem = null;
  let acTimer     = null;

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

    /* Header */
    #mp-hdr {
      padding: 14px 16px 12px; border-bottom: 1px solid var(--mp-border);
      background: rgba(74,222,128,0.03); flex-shrink: 0;
      display: flex; align-items: center; gap: 10px;
    }
    #mp-hdr h2 { margin: 0; font-size: 13px; font-weight: 700; color: #e2e8f0; flex: 1; }
    #mp-item-tag {
      font-size: 10px; color: var(--mp-accent);
      font-family: var(--mp-mono); margin-left: 6px; font-weight: 400;
    }
    .mp-icon-btn {
      background: none; border: 1px solid var(--mp-border); color: var(--mp-muted);
      width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 13px;
      display: flex; align-items: center; justify-content: center;
      transition: color var(--mp-tr), border-color var(--mp-tr);
    }
    .mp-icon-btn:hover { color: #e2e8f0; border-color: rgba(255,255,255,0.18); }

    /* Search */
    #mp-search-wrap {
      padding: 12px 16px; border-bottom: 1px solid var(--mp-border);
      flex-shrink: 0; position: relative;
    }
    #mp-search {
      width: 100%; box-sizing: border-box;
      background: rgba(255,255,255,0.06); border: 1px solid rgba(74,222,128,0.25);
      border-radius: 8px; padding: 9px 12px; color: #e2e8f0;
      font-size: 13px; outline: none; transition: border-color var(--mp-tr);
    }
    #mp-search:focus { border-color: rgba(74,222,128,0.5); }
    #mp-search::placeholder { color: var(--mp-muted); }

    #mp-ac {
      position: absolute; top: calc(100% - 2px); left: 16px; right: 16px;
      background: #0d1020; border: 1px solid rgba(74,222,128,0.25);
      border-top: none; border-radius: 0 0 8px 8px;
      z-index: 10; max-height: 200px; overflow-y: auto; display: none;
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

    /* Body */
    #mp-body { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }

    #mp-empty { text-align: center; color: var(--mp-muted); padding: 60px 0; font-size: 12px; line-height: 2; }

    /* Section cards */
    .mp-sec {
      background: var(--mp-card); border: 1px solid var(--mp-border);
      border-radius: 10px; overflow: hidden;
    }
    .mp-sec-hdr {
      padding: 9px 14px; border-bottom: 1px solid var(--mp-border);
      font-size: 9px; font-weight: 700; letter-spacing: 0.09em;
      text-transform: uppercase; color: var(--mp-muted);
      display: flex; align-items: center; gap: 7px;
    }
    .mp-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .mp-dot.green  { background: #4ade80; }
    .mp-dot.yellow { background: #fbbf24; }
    .mp-dot.cyan   { background: #22d3ee; }

    /* Stat grid */
    .mp-stats {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 1px; background: var(--mp-border);
    }
    .mp-stat { background: var(--mp-bg); padding: 10px 14px; display: flex; flex-direction: column; gap: 2px; }
    .mp-stat.full { grid-column: 1 / -1; }
    .mp-stat-lbl { font-size: 9px; color: var(--mp-muted); text-transform: uppercase; letter-spacing: 0.06em; }
    .mp-stat-val {
      font-size: 15px; font-weight: 700; color: #e2e8f0;
      font-family: var(--mp-mono);
    }
    .mp-stat-val.green  { color: #4ade80; }
    .mp-stat-val.yellow { color: #fbbf24; }
    .mp-stat-val.cyan   { color: #22d3ee; }
    .mp-stat-val.red    { color: #f87171; }
    .mp-stat-sub { font-size: 9px; color: var(--mp-muted); }

    /* Tables */
    .mp-tbl { width: 100%; border-collapse: collapse; }
    .mp-tbl thead tr { border-bottom: 1px solid var(--mp-border); }
    .mp-tbl th {
      padding: 6px 14px; text-align: left;
      font-size: 9px; font-weight: 600; color: var(--mp-muted);
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .mp-tbl td {
      padding: 7px 14px; font-size: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .mp-tbl tr:last-child td { border-bottom: none; }
    .mp-tbl tr.mp-best td:last-child { color: #4ade80; font-weight: 600; }
    .mp-tbl tr.mp-best-y td:last-child { color: #fbbf24; font-weight: 600; }
    .mp-tbl .mp-num { text-align: right; font-family: var(--mp-mono); font-size: 11px; }
    .mp-tbl .mp-dim { color: var(--mp-dim); font-size: 11px; }
    .mp-more { padding: 6px 14px; font-size: 10px; color: var(--mp-muted); border-top: 1px solid rgba(255,255,255,0.03); }

    /* Loading / error */
    .mp-loading { padding: 20px 14px; text-align: center; color: var(--mp-muted); font-size: 12px; }
    .mp-err     { padding: 12px 14px; color: #f87171; font-size: 11px; }

    /* API key footer */
    #mp-footer {
      padding: 10px 14px; border-top: 1px solid var(--mp-border);
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
      transition: background var(--mp-tr);
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

    // API key
    const keyInput = panel.querySelector('#mp-key-input');
    keyInput.value = GM_getValue('tornApiKey', '');
    panel.querySelector('#mp-key-save').addEventListener('click', () => {
      GM_setValue('tornApiKey', keyInput.value.trim());
      keyInput.blur();
    });

    // Toggle / close
    toggle.addEventListener('click', () => openPanel());
    panel.querySelector('#mp-close').addEventListener('click', () => closePanel());

    // Autocomplete
    const searchEl = panel.querySelector('#mp-search');
    const acEl     = panel.querySelector('#mp-ac');

    searchEl.addEventListener('input', () => {
      clearTimeout(acTimer);
      const q = searchEl.value.trim();
      if (q.length < 2) { closeAC(acEl); return; }
      acTimer = setTimeout(() => fetchAC(q, acEl), 280);
    });

    searchEl.addEventListener('keydown', e => {
      const rows = acEl.querySelectorAll('.mp-ac-row');
      if (!rows.length) return;
      const focused = acEl.querySelector('.mp-ac-row.focused');
      const idx = focused ? [...rows].indexOf(focused) : -1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        rows[Math.min(idx + 1, rows.length - 1)]?.classList.add('focused');
        if (idx >= 0) rows[idx].classList.remove('focused');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (idx > 0) { rows[idx].classList.remove('focused'); rows[idx - 1].classList.add('focused'); }
      } else if (e.key === 'Enter' && focused) {
        e.preventDefault();
        pickItem(focused, acEl, searchEl);
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
    panelOpen = true;
    document.getElementById('mp-search').focus();
  }
  function closePanel() {
    document.getElementById('mp-panel').classList.remove('open');
    document.getElementById('mp-toggle').classList.remove('open');
    panelOpen = false;
  }
  function closeAC(acEl) {
    acEl.innerHTML = '';
    acEl.classList.remove('show');
  }

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

      acEl.querySelectorAll('.mp-ac-row').forEach(row => {
        row.addEventListener('mousedown', e => {
          e.preventDefault();
          pickItem(row, acEl, document.getElementById('mp-search'));
        });
      });
    } catch {
      closeAC(acEl);
    }
  }

  function pickItem(row, acEl, searchEl) {
    const id   = Number(row.dataset.id);
    const name = row.dataset.name;
    searchEl.value = name;
    closeAC(acEl);
    selectItem(id, name);
  }

  // ── Load item data ────────────────────────────────────────────────────────
  function selectItem(id, name) {
    currentItem = { id, name };
    document.getElementById('mp-item-tag').textContent = ` — ${name} #${id}`;

    const body = document.getElementById('mp-body');
    body.innerHTML = `
      <div class="mp-sec" id="mp-sec-torn">
        <div class="mp-sec-hdr"><span class="mp-dot green"></span>Item Market (Torn API)</div>
        <div class="mp-loading">Loading…</div>
      </div>
      <div class="mp-sec" id="mp-sec-weav">
        <div class="mp-sec-hdr"><span class="mp-dot yellow"></span>Bazaar Offers (Weav3r)</div>
        <div class="mp-loading">Loading…</div>
      </div>
      <div class="mp-sec" id="mp-sec-ima">
        <div class="mp-sec-hdr"><span class="mp-dot cyan"></span>Price History (IMA)</div>
        <div class="mp-loading">Loading…</div>
      </div>
    `;

    loadTornMarket(id);
    loadWeav3r(id);
    loadImaHistory(id);
  }

  // ── Torn Item Market (v2 API) ─────────────────────────────────────────────
  async function loadTornMarket(itemId) {
    const sec = document.getElementById('mp-sec-torn');
    const key = GM_getValue('tornApiKey', '');
    if (!key) {
      setSecContent(sec, `<div class="mp-err">No API key set — enter it in the footer below.</div>`);
      return;
    }
    try {
      const data = await gmGet(`https://api.torn.com/v2/market/${itemId}/itemmarket?key=${key}`);
      renderTornMarket(sec, data);
    } catch (e) {
      setSecContent(sec, `<div class="mp-err">Failed: ${esc(e.message)}</div>`);
    }
  }

  function renderTornMarket(sec, data) {
    if (data.error) {
      setSecContent(sec, `<div class="mp-err">Torn API error: ${esc(data.error.error || JSON.stringify(data.error))}</div>`);
      return;
    }
    const listings = data.itemmarket || [];
    if (!listings.length) {
      setSecContent(sec, `<div class="mp-loading">No active Item Market listings</div>`);
      return;
    }

    const sorted   = [...listings].sort((a, b) => a.price - b.price);
    const lowestAsk = sorted[0].price;
    const totalQty  = listings.reduce((s, l) => s + (l.quantity || 1), 0);

    const rows = sorted.slice(0, 10).map((l, i) =>
      `<tr class="${i === 0 ? 'mp-best' : ''}">
        <td class="mp-dim">×${l.quantity || 1}</td>
        <td class="mp-num">${fmt(l.price)}</td>
      </tr>`
    ).join('');
    const more = listings.length > 10
      ? `<div class="mp-more">+ ${listings.length - 10} more listings</div>`
      : '';

    setSecContent(sec, `
      <div class="mp-stats">
        <div class="mp-stat">
          <div class="mp-stat-lbl">Lowest Ask</div>
          <div class="mp-stat-val green">${fmt(lowestAsk)}</div>
        </div>
        <div class="mp-stat">
          <div class="mp-stat-lbl">Listings / Total Qty</div>
          <div class="mp-stat-val">${listings.length} / ${totalQty}</div>
        </div>
      </div>
      <table class="mp-tbl">
        <thead><tr><th>Qty</th><th style="text-align:right">Price</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${more}
    `);
  }

  // ── Weav3r Bazaar ─────────────────────────────────────────────────────────
  async function loadWeav3r(itemId) {
    const sec = document.getElementById('mp-sec-weav');
    try {
      const data = await gmGet(`${WEAV3R}/api/marketplace/${itemId}?limit=100`);
      renderWeav3r(sec, data);
    } catch (e) {
      setSecContent(sec, `<div class="mp-err">Failed: ${esc(e.message)}</div>`);
    }
  }

  function renderWeav3r(sec, data) {
    const listings = data.listings || [];
    if (!listings.length) {
      setSecContent(sec, `<div class="mp-loading">No bazaar listings found</div>`);
      return;
    }

    const sorted    = [...listings].sort((a, b) => a.price - b.price);
    const lowestBaz = sorted[0].price;
    const genAt     = fmtTs(data.generated_at);

    const rows = sorted.slice(0, 10).map((l, i) =>
      `<tr class="${i === 0 ? 'mp-best-y' : ''}">
        <td class="mp-dim">${esc(l.player_name)}</td>
        <td class="mp-dim">×${l.quantity}</td>
        <td class="mp-num">${fmt(l.price)}</td>
      </tr>`
    ).join('');
    const more = listings.length > 10
      ? `<div class="mp-more">+ ${listings.length - 10} more listings</div>`
      : '';

    setSecContent(sec, `
      <div class="mp-stats">
        <div class="mp-stat">
          <div class="mp-stat-lbl">Lowest Offer</div>
          <div class="mp-stat-val yellow">${fmt(lowestBaz)}</div>
        </div>
        <div class="mp-stat">
          <div class="mp-stat-lbl">Bazaar Average</div>
          <div class="mp-stat-val">${fmt(data.bazaar_average)}</div>
        </div>
        <div class="mp-stat">
          <div class="mp-stat-lbl">Torn Market Ref</div>
          <div class="mp-stat-val">${fmt(data.market_price)}</div>
        </div>
        <div class="mp-stat">
          <div class="mp-stat-lbl">Sellers</div>
          <div class="mp-stat-val">${listings.length}</div>
          <div class="mp-stat-sub">Snapshot ${genAt}</div>
        </div>
      </div>
      <table class="mp-tbl">
        <thead><tr><th>Seller</th><th>Qty</th><th style="text-align:right">Price</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${more}
    `);
  }

  // ── IMA Price History ─────────────────────────────────────────────────────
  async function loadImaHistory(itemId) {
    const sec = document.getElementById('mp-sec-ima');
    try {
      const data = await gmGet(`${IMA_URL}/api/market/${itemId}?limit=50`);
      renderImaHistory(sec, data);
    } catch (e) {
      setSecContent(sec, `<div class="mp-err">Failed: ${esc(e.message)}</div>`);
    }
  }

  function renderImaHistory(sec, data) {
    const records = Array.isArray(data) ? data : [];
    if (!records.length) {
      setSecContent(sec, `<div class="mp-loading">No price history tracked for this item</div>`);
      return;
    }

    const prices  = records.map(r => r.price).filter(p => p != null);
    const lo      = Math.min(...prices);
    const hi      = Math.max(...prices);
    const avg     = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
    const latest  = records[records.length - 1];

    const recentRows = records.slice(-10).reverse().map(r =>
      `<tr>
        <td class="mp-dim">${fmtIso(r.created_at)}</td>
        <td class="mp-num">${fmt(r.price)}</td>
      </tr>`
    ).join('');

    setSecContent(sec, `
      <div class="mp-stats">
        <div class="mp-stat">
          <div class="mp-stat-lbl">Latest</div>
          <div class="mp-stat-val cyan">${fmt(latest?.price)}</div>
          <div class="mp-stat-sub">${fmtIso(latest?.created_at)}</div>
        </div>
        <div class="mp-stat">
          <div class="mp-stat-lbl">Avg (${records.length} pts)</div>
          <div class="mp-stat-val">${fmt(avg)}</div>
        </div>
        <div class="mp-stat">
          <div class="mp-stat-lbl">All-time Low</div>
          <div class="mp-stat-val green">${fmt(lo)}</div>
        </div>
        <div class="mp-stat">
          <div class="mp-stat-lbl">All-time High</div>
          <div class="mp-stat-val red">${fmt(hi)}</div>
        </div>
      </div>
      <table class="mp-tbl">
        <thead><tr><th>Recorded</th><th style="text-align:right">Price</th></tr></thead>
        <tbody>${recentRows}</tbody>
      </table>
      ${records.length > 10 ? `<div class="mp-more">Showing last 10 of ${records.length} records</div>` : ''}
    `);
  }

  // ── Util ──────────────────────────────────────────────────────────────────
  function setSecContent(sec, html) {
    const loading = sec.querySelector('.mp-loading');
    if (loading) loading.outerHTML = html;
    else {
      const hdr = sec.querySelector('.mp-sec-hdr');
      hdr.insertAdjacentHTML('afterend', html);
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    buildUI();
  }
})();
