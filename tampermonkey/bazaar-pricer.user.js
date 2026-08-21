// ==UserScript==
// @name         Torn Bazaar Pricer
// @namespace    https://itrade.devs.surf
// @version      3.2
// @description  Price chart button on Torn bazaar manage and add-item pages
// @match        https://www.torn.com/bazaar.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js
// ==/UserScript==

(function () {
  'use strict';

  const API_BASE = 'https://itrade.devs.surf';
  const RECENTLY_PRICED_MS = 30 * 60 * 1000;

  // ── Settings ──────────────────────────────────────────────────────────────
  const settings = {
    deductType:   GM_getValue('bp_deductType',   'fixed'),
    deductAmount: GM_getValue('bp_deductAmount', 0),
  };

  function saveSettings() {
    GM_setValue('bp_deductType',   settings.deductType);
    GM_setValue('bp_deductAmount', settings.deductAmount);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fmtPrice(n) {
    return '$' + Math.round(n).toLocaleString();
  }

  function computePrice(lowest, type, amount) {
    if (lowest == null) return null;
    if (type === 'pct') return Math.max(0, Math.floor(lowest * (1 - amount / 100)));
    return Math.max(0, lowest - Math.floor(amount));
  }

  function isAddPage() { return location.hash.startsWith('#/add'); }

  function fetchJSON(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: r => {
          try { resolve(JSON.parse(r.responseText)); }
          catch (e) { reject(e); }
        },
        onerror: reject,
      });
    });
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  GM_addStyle(`
    .bp-chart-btn {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 2px 7px; margin-left: 6px; min-width: 34px;
      background: rgba(110,231,247,0.12); border: 1px solid rgba(110,231,247,0.3);
      border-radius: 4px; color: #6ee7f7; font-size: 12px; cursor: pointer;
      line-height: 1.4; vertical-align: middle; transition: background 0.15s;
    }
    .bp-chart-btn:hover { background: rgba(110,231,247,0.28); }
    .bp-chart-btn.bp-chart-btn-mobile {
      width: 30px; min-width: 30px; height: 28px; padding: 0; margin-left: 0;
      font-size: 13px; flex: 0 0 30px;
    }
    .bp-filter-shifted { transform: translateY(var(--bp-filter-offset, 0)); }

    #bp-overlay {
      display: none; position: fixed; inset: 0; z-index: 999999;
      background: rgba(0,0,0,0.7); align-items: center; justify-content: center;
    }
    #bp-overlay.open { display: flex; }

    #bp-modal {
      background: #12141f; border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px; width: 540px; max-width: 95vw;
      box-shadow: 0 8px 40px rgba(0,0,0,0.8);
      font-family: Arial, sans-serif; font-size: 13px; color: #e2e8f0;
      overflow: hidden;
    }
    #bp-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
    }
    #bp-item-name { font-weight: 700; font-size: 14px; color: #6ee7f7; }
    #bp-close-btn {
      background: none; border: none; color: #94a3b8;
      cursor: pointer; font-size: 20px; line-height: 1; padding: 0 4px;
    }
    #bp-close-btn:hover { color: #e2e8f0; }

    #bp-chart-wrap {
      padding: 12px 16px 4px; position: relative; height: 240px;
    }
    #bp-canvas { display: block; }
    #bp-overlay-msg {
      display: none; position: absolute; inset: 0;
      align-items: center; justify-content: center;
      color: #64748b; font-size: 13px; pointer-events: none;
    }
    #bp-overlay-msg.show { display: flex; }

    #bp-selected-row {
      padding: 6px 16px; font-size: 12px; color: #64748b; min-height: 26px;
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    }
    #bp-selected-row b { color: #6ee7f7; }
    #bp-apply-inp {
      width: 110px; padding: 2px 7px; border-radius: 4px;
      border: 1px solid rgba(110,231,247,0.35);
      background: rgba(110,231,247,0.08); color: #6ee7f7;
      font-size: 12px; font-weight: 700;
    }
    #bp-apply-inp:focus { outline: none; border-color: rgba(110,231,247,0.65); }

    #bp-footer {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 10px 16px 14px; border-top: 1px solid rgba(255,255,255,0.08);
    }
    .bp-lbl { font-size: 11px; color: #64748b; white-space: nowrap; }
    .bp-type-btn {
      padding: 3px 10px; border-radius: 4px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.05); color: #94a3b8;
      cursor: pointer; font-size: 12px; transition: all 0.12s;
    }
    .bp-type-btn.active {
      background: rgba(110,231,247,0.15);
      border-color: rgba(110,231,247,0.4); color: #6ee7f7;
    }
    #bp-deduct-inp {
      width: 72px; padding: 3px 7px; border-radius: 4px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.05); color: #e2e8f0; font-size: 12px;
    }
    #bp-apply-btn {
      margin-left: auto; padding: 5px 14px; border-radius: 6px;
      background: rgba(110,231,247,0.15); border: 1px solid rgba(110,231,247,0.35);
      color: #6ee7f7; cursor: pointer; font-size: 12px; font-weight: 700;
      transition: background 0.15s;
    }
    #bp-apply-btn:hover:not(:disabled) { background: rgba(110,231,247,0.3); }
    #bp-apply-btn:disabled { opacity: 0.38; cursor: default; }

    #bp-date-nav {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding: 6px 16px 0;
    }
    #bp-prev-day, #bp-next-day {
      background: none; border: 1px solid rgba(255,255,255,0.12);
      border-radius: 4px; color: #94a3b8; cursor: pointer;
      padding: 1px 9px; font-size: 15px; line-height: 1.4;
      transition: all 0.12s;
    }
    #bp-prev-day:hover, #bp-next-day:hover { color: #e2e8f0; background: rgba(255,255,255,0.06); }
    #bp-date-label { color: #94a3b8; font-size: 11px; min-width: 72px; text-align: center; }

    #bp-filter-wrap { display: inline-flex; align-items: center; gap: 6px; margin: 6px 0 2px; }
    #bp-filter-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 12px; border-radius: 5px;
      background: rgba(110,231,247,0.07); border: 1px solid rgba(110,231,247,0.2);
      color: #6ee7f7; font-size: 11px; font-family: Arial, sans-serif;
      cursor: pointer; transition: all 0.12s; user-select: none;
    }
    #bp-filter-btn:hover { background: rgba(110,231,247,0.15); }
    #bp-filter-btn.active { background: rgba(110,231,247,0.18); border-color: rgba(110,231,247,0.45); }
    #bp-filter-btn:disabled { opacity: 0.35; cursor: default; }
    #bp-filter-count {
      background: rgba(110,231,247,0.2); border-radius: 10px;
      padding: 0 6px; font-size: 10px; font-weight: 700;
    }
    #bp-reset-btn {
      padding: 4px 9px; border-radius: 5px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
      color: #94a3b8; font-size: 11px; font-family: Arial, sans-serif;
      cursor: pointer; transition: all 0.12s; user-select: none;
    }
    #bp-reset-btn:hover { background: rgba(248,113,113,0.12); border-color: rgba(248,113,113,0.3); color: #f87171; }

    #bp-add-filter-wrap {
      display: inline-flex; align-items: center; gap: 6px;
      margin: 6px 4px 4px; vertical-align: middle;
    }
    .bp-filter-btn-add {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 5px;
      background: rgba(110,231,247,0.07); border: 1px solid rgba(110,231,247,0.2);
      color: #6ee7f7; font-size: 11px; font-family: Arial, sans-serif;
      cursor: pointer; transition: all 0.12s; user-select: none;
    }
    .bp-filter-btn-add:hover { background: rgba(110,231,247,0.15); }
    .bp-filter-btn-add.active { background: rgba(110,231,247,0.18); border-color: rgba(110,231,247,0.45); }
    .bp-filter-btn-add:disabled { opacity: 0.35; cursor: default; }
    .bp-filter-count { background: rgba(110,231,247,0.2); border-radius: 10px; padding: 0 6px; font-size: 10px; font-weight: 700; }
    .bp-reset-btn-add {
      padding: 4px 9px; border-radius: 5px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
      color: #94a3b8; font-size: 11px; font-family: Arial, sans-serif;
      cursor: pointer; transition: all 0.12s; user-select: none;
    }
    .bp-reset-btn-add:hover { background: rgba(248,113,113,0.12); border-color: rgba(248,113,113,0.3); color: #f87171; }

    /* Add page: align chart button inline with the price input */
    li.clearfix[data-group] div.price {
      display: flex !important; align-items: center; gap: 4px;
    }
    li.clearfix[data-group] div.price .input-money-group { flex: 1; }
    li.clearfix[data-group] div.price .bp-chart-btn { margin-left: 0; flex-shrink: 0; }
    li.clearfix[data-group] .name-wrap.bp-add-name-with-chart {
      display: flex !important; align-items: center; gap: 4px; min-width: 0;
    }
    li.clearfix[data-group] .name-wrap.bp-add-name-with-chart .t-overflow {
      display: block; flex: 1 1 auto; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    li.clearfix[data-group] .name-wrap .bp-chart-btn.bp-add-name-chart {
      width: 30px; min-width: 30px; height: 24px; padding: 0; margin: 0 2px 0 0;
      flex: 0 0 30px;
    }
  `);

  // ── Modal DOM (created once) ───────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'bp-overlay';
  overlay.innerHTML = `
    <div id="bp-modal" role="dialog" aria-modal="true">
      <div id="bp-header">
        <span id="bp-item-name">—</span>
        <button id="bp-close-btn" title="Close (Esc)">×</button>
      </div>
      <div id="bp-date-nav">
        <button id="bp-prev-day" title="Previous day">‹</button>
        <span id="bp-date-label"></span>
        <button id="bp-next-day" title="Next day">›</button>
      </div>
      <div id="bp-chart-wrap">
        <canvas id="bp-canvas" height="215"></canvas>
        <div id="bp-overlay-msg">Loading…</div>
      </div>
      <div id="bp-selected-row">
        <span id="bp-sel-hint">Click a point on the chart to select a price</span>
        <span id="bp-sel-detail" style="display:none">
          Selected: <b id="bp-sel-price"></b>&ensp;→&ensp;Apply:
          <input id="bp-apply-inp" type="number" min="0" step="1">
        </span>
      </div>
      <div id="bp-footer">
        <span class="bp-lbl">Deduct:</span>
        <button class="bp-type-btn" id="bp-type-fixed">Fixed</button>
        <button class="bp-type-btn" id="bp-type-pct">%</button>
        <input id="bp-deduct-inp" type="number" min="0" step="1" placeholder="0">
        <button id="bp-apply-btn" disabled>Apply to bazaar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const elItemName  = overlay.querySelector('#bp-item-name');
  const elCloseBtn  = overlay.querySelector('#bp-close-btn');
  const elCanvas    = overlay.querySelector('#bp-canvas');
  const elOvMsg     = overlay.querySelector('#bp-overlay-msg');
  const elSelHint   = overlay.querySelector('#bp-sel-hint');
  const elSelDetail = overlay.querySelector('#bp-sel-detail');
  const elSelPrice  = overlay.querySelector('#bp-sel-price');
  const elApplyInp  = overlay.querySelector('#bp-apply-inp');
  const elTypeFixed = overlay.querySelector('#bp-type-fixed');
  const elTypePct   = overlay.querySelector('#bp-type-pct');
  const elDeductInp = overlay.querySelector('#bp-deduct-inp');
  const elApplyBtn  = overlay.querySelector('#bp-apply-btn');
  const elPrevDay   = overlay.querySelector('#bp-prev-day');
  const elNextDay   = overlay.querySelector('#bp-next-day');
  const elDateLabel = overlay.querySelector('#bp-date-label');

  // ── State ─────────────────────────────────────────────────────────────────
  let chartInstance  = null;
  let currentRow     = null;
  let currentItemId  = null;
  let selectedPrice  = null;
  let loadToken      = 0;
  let viewDate       = null;
  let bazaarList     = null;
  let listObserver   = null;
  let addObserver    = null;
  let addFilterBtn   = null;
  let addFilterActive = false;
  const pricedItems  = loadPricedItems();
  let filterActive   = false;
  let filterBtn      = null;

  function loadPricedItems() {
    let saved;
    try {
      saved = JSON.parse(GM_getValue('bp_priced', '{}'));
    } catch (_e) {
      saved = {};
    }

    // Migrate the old array-of-ids format by treating those entries as newly priced.
    if (Array.isArray(saved)) {
      const now = Date.now();
      saved = Object.fromEntries(saved.map(id => [String(id), now]));
      GM_setValue('bp_priced', JSON.stringify(saved));
    }

    const entries = Object.entries(saved || {}).filter(([, timestamp]) =>
      Number.isFinite(Number(timestamp)) && Date.now() - Number(timestamp) < RECENTLY_PRICED_MS
    );
    const result = new Map(entries.map(([id, timestamp]) => [id, Number(timestamp)]));
    GM_setValue('bp_priced', JSON.stringify(Object.fromEntries(result)));
    return result;
  }

  function savePricedItems() {
    GM_setValue('bp_priced', JSON.stringify(Object.fromEntries(pricedItems)));
  }

  function pruneExpiredPricedItems() {
    const cutoff = Date.now() - RECENTLY_PRICED_MS;
    let changed = false;
    for (const [id, timestamp] of pricedItems) {
      if (timestamp <= cutoff) {
        pricedItems.delete(id);
        changed = true;
      }
    }
    if (changed) savePricedItems();
    return changed;
  }

  // ── Settings init ─────────────────────────────────────────────────────────
  elDeductInp.value = settings.deductAmount;
  refreshTypeButtons();

  function refreshTypeButtons() {
    elTypeFixed.classList.toggle('active', settings.deductType === 'fixed');
    elTypePct.classList.toggle('active',   settings.deductType === 'pct');
  }

  elTypeFixed.addEventListener('click', () => {
    settings.deductType = 'fixed'; saveSettings(); refreshTypeButtons(); refreshSelected();
  });
  elTypePct.addEventListener('click', () => {
    settings.deductType = 'pct'; saveSettings(); refreshTypeButtons(); refreshSelected();
  });
  elDeductInp.addEventListener('input', () => {
    settings.deductAmount = parseFloat(elDeductInp.value) || 0;
    saveSettings(); refreshSelected();
  });

  // ── Close ─────────────────────────────────────────────────────────────────
  function closeModal() {
    overlay.classList.remove('open');
    currentRow    = null;
    selectedPrice = null;
    loadToken++;
  }

  function resetSelectedUI() {
    elSelHint.style.display   = '';
    elSelDetail.style.display = 'none';
    elApplyBtn.disabled       = true;
  }

  elCloseBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // ── Selected price display ────────────────────────────────────────────────
  function refreshSelected() {
    if (selectedPrice == null) {
      resetSelectedUI();
      return;
    }
    const applied = computePrice(selectedPrice, settings.deductType, settings.deductAmount);
    elSelPrice.textContent    = fmtPrice(selectedPrice);
    elApplyInp.value          = Math.round(applied);
    elSelHint.style.display   = 'none';
    elSelDetail.style.display = '';
    elApplyBtn.disabled       = false;
  }

  // ── Chart (single instance, data replaced) ────────────────────────────────
  function initChart() {
    chartInstance = new window.Chart(elCanvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Lowest Offer',
            data: [],
            borderColor: '#6ee7f7',
            backgroundColor: 'rgba(110,231,247,0.07)',
            pointRadius: 4,
            pointHoverRadius: 8,
            pointBackgroundColor: '#6ee7f7',
            borderWidth: 2,
            tension: 0.25,
            fill: true,
            order: 1,
          },
          {
            label: 'Market Value',
            data: [],
            borderColor: 'rgba(148,163,184,0.45)',
            borderDash: [5, 4],
            pointRadius: 0,
            pointHoverRadius: 0,
            borderWidth: 1.5,
            tension: 0.25,
            fill: false,
            order: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: '#64748b', font: { size: 10 }, boxWidth: 16, padding: 10 },
          },
          tooltip: {
            callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtPrice(ctx.parsed.y)}` },
          },
        },
        scales: {
          x: {
            ticks: { color: '#64748b', font: { size: 10 }, maxRotation: 0, maxTicksLimit: 12 },
            grid:  { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            ticks: {
              color: '#94a3b8', font: { size: 10 },
              callback: v => '$' + Math.round(v).toLocaleString(),
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
        onClick: (_evt, elements) => {
          // only respond to clicks on dataset 0 (Lowest Offer has visible points)
          const hit = elements.find(e => e.datasetIndex === 0);
          if (!hit) return;
          selectedPrice = chartInstance.data.datasets[0].data[hit.index];
          refreshSelected();
        },
      },
    });
  }

  function loadChart(labels, lowestOffers, marketValues) {
    if (!chartInstance) initChart();
    chartInstance.data.labels             = labels;
    chartInstance.data.datasets[0].data   = lowestOffers;
    chartInstance.data.datasets[1].data   = marketValues;
    chartInstance.update('none');
  }

  // ── Date nav helpers ──────────────────────────────────────────────────────
  function utcMidnightToday() {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  }

  function isToday(d) {
    const t = utcMidnightToday();
    return d.getTime() === t.getTime();
  }

  function updateDateNav() {
    elDateLabel.textContent = viewDate.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
    elNextDay.style.display = isToday(viewDate) ? 'none' : '';
  }

  // ── Fetch + render chart for currentItemId / viewDate ─────────────────────
  async function fetchChartData(token) {
    selectedPrice = null;
    elOvMsg.textContent = 'Loading…';
    elOvMsg.classList.add('show');

    const start = new Date(viewDate);
    const end   = new Date(start.getTime() + 86400000 - 1);
    const toISO = d => d.toISOString();

    try {
      const raw = await fetchJSON(
        `${API_BASE}/api/market/${currentItemId}?from=${toISO(start)}&to=${toISO(end)}&limit=5000`
      );
      if (token !== loadToken) return;

      // Bin to 5-minute buckets
      const buckets = new Map();
      for (const r of (Array.isArray(raw) ? raw : [])) {
        const t    = new Date(r.created_at);
        const mins = t.getUTCHours() * 60 + t.getUTCMinutes();
        const key  = String(Math.floor(mins / 5) * 5).padStart(4, '0');
        const hh   = String(Math.floor(Math.floor(mins / 5) * 5 / 60)).padStart(2, '0');
        const mm   = String((Math.floor(mins / 5) * 5) % 60).padStart(2, '0');
        if (!buckets.has(key)) buckets.set(key, { label: `${hh}:${mm}`, lo: [], mkt: [] });
        const b = buckets.get(key);
        if (r.price         != null) b.lo.push(Number(r.price));
        if (r.average_price != null) b.mkt.push(Number(r.average_price));
      }

      const labels = [], lowestOffers = [], marketValues = [];
      for (const [, b] of [...buckets.entries()].sort(([a], [z]) => a - z)) {
        labels.push(b.label);
        lowestOffers.push(b.lo.length  ? Math.min(...b.lo)  : null);
        marketValues.push(b.mkt.length ? b.mkt[b.mkt.length - 1] : null);
      }

      elOvMsg.classList.remove('show');

      if (!lowestOffers.length) {
        if (chartInstance) {
          chartInstance.data.labels = [];
          chartInstance.data.datasets[0].data = [];
          chartInstance.data.datasets[1].data = [];
          chartInstance.update('none');
        }
        elOvMsg.textContent = 'No price data for this day';
        elOvMsg.classList.add('show');
        return;
      }

      loadChart(labels, lowestOffers, marketValues);
    } catch (_e) {
      if (token !== loadToken) return;
      elOvMsg.textContent = 'Failed to load price data';
    }
  }

  // ── Prev / Next day ───────────────────────────────────────────────────────
  elPrevDay.addEventListener('click', () => {
    selectedPrice = null;
    viewDate = new Date(viewDate.getTime() - 86400000);
    updateDateNav();
    fetchChartData(++loadToken);
  });

  elNextDay.addEventListener('click', () => {
    if (isToday(viewDate)) return;
    selectedPrice = null;
    viewDate = new Date(viewDate.getTime() + 86400000);
    updateDateNav();
    fetchChartData(++loadToken);
  });

  // ── Open modal ────────────────────────────────────────────────────────────
  function getCurrentPrice(row) {
    // Manage page: React hidden input
    const hidden = row.querySelector('.price___WxxqO input[type="hidden"]');
    if (hidden) {
      const val = parseInt(hidden.value, 10);
      return isNaN(val) || val <= 0 ? null : val;
    }
    // Add page: tornInputMoney text input (value is raw number, no commas)
    const moneyInp = row.querySelector('div.price input.input-money');
    if (moneyInp) {
      const val = parseInt(moneyInp.value.replace(/,/g, ''), 10);
      return isNaN(val) || val <= 0 ? null : val;
    }
    return null;
  }

  function openModal(row) {
    currentRow    = row;
    currentItemId = row.dataset.bpId;
    selectedPrice = null;
    viewDate      = utcMidnightToday();

    elItemName.textContent = row.dataset.bpName || `Item #${currentItemId}`;

    // Pre-fill with the item's current bazaar price so Apply works immediately
    const curPrice = getCurrentPrice(row);
    if (curPrice != null) {
      elSelPrice.textContent    = 'Current';
      elApplyInp.value          = curPrice;
      elSelHint.style.display   = 'none';
      elSelDetail.style.display = '';
      elApplyBtn.disabled       = false;
    } else {
      resetSelectedUI();
    }

    overlay.classList.add('open');
    updateDateNav();
    fetchChartData(++loadToken);
  }

  function findManageMoneyInputs(row) {
    const wrap = row.querySelector('.price___WxxqO');
    if (wrap) return [...wrap.querySelectorAll('input')];
    // Mobile creates the same money-input pair only after Manage is expanded,
    // but does not retain the desktop price-cell wrapper.
    return [...row.querySelectorAll('input[data-testid="legacy-money-input"], input.input-money[data-money]')];
  }

  async function ensureMobilePriceInputs(row) {
    if (findManageMoneyInputs(row).length) return row;
    const manageBtn = row.querySelector('.mobileContainer___IP3uc button[aria-label="Manage"]');
    if (!manageBtn) return row;
    manageBtn.click();

    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      // React may replace the row while opening the mobile editor.
      if (!document.contains(row) && bazaarList) {
        row = [...bazaarList.querySelectorAll('[data-testid="sortable-item"]')]
          .find(candidate => candidate.dataset.bpId === currentItemId) || row;
      }
      if (findManageMoneyInputs(row).length) return row;
    }
    return row;
  }

  async function closeMobilePricePanel(row, itemId) {
    if (!row.querySelector('.mobileContainer___IP3uc')) return;

    // Let React finish processing the price change before checking whether its
    // mobile editor survived the render.
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!document.contains(row) && bazaarList) {
      row = [...bazaarList.querySelectorAll('[data-testid="sortable-item"]')]
        .find(candidate => candidate.dataset.bpId === itemId) || row;
    }
    if (!document.contains(row)) return;

    if (findManageMoneyInputs(row).length) {
      row.querySelector('.mobileContainer___IP3uc button[aria-label="Manage"]')?.click();
    }
  }

  // ── Apply price: handles both manage page (React inputs) and add page (tornInputMoney)
  function applyPriceToRow(row, applied) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    if (row.tagName === 'LI') {
      // Add page: price — plain text input managed by tornInputMoney jQuery plugin
      const inp = row.querySelector('div.price input.input-money');
      if (inp) {
        setter.call(inp, String(applied));
        inp.dispatchEvent(new Event('input',  { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        if (window.jQuery) window.jQuery(inp).trigger('change').trigger('input');
      }
      // Add page: qty — fill with the max available count from inventory
      const qty = row.dataset.bpQty;
      if (qty) {
        const qtyInp = row.querySelector('div.amount input[name="amount"]');
        if (qtyInp) {
          setter.call(qtyInp, qty);
          qtyInp.dispatchEvent(new Event('input',  { bubbles: true }));
          qtyInp.dispatchEvent(new Event('change', { bubbles: true }));
          if (window.jQuery) window.jQuery(qtyInp).trigger('change').trigger('input');
        }
      }
      return !!inp;
    } else {
      // Manage page: React hidden + visible inputs
      const inputs = findManageMoneyInputs(row);
      const hidden  = inputs.find(input => input.type === 'hidden');
      const visible = inputs.find(input => input.type !== 'hidden');
      if (hidden) {
        setter.call(hidden, String(applied));
        hidden.dispatchEvent(new Event('input',  { bubbles: true }));
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (visible) {
        setter.call(visible, String(applied));
        visible.dispatchEvent(new Event('input',  { bubbles: true }));
        visible.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return !!(hidden || visible);
    }
  }

  // ── Apply button ──────────────────────────────────────────────────────────
  elApplyBtn.addEventListener('click', async () => {
    if (!currentRow) return;

    const applied = parseInt(elApplyInp.value, 10);
    if (isNaN(applied) || applied < 0) return;

    if (!document.contains(currentRow)) {
      elSelHint.textContent   = 'Scroll item into view first, then try again';
      elSelHint.style.color   = '#f87171';
      elSelHint.style.display = '';
      elSelDetail.style.display = 'none';
      return;
    }

    elApplyBtn.disabled = true;
    elApplyBtn.textContent = 'Applying…';
    currentRow = await ensureMobilePriceInputs(currentRow);
    const appliedToTorn = applyPriceToRow(currentRow, applied);
    elApplyBtn.textContent = 'Apply to bazaar';
    if (!appliedToTorn) {
      elSelHint.textContent = 'Could not open Torn’s mobile price input. Tap Manage, then try again.';
      elSelHint.style.color = '#f87171';
      elSelHint.style.display = '';
      elSelDetail.style.display = 'none';
      elApplyBtn.disabled = false;
      return;
    }

    pricedItems.set(currentItemId, Date.now());
    savePricedItems();
    updateFilterBtn();
    updateAddFilterBtn();
    const chartBtn = currentRow.querySelector('.bp-chart-btn');
    if (chartBtn) chartBtn.textContent = '✓';
    if (isAddPage()) applyAddFilter();
    else applyFilterToRow(currentRow);

    const populatedRow = currentRow;
    const populatedItemId = currentItemId;
    closeModal();
    closeMobilePricePanel(populatedRow, populatedItemId);
  });

  // ── Priced-item filter ────────────────────────────────────────────────────
  function updateFilterBtn() {
    if (!filterBtn) return;
    pruneExpiredPricedItems();
    const n = pricedItems.size;
    if (n === 0) filterActive = false;
    filterBtn.disabled = n === 0;
    filterBtn.classList.toggle('active', filterActive);
    filterBtn.querySelector('#bp-filter-count').textContent = n;
    filterBtn.title = filterActive ? 'Click to show all items' : 'Hide items priced in the last 30 minutes';
  }

  function applyFilterToRow(row) {
    if (filterActive) {
      requestAnimationFrame(applyFilter);
      return;
    }
    row.style.display = '';
    row.classList.remove('bp-filter-shifted');
    row.style.removeProperty('--bp-filter-offset');
  }

  function applyFilter() {
    if (!bazaarList) return;
    const rows = [...bazaarList.querySelectorAll('div.row___mbuuh[data-testid="sortable-item"]')];
    const rowHeight = rows.find(row => row.style.display !== 'none')?.offsetHeight || 36;
    let hiddenBefore = 0;

    rows.forEach(row => {
      const hidden = filterActive && pricedItems.has(row.dataset.bpId);
      row.style.display = hidden ? 'none' : '';

      if (!hidden && hiddenBefore > 0) {
        row.style.setProperty('--bp-filter-offset', `${-hiddenBefore * rowHeight}px`);
        row.classList.add('bp-filter-shifted');
      } else {
        row.classList.remove('bp-filter-shifted');
        row.style.removeProperty('--bp-filter-offset');
      }

      if (hidden) hiddenBefore++;
    });
  }

  function injectFilterBtn(list) {
    if (document.getElementById('bp-filter-btn')) return;

    const wrap = document.createElement('div');
    wrap.id = 'bp-filter-wrap';

    filterBtn = document.createElement('button');
    filterBtn.id   = 'bp-filter-btn';
    filterBtn.type = 'button';
    filterBtn.innerHTML = `Hide recent <span id="bp-filter-count">0</span>`;
    filterBtn.disabled  = true;
    filterBtn.addEventListener('click', () => {
      if (pricedItems.size === 0) return;
      filterActive = !filterActive;
      updateFilterBtn();
      applyFilter();
    });

    const resetBtn = document.createElement('button');
    resetBtn.id        = 'bp-reset-btn';
    resetBtn.type      = 'button';
    resetBtn.textContent = 'Reset';
    resetBtn.title     = 'Clear all priced items';
    resetBtn.addEventListener('click', () => {
      pricedItems.clear();
      savePricedItems();
      filterActive = false;
      updateFilterBtn();
      applyFilter();
      if (bazaarList) bazaarList.querySelectorAll('.bp-chart-btn').forEach(b => { b.textContent = '📈'; });
    });

    wrap.appendChild(filterBtn);
    wrap.appendChild(resetBtn);
    list.insertAdjacentElement('beforebegin', wrap);
    updateFilterBtn();
  }

  function refreshExpiredPricedItems() {
    if (!pruneExpiredPricedItems()) return;
    updateFilterBtn();
    updateAddFilterBtn();
    if (bazaarList) {
      bazaarList.querySelectorAll('div.row___mbuuh[data-testid="sortable-item"]').forEach(row => {
        const btn = row.querySelector('.bp-chart-btn');
        if (btn) btn.textContent = pricedItems.has(row.dataset.bpId) ? '✓' : '📈';
      });
      applyFilter();
    }
    if (isAddPage()) {
      document.querySelectorAll('li.clearfix[data-reactid]').forEach(li => {
        if (!li.dataset.bpId) return;
        const btn = li.querySelector('.bp-chart-btn');
        if (btn) btn.textContent = pricedItems.has(li.dataset.bpId) ? '✓' : '📈';
      });
      applyAddFilter();
    }
  }

  setInterval(refreshExpiredPricedItems, 30 * 1000);

  // ── Add page: inject chart button into li row ─────────────────────────────
  function injectAddRow(li) {
    if (li.dataset.bpInjected) return;
    li.dataset.bpInjected = '1';

    const img = li.querySelector('img[src*="/images/items/"]');
    if (!img) return;
    const match = img.getAttribute('src').match(/\/images\/items\/(\d+)\//);
    if (!match) return;

    const nameEl = li.querySelector('.name-wrap .t-overflow');
    li.dataset.bpId   = match[1];
    li.dataset.bpName = nameEl ? nameEl.textContent.trim() : `Item #${match[1]}`;

    // Store available qty from thumbnail badge
    const qtyEl = li.querySelector('.item-amount.qty');
    li.dataset.bpQty = qtyEl ? qtyEl.textContent.trim() : '';

    const priceDiv = li.querySelector('div.price');
    if (!priceDiv) return;

    const btn = document.createElement('button');
    btn.className   = 'bp-chart-btn';
    btn.textContent = pricedItems.has(match[1]) ? '✓' : '📈';
    btn.title       = 'Show price chart';
    btn.type        = 'button';
    // Torn's mobile item row listens before the eventual synthetic click.
    // Contain every input phase so tapping this control cannot open item details.
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']
      .forEach(type => btn.addEventListener(type, e => e.stopPropagation()));
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openModal(li);
    });
    const nameWrap = li.querySelector('.name-wrap');
    const mobileLayout = window.innerWidth <= 600 || window.screen.width <= 600 ||
      window.matchMedia('(pointer: coarse)').matches;
    if (mobileLayout && nameWrap) {
      nameWrap.classList.add('bp-add-name-with-chart');
      btn.classList.add('bp-add-name-chart');
      nameWrap.appendChild(btn);
    } else {
      // Desktop: keep the button inline with the price input.
      priceDiv.appendChild(btn);
    }
  }

  function scanAddRows() {
    document.querySelectorAll('li.clearfix[data-reactid]').forEach(li => {
      if (li.querySelector('div.price input.input-money')) injectAddRow(li);
    });
  }

  // ── Add page filter ───────────────────────────────────────────────────────
  function updateAddFilterBtn() {
    if (!addFilterBtn) return;
    pruneExpiredPricedItems();
    const n = pricedItems.size;
    if (n === 0) addFilterActive = false;
    addFilterBtn.disabled = n === 0;
    addFilterBtn.classList.toggle('active', addFilterActive);
    addFilterBtn.querySelector('.bp-filter-count').textContent = n;
    addFilterBtn.title = addFilterActive ? 'Click to show all items' : 'Hide items priced in the last 30 minutes';
  }

  function applyAddFilter() {
    document.querySelectorAll('li.clearfix[data-reactid]').forEach(li => {
      if (!li.dataset.bpId) return;
      li.style.display = (addFilterActive && pricedItems.has(li.dataset.bpId)) ? 'none' : '';
    });
  }

  function injectAddFilterBtn(container) {
    if (document.getElementById('bp-add-filter-wrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'bp-add-filter-wrap';

    addFilterBtn = document.createElement('button');
    addFilterBtn.id        = 'bp-add-filter-btn';
    addFilterBtn.type      = 'button';
    addFilterBtn.innerHTML = `Hide recent <span class="bp-filter-count">0</span>`;
    addFilterBtn.classList.add('bp-filter-btn-add');
    addFilterBtn.disabled  = true;
    addFilterBtn.addEventListener('click', () => {
      if (pricedItems.size === 0) return;
      addFilterActive = !addFilterActive;
      updateAddFilterBtn();
      applyAddFilter();
    });

    const resetBtn = document.createElement('button');
    resetBtn.type        = 'button';
    resetBtn.textContent = 'Reset';
    resetBtn.classList.add('bp-reset-btn-add');
    resetBtn.title       = 'Clear all priced items';
    resetBtn.addEventListener('click', () => {
      pricedItems.clear();
      savePricedItems();
      addFilterActive = false;
      updateAddFilterBtn();
      applyAddFilter();
      document.querySelectorAll('li.clearfix[data-reactid] .bp-chart-btn').forEach(b => { b.textContent = '📈'; });
    });

    wrap.appendChild(addFilterBtn);
    wrap.appendChild(resetBtn);
    container.insertAdjacentElement('beforebegin', wrap);
    updateAddFilterBtn();
  }

  // ── Add page observer ─────────────────────────────────────────────────────
  function startAddObserver() {
    if (addObserver) { addObserver.disconnect(); addObserver = null; }
    const bazaarRoot = document.getElementById('bazaarRoot') || document.body;

    function tryInject() {
      scanAddRows();
      const firstUl = bazaarRoot.querySelector('ul.items-cont');
      if (firstUl && firstUl.parentElement && !document.getElementById('bp-add-filter-wrap')) {
        injectAddFilterBtn(firstUl.parentElement);
      }
    }

    tryInject();
    addObserver = new MutationObserver(tryInject);
    addObserver.observe(bazaarRoot, { childList: true, subtree: true });
  }

  // ── Inject chart button into a bazaar row ─────────────────────────────────
  function injectRow(row) {
    if (row.querySelector('.bp-chart-btn')) return;

    const img = row.querySelector('img[src*="/images/items/"]');
    if (!img) return;
    const match = img.getAttribute('src').match(/\/images\/items\/(\d+)\//);
    if (!match) return;

    const nameEl = row.querySelector('.desc___TpUlk b');
    row.dataset.bpId   = match[1];
    row.dataset.bpName = nameEl ? nameEl.textContent.trim() : `Item #${match[1]}`;

    const priceWrap = row.querySelector('.price___WxxqO');
    const mobileActions = row.querySelector('.mobileContainer___IP3uc .menuActivators___I7505');
    if (!priceWrap && !mobileActions) return;

    const btn = document.createElement('button');
    btn.className   = `bp-chart-btn${mobileActions ? ' bp-chart-btn-mobile' : ''}`;
    btn.textContent = pricedItems.has(match[1]) ? '✓' : '📈';
    btn.title       = 'Show price chart';
    btn.type        = 'button';
    btn.addEventListener('click', e => { e.stopPropagation(); openModal(row); });
    if (mobileActions) {
      const manageBtn = mobileActions.querySelector('button[aria-label="Manage"]');
      mobileActions.insertBefore(btn, manageBtn || null);
    } else {
      priceWrap.insertAdjacentElement('afterend', btn);
    }
    row.dataset.bpInjected = '1';

    applyFilterToRow(row); // apply filter state to newly injected row
  }

  // ── Scan all visible rows ─────────────────────────────────────────────────
  function scanRows(root) {
    root.querySelectorAll('div.row___mbuuh[data-testid="sortable-item"]').forEach(injectRow);
  }

  // ── MutationObserver on the virtualized list ──────────────────────────────
  function startObserver() {
    const list = document.querySelector('div[data-testid="virtualized-list"]');
    if (!list) {
      setTimeout(startObserver, 800);
      return;
    }
    if (list === bazaarList && listObserver) {
      injectFilterBtn(list);
      scanRows(list);
      return;
    }
    if (listObserver) listObserver.disconnect();
    bazaarList = list;
    injectFilterBtn(list);
    scanRows(list);
    listObserver = new MutationObserver(() => scanRows(list));
    listObserver.observe(list, { childList: true, subtree: true });
  }

  // ── Init: route to the right observer based on hash ──────────────────────
  function init() {
    if (isAddPage()) {
      if (listObserver) { listObserver.disconnect(); listObserver = null; bazaarList = null; }
      setTimeout(startAddObserver, 600);
    } else {
      if (addObserver) { addObserver.disconnect(); addObserver = null; }
      startObserver();
    }
  }

  window.addEventListener('hashchange', init);
  init();

  // Reattach if Torn replaces the manage list during a React refresh
  let rebindQueued = false;
  new MutationObserver(() => {
    if (isAddPage()) return;
    if (bazaarList?.isConnected && document.getElementById('bp-filter-btn')) return;
    if (rebindQueued) return;
    rebindQueued = true;
    requestAnimationFrame(() => { rebindQueued = false; startObserver(); });
  }).observe(document.body, { childList: true, subtree: true });
})();
