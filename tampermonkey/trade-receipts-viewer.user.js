// ==UserScript==
// @name         Torn Tracker — Trade Receipts Viewer
// @namespace    torn-tracker-receipts-viewer
// @version      1.0.0
// @description  Browse trade receipts in a side drawer on any Torn page
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @connect      itrade.devs.surf
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const APP_URL       = 'https://itrade.devs.surf';
  const RECEIPT_TOKEN = '926cc7e6-5092-40cc-ba8a-a3f9b8070a6c';
  const PAGE_SIZE     = 15;

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function fmt(n) { return n == null ? '—' : '$' + Number(n).toLocaleString(); }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
           ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function gmGet(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url,
        headers: { 'X-Receipt-Token': RECEIPT_TOKEN },
        onload: r => { try { resolve(JSON.parse(r.responseText)); } catch(e) { reject(new Error('Bad response')); } },
        onerror: () => reject(new Error('Network error')),
      });
    });
  }

  // ── Styles ───────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    :root { --trv-accent:#a78bfa; --trv-bg:#0d1020; --trv-card:rgba(255,255,255,0.04); --trv-border:rgba(255,255,255,0.08); --trv-mono:'JetBrains Mono',monospace; --trv-tr:0.18s ease; }
    #trv-toggle {
      position:fixed; right:0; top:75%; transform:translateY(-50%);
      background:rgba(167,139,250,0.1); border:1px solid rgba(167,139,250,0.28);
      border-right:none; color:var(--trv-accent);
      width:18px; padding:12px 0; border-radius:6px 0 0 6px;
      cursor:pointer; z-index:2147483638; writing-mode:vertical-rl;
      font:700 8px/1 var(--trv-mono); letter-spacing:2px;
      backdrop-filter:blur(12px); transition:background var(--trv-tr),opacity 0.2s;
      padding-right:8px; user-select:none;
    }
    #trv-toggle:hover { background:rgba(167,139,250,0.18); }
    #trv-toggle.open  { opacity:0; pointer-events:none; }
    #trv-panel {
      position:fixed; top:0; right:-680px; width:min(660px,100vw);
      height:100dvh; background:rgba(7,8,15,0.97); backdrop-filter:blur(24px);
      -webkit-backdrop-filter:blur(24px); z-index:2147483643;
      border-left:1px solid var(--trv-border);
      box-shadow:-12px 0 60px rgba(0,0,0,0.8);
      transition:right 0.32s cubic-bezier(.4,0,.2,1);
      display:flex; flex-direction:column; overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
      color:#dde2e8;
    }
    #trv-panel.open { right:0; }
    .trv-header {
      display:flex; align-items:center; gap:10px;
      padding:14px 16px; border-bottom:1px solid var(--trv-border);
      flex-shrink:0; background:rgba(167,139,250,0.04);
    }
    .trv-header h2 { font-size:14px; font-weight:700; color:#e2e8f0; margin:0; flex:1; }
    .trv-icon-btn {
      background:none; border:1px solid var(--trv-border); color:#64748b;
      width:26px; height:26px; border-radius:6px; cursor:pointer; font-size:14px;
      display:flex; align-items:center; justify-content:center; flex-shrink:0;
      transition:color var(--trv-tr),border-color var(--trv-tr);
    }
    .trv-icon-btn:hover { color:#e2e8f0; border-color:rgba(255,255,255,0.2); }
    .trv-search {
      padding:10px 14px; border-bottom:1px solid var(--trv-border); flex-shrink:0;
      display:flex; gap:8px;
    }
    .trv-search input {
      flex:1; background:rgba(255,255,255,0.05); border:1px solid var(--trv-border);
      border-radius:7px; padding:7px 11px; color:#dde2e8; font-size:12px; outline:none;
    }
    .trv-filter-btn {
      background:none; border:1px solid var(--trv-border); color:#64748b;
      padding:6px 10px; border-radius:7px; cursor:pointer; font-size:11px;
      transition:all var(--trv-tr); white-space:nowrap;
    }
    .trv-filter-btn.active { background:rgba(167,139,250,0.15); border-color:rgba(167,139,250,0.4); color:var(--trv-accent); }
    .trv-body { flex:1; overflow-y:auto; padding:8px; }
    .trv-receipt-card {
      background:var(--trv-card); border:1px solid var(--trv-border); border-radius:10px;
      padding:12px 14px; margin-bottom:6px; cursor:pointer;
      transition:background var(--trv-tr),border-color var(--trv-tr);
      display:flex; align-items:center; gap:12px;
    }
    .trv-receipt-card:hover { background:rgba(167,139,250,0.08); border-color:rgba(167,139,250,0.25); }
    .trv-receipt-card .trv-card-main { flex:1; min-width:0; }
    .trv-receipt-card .trv-card-id { font-size:10px; font-family:var(--trv-mono); color:#64748b; }
    .trv-receipt-card .trv-card-parties { font-size:13px; font-weight:600; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .trv-receipt-card .trv-card-date { font-size:10px; color:#4a5568; margin-top:2px; }
    .trv-receipt-card .trv-card-total { font-family:var(--trv-mono); font-size:13px; font-weight:700; color:var(--trv-accent); flex-shrink:0; text-align:right; }
    .trv-status { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:20px; font-size:10px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; flex-shrink:0; }
    .trv-status.pending   { background:rgba(251,191,36,0.12); color:#fbbf24; }
    .trv-status.completed { background:rgba(52,211,153,0.12); color:#34d399; }
    .trv-status.cancelled { background:rgba(248,113,113,0.12); color:#f87171; }
    .trv-pagination { display:flex; align-items:center; justify-content:center; gap:8px; padding:10px; border-top:1px solid var(--trv-border); flex-shrink:0; }
    .trv-page-btn { background:rgba(255,255,255,0.04); border:1px solid var(--trv-border); color:#94a3b8; padding:5px 12px; border-radius:6px; cursor:pointer; font-size:12px; }
    .trv-page-btn:disabled { opacity:0.35; cursor:not-allowed; }
    .trv-page-btn:not(:disabled):hover { background:rgba(167,139,250,0.1); color:var(--trv-accent); border-color:rgba(167,139,250,0.3); }
    .trv-page-info { font-size:11px; color:#4a5568; font-family:var(--trv-mono); }
    /* Detail view */
    .trv-detail-header { display:flex; align-items:center; gap:8px; padding:14px 16px; border-bottom:1px solid var(--trv-border); flex-shrink:0; }
    .trv-detail-meta { flex:1; }
    .trv-detail-meta .trv-trade-id { font-size:11px; font-family:var(--trv-mono); color:#64748b; }
    .trv-detail-meta .trv-parties { font-size:14px; font-weight:700; color:#e2e8f0; }
    .trv-detail-meta .trv-date { font-size:11px; color:#4a5568; margin-top:2px; }
    .trv-items-table { width:100%; border-collapse:collapse; font-size:12px; }
    .trv-items-table th { padding:8px 10px; text-align:left; font-size:10px; font-family:var(--trv-mono); color:#64748b; text-transform:uppercase; letter-spacing:.07em; border-bottom:1px solid var(--trv-border); white-space:nowrap; }
    .trv-items-table th.r { text-align:right; }
    .trv-items-table td { padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.04); vertical-align:middle; }
    .trv-items-table td.r { text-align:right; font-family:var(--trv-mono); }
    .trv-items-table tr:hover td { background:rgba(255,255,255,0.02); }
    .trv-item-name { font-size:12px; color:#e2e8f0; }
    .trv-item-sub { font-size:10px; color:#4a5568; margin-top:1px; }
    .trv-total-row td { font-family:var(--trv-mono); font-weight:700; color:var(--trv-accent); font-size:14px; padding:10px; border-top:1px solid var(--trv-border) !important; border-bottom:none; }
    .trv-pct-badge { font-size:9px; font-family:var(--trv-mono); background:rgba(110,231,247,0.1); color:#6ee7f7; border:1px solid rgba(110,231,247,0.25); border-radius:4px; padding:1px 4px; margin-left:4px; }
    .trv-unlisted { font-size:9px; font-family:var(--trv-mono); background:rgba(251,191,36,0.12); color:#f59e0b; border:1px solid rgba(251,191,36,0.25); border-radius:4px; padding:1px 4px; margin-left:4px; }
    .trv-empty { text-align:center; padding:40px 16px; color:#4a5568; font-size:13px; }
    .trv-loading { text-align:center; padding:32px; color:#4a5568; font-size:12px; font-family:var(--trv-mono); }
    .trv-open-link { font-size:10px; color:rgba(167,139,250,0.7); text-decoration:none; font-family:var(--trv-mono); }
    .trv-open-link:hover { color:var(--trv-accent); }
  `;
  document.head.appendChild(style);

  // ── State ────────────────────────────────────────────────────────────────────
  let currentPage = 1;
  let totalReceipts = 0;
  let statusFilter = '';
  let searchQuery = '';
  let searchTimer = null;

  // ── Build DOM ─────────────────────────────────────────────────────────────────
  const toggle = document.createElement('button');
  toggle.id = 'trv-toggle';
  toggle.textContent = 'RCPTS';

  const panel = document.createElement('div');
  panel.id = 'trv-panel';
  panel.innerHTML = `
    <div class="trv-header">
      <h2>Trade Receipts</h2>
      <a id="trv-open-site" href="${APP_URL}/receipt" target="_blank" class="trv-open-link">Open site ↗</a>
      <button class="trv-icon-btn" id="trv-refresh" title="Refresh">↻</button>
      <button class="trv-icon-btn" id="trv-close">×</button>
    </div>
    <div class="trv-search">
      <input id="trv-search-input" placeholder="Search by trader name or trade ID…" type="text">
      <button class="trv-filter-btn" data-status="">All</button>
      <button class="trv-filter-btn" data-status="pending">Pending</button>
      <button class="trv-filter-btn" data-status="completed">Done</button>
    </div>
    <div class="trv-body" id="trv-body"><div class="trv-loading">Loading…</div></div>
    <div class="trv-pagination" id="trv-pagination" style="display:none">
      <button class="trv-page-btn" id="trv-prev">‹ Prev</button>
      <span class="trv-page-info" id="trv-page-info"></span>
      <button class="trv-page-btn" id="trv-next">Next ›</button>
    </div>
  `;
  document.body.appendChild(toggle);
  document.body.appendChild(panel);

  // ── Open / Close ──────────────────────────────────────────────────────────────
  function openPanel() {
    toggle.classList.add('open');
    panel.classList.add('open');
    loadList();
  }
  function closePanel() {
    toggle.classList.remove('open');
    panel.classList.remove('open');
  }
  toggle.addEventListener('click', openPanel);
  panel.querySelector('#trv-close').addEventListener('click', closePanel);
  panel.querySelector('#trv-refresh').addEventListener('click', () => {
    currentPage = 1;
    loadList();
  });

  // ── Filters ───────────────────────────────────────────────────────────────────
  panel.querySelectorAll('.trv-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.trv-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      statusFilter = btn.dataset.status;
      currentPage = 1;
      loadList();
    });
  });
  panel.querySelector('[data-status=""]').classList.add('active');

  panel.querySelector('#trv-search-input').addEventListener('input', e => {
    searchQuery = e.target.value.trim().toLowerCase();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentPage = 1; loadList(); }, 350);
  });

  // ── Pagination ────────────────────────────────────────────────────────────────
  panel.querySelector('#trv-prev').addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadList(); } });
  panel.querySelector('#trv-next').addEventListener('click', () => { if (currentPage * PAGE_SIZE < totalReceipts) { currentPage++; loadList(); } });

  // ── Status helpers ────────────────────────────────────────────────────────────
  function statusBadge(s) {
    const labels = { pending:'In Progress', completed:'Completed', cancelled:'Cancelled' };
    return `<span class="trv-status ${s || 'pending'}">${labels[s] || s || 'Pending'}</span>`;
  }

  // ── Load list ─────────────────────────────────────────────────────────────────
  async function loadList() {
    const body = panel.querySelector('#trv-body');
    const pag  = panel.querySelector('#trv-pagination');
    body.innerHTML = '<div class="trv-loading">Loading…</div>';
    pag.style.display = 'none';

    try {
      const params = new URLSearchParams({ page: currentPage, limit: PAGE_SIZE });
      if (statusFilter) params.set('status', statusFilter);
      const data = await gmGet(`${APP_URL}/api/receipts?${params}`);
      if (data.error) { body.innerHTML = `<div class="trv-empty">⚠ ${esc(data.error)}</div>`; return; }

      let receipts = data.receipts || [];
      totalReceipts = data.total || 0;

      // Client-side search filter (trade ID or trader name)
      if (searchQuery) {
        receipts = receipts.filter(r =>
          String(r.trade_id).includes(searchQuery) ||
          (r.buyer_name || '').toLowerCase().includes(searchQuery) ||
          (r.seller_name || '').toLowerCase().includes(searchQuery)
        );
      }

      if (!receipts.length) {
        body.innerHTML = '<div class="trv-empty">No receipts found</div>';
        return;
      }

      body.innerHTML = receipts.map(r => `
        <div class="trv-receipt-card" data-id="${esc(r.short_id || r.id)}">
          <div class="trv-card-main">
            <div class="trv-card-id">#${r.trade_id} · ${fmtDate(r.created_at)}</div>
            <div class="trv-card-parties">${esc(r.buyer_name || '—')} → ${esc(r.seller_name || '—')}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            ${statusBadge(r.status)}
            <span class="trv-card-total">${fmt(r.total_value)}</span>
          </div>
        </div>
      `).join('');

      body.querySelectorAll('.trv-receipt-card').forEach(card => {
        card.addEventListener('click', () => loadDetail(card.dataset.id));
      });

      // Pagination
      const totalPages = Math.ceil(totalReceipts / PAGE_SIZE);
      if (totalPages > 1) {
        pag.style.display = 'flex';
        panel.querySelector('#trv-prev').disabled = currentPage <= 1;
        panel.querySelector('#trv-next').disabled = currentPage >= totalPages;
        panel.querySelector('#trv-page-info').textContent = `${currentPage} / ${totalPages}`;
      }
    } catch (e) {
      body.innerHTML = `<div class="trv-empty">⚠ ${esc(e.message)}</div>`;
    }
  }

  // ── Load receipt detail ───────────────────────────────────────────────────────
  async function loadDetail(id) {
    const body = panel.querySelector('#trv-body');
    const pag  = panel.querySelector('#trv-pagination');
    pag.style.display = 'none';
    body.innerHTML = '<div class="trv-loading">Loading receipt…</div>';

    try {
      const r = await gmGet(`${APP_URL}/api/receipt/${id}`);
      if (r.error) { body.innerHTML = `<div class="trv-empty">⚠ ${esc(r.error)}</div>`; return; }

      const items = Array.isArray(r.items) ? r.items : [];

      const itemRows = items.map(item => {
        const pctBadge = item.in_catalog && item.price_mode === 'market_pct' && item.resolved_pct != null
          ? `<span class="trv-pct-badge">${(Number(item.resolved_pct)*100).toFixed(0)}%</span>` : '';
        const unlistedBadge = !item.in_catalog ? '<span class="trv-unlisted">UNLISTED</span>' : '';
        return `<tr>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <img src="https://www.torn.com/images/items/${item.torn_item_id}/large.png"
                   style="width:24px;height:24px;object-fit:contain;border-radius:3px;flex-shrink:0"
                   onerror="this.style.display='none'">
              <div>
                <div class="trv-item-name">${esc(item.item_name)}${unlistedBadge}</div>
                ${item.item_type ? `<div class="trv-item-sub">${esc(item.item_type)}</div>` : ''}
              </div>
            </div>
          </td>
          <td class="r">${item.quantity}</td>
          <td class="r" style="color:#64748b">${fmt(item.market_price)}</td>
          <td class="r">${fmt(item.effective_price)}${pctBadge}</td>
          <td class="r" style="color:var(--trv-accent)">${fmt(item.effective_total ?? (item.effective_price * item.quantity))}</td>
        </tr>`;
      }).join('');

      body.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--trv-border);flex-shrink:0">
          <button class="trv-icon-btn" id="trv-back" title="Back to list">←</button>
          <div style="flex:1">
            <div style="font-size:10px;font-family:var(--trv-mono);color:#64748b">
              Trade #${r.trade_id} · ${fmtDate(r.created_at)}
            </div>
            <div style="font-size:14px;font-weight:700;color:#e2e8f0">
              ${esc(r.buyer_name || '—')} → ${esc(r.seller_name || '—')}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            ${statusBadge(r.status)}
            <a href="${APP_URL}/receipt/${esc(r.short_id || r.id)}" target="_blank" class="trv-open-link">Open ↗</a>
          </div>
        </div>
        <div style="flex:1;overflow-y:auto;padding:8px">
          <table class="trv-items-table">
            <thead>
              <tr>
                <th>Item</th>
                <th class="r">Qty</th>
                <th class="r">Market</th>
                <th class="r">Offer</th>
                <th class="r">Line Total</th>
              </tr>
            </thead>
            <tbody>${itemRows || '<tr><td colspan="5" style="text-align:center;color:#4a5568;padding:20px">No items</td></tr>'}</tbody>
            <tfoot>
              <tr class="trv-total-row">
                <td colspan="4" style="text-align:right;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.08em">Total</td>
                <td class="r">${fmt(r.total_value)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;

      body.querySelector('#trv-back').addEventListener('click', () => {
        loadList();
      });
    } catch (e) {
      body.innerHTML = `<div class="trv-empty">⚠ ${esc(e.message)}</div>`;
    }
  }
})();
