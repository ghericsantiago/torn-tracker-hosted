const $ = id => document.getElementById(id);
const TZ = 'America/New_York';   // Torn City timezone (ET)
const FMT_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const FMT_START = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function fmtTime(tsMs) { return tsMs ? FMT_TIME.format(new Date(tsMs)) : '—'; }
function fmtQty(n) { return (n || 0).toLocaleString(); }
function fmt$(n) {
  if (!n) return '$0';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n).toLocaleString();
}
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function invNetBtn(itemId, itemName) {
  const inv = state && state.items ? state.items.find(x => x.id === itemId) : null;
  const n = inv ? inv.net : null;
  const badge = n != null ? ` <span class="btn-adj-net">${n >= 0 ? '+' : ''}${fmtQty(n)}</span>` : '';
  return `<button class="btn-adj" data-item-id="${itemId}" data-item-name="${esc(itemName)}" data-scope="inventory" data-net="${n != null ? n : 0}" title="Reconcile inventory balance">⚖${badge}</button>`;
}
function tabAdjBtn(itemId, itemName, net, scope) {
  const badge = ` <span class="btn-adj-net">${net >= 0 ? '+' : ''}${fmtQty(net)}</span>`;
  return `<button class="btn-adj" data-item-id="${itemId}" data-item-name="${esc(itemName)}" data-scope="${scope}" data-net="${net}" title="Reconcile ${scope} balance">⚖${badge}</button>`;
}

let _toastTimer;
function showToast(msg, ms = 2500) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function topSources(sources, n = 2) {
  return Object.entries(sources || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([s]) => `<span class="badge">${esc(s)}</span>`)
    .join('');
}

let state = null;
let view = 'monitor';
let adjScope = 'inventory'; // tracks which ledger scope the open reconcile modal targets
let fastTimer = null;

// ── IN / OUT tab + infinite scroll ──
let ioTab = 'in';
const ioItemsCache = { in: [], out: [] };
const ioPaging     = { in: 0, out: 0 };
const IO_LIMIT = 100;

function buildIOCache(matches) {
  const defaultSort = dir => (a, b) => (b.value * b[dir]) - (a.value * a[dir]);
  for (const dir of ['in', 'out']) {
    const raw = state.items.filter(it => it[dir] > 0 && matches(it));
    const sorted = sortRows(raw, 'tb-' + dir);
    ioItemsCache[dir] = sorted === raw ? [...raw].sort(defaultSort(dir)) : sorted;
  }
}

function loadIOPage(dir) {
  dir = dir || ioTab;
  const offset = ioPaging[dir];
  const items  = ioItemsCache[dir];
  const page   = items.slice(offset, offset + IO_LIMIT);
  const isIn   = dir === 'in';
  if (page.length === 0 && offset === 0) {
    $('tb-' + dir).innerHTML = `<tr><td colspan="6" class="empty">Nothing ${isIn ? 'came in' : 'went out'} yet.</td></tr>`;
    return;
  }
  $('tb-' + dir).insertAdjacentHTML('beforeend', page.map(it => `
    <tr>
      <td class="item">${esc(it.name)}<button class="btn-adj" data-item-id="${it.id}" data-item-name="${esc(it.name)}" data-net="${it.net}" title="Reconcile">⚖</button></td>
      <td class="cat dim">${esc(it.category || '')}</td>
      <td class="${isIn ? 'green' : 'red'} hv-cell" data-item="${it.id}" data-dir="${isIn ? 'in' : 'out'}">${isIn ? '+' : '−'}${fmtQty(isIn ? it.in : it.out)}</td>
      <td class="gold">${fmt$(it.value * (isIn ? it.in : it.out))}</td>
      <td class="dim">${topSources(isIn ? it.sourcesIn : it.sourcesOut)}</td>
      <td class="dim r">${fmtTime(it.lastTs)}</td>
    </tr>`).join(''));
  ioPaging[dir] += page.length;
}

function resetIOTables(matches) {
  if (!state) return;
  if (!matches) {
    const q = ($('search').value || '').toLowerCase();
    const srcKeys = it => Object.keys(it.sourcesIn || {}).concat(Object.keys(it.sourcesOut || {}));
    matches = it => !q || it.name.toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q) || srcKeys(it).some(s => s.toLowerCase().includes(q));
  }
  buildIOCache(matches);
  ioPaging.in = 0; ioPaging.out = 0;
  $('tb-in').innerHTML = ''; $('tb-out').innerHTML = '';
  loadIOPage('in'); loadIOPage('out');
}

// ── Activity infinite scroll ──
const actPaging = { offset: 0, loading: false, hasMore: true, q: '' };

function actRow(a) {
  return `<div class="act">
    <span class="t">${fmtTime(a.ts)}</span>
    <span class="dir ${a.dir}">${a.dir === 'in' ? '▲' : '▼'}</span>
    <span class="item">${esc(a.name)}</span>
    <span class="qty">${a.dir === 'in' ? '+' : '−'}${fmtQty(a.qty)}</span>
    <span class="lg">${esc(a.source)}</span>
    <span class="src">${esc(a.title || '')}</span>
  </div>`;
}

async function loadActivity(reset) {
  if (actPaging.loading) return;
  const q = ($('search').value || '').toLowerCase();
  if (reset) {
    actPaging.offset = 0; actPaging.hasMore = true; actPaging.q = q;
    $('activity').innerHTML = '';
  } else if (!actPaging.hasMore) {
    return;
  }
  actPaging.loading = true;
  $('act-spinner').style.display = '';
  try {
    const params = new URLSearchParams({ offset: actPaging.offset, limit: 50 });
    if (q) params.set('q', q);
    const r = await fetch('/admin/inventory/api/activity?' + params);
    const j = await r.json();
    if (j.items && j.items.length) {
      $('activity').insertAdjacentHTML('beforeend', j.items.map(actRow).join(''));
    } else if (actPaging.offset === 0) {
      $('activity').innerHTML = '<div class="empty">No activity yet.</div>';
    }
    actPaging.offset += (j.items || []).length;
    actPaging.hasMore = j.hasMore || false;
  } catch (e) { console.error('[activity]', e); }
  actPaging.loading = false;
  $('act-spinner').style.display = 'none';
}

function switchView(v) {
  view = v;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $('view-monitor').style.display   = v === 'monitor' ? '' : 'none';
  $('view-inventory').style.display = v === 'inventory' ? '' : 'none';
  $('view-bazaar').style.display    = v === 'bazaar' ? '' : 'none';
  $('view-display').style.display   = v === 'display' ? '' : 'none';
  $('view-market').style.display    = v === 'market' ? '' : 'none';
  $('view-trading').style.display   = v === 'trading' ? '' : 'none';
  $('view-museum').style.display    = v === 'museum' ? '' : 'none';
  $('view-transfers').style.display = v === 'transfers' ? '' : 'none';
  render();
  if (v === 'monitor') loadActivity(true);
}

function render() {
  if (!state) return;
  const c = state.counts;

  $('st-since').textContent = 'Since ' + FMT_START.format(state.startTs * 1000) + ' (Torn time)';
  $('t-in').textContent  = fmtQty(c.inQty);
  $('t-out').textContent = fmtQty(c.outQty);
  $('t-net').textContent = (c.netQty >= 0 ? '+' : '') + fmtQty(c.netQty);
  $('t-val-in').textContent  = fmt$(c.valueIn);
  $('t-val-out').textContent = fmt$(c.valueOut);
  $('t-in-items').textContent  = c.uniqueIn  + ' unique items';
  $('t-out-items').textContent = c.uniqueOut + ' unique items';

  // poll status + progress bar
  const dot = $('st-poll');
  const p = state.poll || {};
  if (p.inProgress) {
    dot.innerHTML = '<span class="dot busy"></span>polling…';
  } else if (!state.apiKeySet) { dot.innerHTML = '<span class="dot bad"></span>API key not set'; }
  else if (p.lastOk) {
    const ago = p.lastTs ? Math.round((Date.now() - p.lastTs) / 1000) : 0;
    dot.innerHTML = `<span class="dot ok"></span>${esc(p.lastMsg || 'OK')} · ${ago}s ago`;
  } else {
    dot.innerHTML = `<span class="dot bad"></span>${esc(p.lastMsg || 'poll failed')}`;
  }
  const pr = p.progress;
  if (p.inProgress && pr && pr.total > 0) {
    const pct = Math.max(0, Math.min(100, Math.round(pr.current / pr.total * 100)));
    $('poll-progress').style.display = '';
    $('poll-progress-fill').style.width = pct + '%';
    $('poll-progress-label').textContent = `${pr.label} · ${pct}%`;
  } else {
    $('poll-progress').style.display = 'none';
  }
  $('warn-key').style.display = state.apiKeySet ? 'none' : 'block';

  const q = ($('search').value || '').toLowerCase();
  const srcKeys = it => Object.keys(it.sourcesIn || {}).concat(Object.keys(it.sourcesOut || {}));
  const matches = it => !q || it.name.toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q) || srcKeys(it).some(s => s.toLowerCase().includes(q));

  if (view === 'inventory') { renderInventory(q); return; }
  if (view === 'bazaar') { renderBazaar(q); return; }
  if (view === 'display') { renderDisplay(q); return; }
  if (view === 'market') { renderMarket(q); return; }
  if (view === 'trading') { renderTrades(q); return; }
  if (view === 'museum') { renderMuseum(q); return; }
  if (view === 'transfers') { renderTransfers(q); return; }

  // ── Monitor view ──
  $('in-count').textContent  = state.items.filter(it => it.in > 0  && matches(it)).length;
  $('out-count').textContent = state.items.filter(it => it.out > 0 && matches(it)).length;
  resetIOTables(matches);
  // Activity is managed by loadActivity()

  // refresh the item autocomplete for the adjust modal
  const names = [...new Set((state.items || []).map(it => it.name).filter(Boolean))].slice(0, 2000);
  $('adj-items').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');

  updateSortIndicators();
}

// ── Inventory view: the ledger (baseline zero + net flows) ──
function renderInventory(q) {
  const cur = state.current || {};
  $('iv-items').textContent = fmtQty(cur.stockItems);
  $('iv-qty').textContent   = fmtQty(cur.stockQty);
  $('iv-val').textContent   = fmt$(cur.stockValue);
  $('iv-neg').textContent   = fmtQty(cur.overdrawnItems);

  let items = state.items.filter(it => it.net !== 0 && (!q || it.name.toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q)));
  const sortedItems = sortRows(items, 'tb-inv');
  items = sortedItems === items ? items.sort((a, b) => (Math.abs(b.net) * b.value) - (Math.abs(a.net) * a.value)) : sortedItems;
  items = items.slice(0, 300);

  $('inv-count').textContent = state.items.filter(it => it.net > 0 && (!q || it.name.toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q))).length + ' items';
  $('inv-badge').textContent = state.items.filter(it => it.net > 0).length;

  $('tb-inv').innerHTML = items.length ? items.map(it => `
    <tr>
      <td class="item">${esc(it.name)}<button class="btn-adj" data-item-id="${it.id}" data-item-name="${esc(it.name)}" data-net="${it.net}" title="Reconcile">⚖</button></td>
      <td class="cat dim">${esc(it.category || '')}</td>
      <td class="green hv-cell" data-item="${it.id}" data-dir="in">+${fmtQty(it.in)}</td>
      <td class="red hv-cell" data-item="${it.id}" data-dir="out">−${fmtQty(it.out)}</td>
      <td class="${it.net >= 0 ? 'green' : 'red'} hv-cell" data-item="${it.id}" data-dir="both" title="History">${it.net >= 0 ? '+' : ''}${fmtQty(it.net)}</td>
      <td class="gold">${fmt$(it.net * it.value)}</td>
      <td class="dim r">${fmtTime(it.lastTs)}</td>
    </tr>`).join('')
    : '<tr><td colspan="7" class="empty">No inventory yet — nothing has moved since 02:00 AM.</td></tr>';
}

// ── Bazaar view: separate stock ledger (added − sold − removed) ──
function renderBazaar(q) {
  const bz = state.bazaar || { items: [], revenue: 0, unitsSold: 0 };
  $('bz-rev').textContent   = fmt$(bz.revenue);
  $('bz-sold').textContent  = fmtQty(bz.unitsSold);
  $('bz-items').textContent = fmtQty(bz.stockItems);
  $('bz-net').textContent   = (bz.netUnits >= 0 ? '+' : '') + fmtQty(bz.netUnits);

  let items = (bz.items || []).filter(it => it.net !== 0 && (!q || it.name.toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q)));
  const sortedItems = sortRows(items, 'tb-bz');
  items = sortedItems === items ? items.sort((a, b) => (Math.abs(b.net) * b.value) - (Math.abs(a.net) * a.value)) : sortedItems;
  items = items.slice(0, 300);

  $('bz-count').textContent = (bz.items || []).filter(it => it.net > 0 && (!q || it.name.toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q))).length + ' items';
  $('bz-badge').textContent = (bz.items || []).filter(it => it.net > 0).length;

  $('tb-bz').innerHTML = items.length ? items.map(it => `
    <tr>
      <td class="item">${esc(it.name)}${tabAdjBtn(it.id, it.name, it.net, 'bazaar')}</td>
      <td class="cat dim">${esc(it.category || '')}</td>
      <td class="green hv-cell" data-item="${it.id}" data-dir="in" data-source="Bazaar Added">+${fmtQty(it.in)}</td>
      <td class="red hv-cell" data-item="${it.id}" data-dir="out" data-source="Bazaar Sold">−${fmtQty(it.sold)}</td>
      <td class="red hv-cell" data-item="${it.id}" data-dir="out" data-source="Bazaar Removed">−${fmtQty(it.removed)}</td>
      <td class="${it.net >= 0 ? 'green' : 'red'}">${it.net >= 0 ? '+' : ''}${fmtQty(it.net)}</td>
      <td class="gold">${fmt$(it.net * it.value)}</td>
      <td class="dim r">${fmtTime(it.lastTs)}</td>
    </tr>`).join('')
    : '<tr><td colspan="8" class="empty">No bazaar activity yet since 02:00 AM.</td></tr>';
}

// ── Display Case view: separate stock ledger (added − removed) ──
function renderDisplay(q) {
  const disp = state.display || { items: [], unitsIn: 0, unitsOut: 0, netUnits: 0, stockItems: 0 };
  $('disp-items').textContent = fmtQty(disp.stockItems);
  $('disp-net').textContent   = (disp.netUnits >= 0 ? '+' : '') + fmtQty(disp.netUnits);
  $('disp-in').textContent    = '+' + fmtQty(disp.unitsIn);
  $('disp-out').textContent   = '−' + fmtQty(disp.unitsOut);

  let items = (disp.items || []).filter(it => it.net !== 0 && (!q || it.name.toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q)));
  const sortedItems = sortRows(items, 'tb-disp');
  items = sortedItems === items ? items.sort((a, b) => (Math.abs(b.net) * b.value) - (Math.abs(a.net) * a.value)) : sortedItems;
  items = items.slice(0, 300);

  $('disp-count').textContent = (disp.items || []).filter(it => it.net > 0 && (!q || it.name.toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q))).length + ' items';
  $('disp-badge').textContent = (disp.items || []).filter(it => it.net > 0).length;

  $('tb-disp').innerHTML = items.length ? items.map(it => `
    <tr>
      <td class="item">${esc(it.name)}${tabAdjBtn(it.id, it.name, it.net, 'display')}</td>
      <td class="cat dim">${esc(it.category || '')}</td>
      <td class="green hv-cell" data-item="${it.id}" data-dir="in" data-source="Display Added">+${fmtQty(it.in)}</td>
      <td class="red hv-cell" data-item="${it.id}" data-dir="out" data-source="Display Removed">−${fmtQty(it.removed)}</td>
      <td class="${it.net >= 0 ? 'green' : 'red'}">${it.net >= 0 ? '+' : ''}${fmtQty(it.net)}</td>
      <td class="gold">${fmt$(it.net * it.value)}</td>
      <td class="dim r">${fmtTime(it.lastTs)}</td>
    </tr>`).join('')
    : '<tr><td colspan="7" class="empty">No display case activity yet since 02:00 AM.</td></tr>';
}

// ── Item Market view: separate listing ledger (listed − sold − removed) ──
function renderMarket(q) {
  const mkt = state.market || { items: [], revenue: 0, unitsSold: 0, unitsIn: 0, unitsOut: 0, netUnits: 0, stockItems: 0 };
  $('mkt-rev').textContent  = fmt$(mkt.revenue);
  $('mkt-items').textContent = fmtQty(mkt.stockItems);
  $('mkt-net').textContent  = (mkt.netUnits >= 0 ? '+' : '') + fmtQty(mkt.netUnits);
  $('mkt-in').textContent   = '+' + fmtQty(mkt.unitsIn);
  $('mkt-sold').textContent = fmtQty(mkt.unitsSold);
  $('mkt-out').textContent  = '−' + fmtQty(mkt.unitsOut);

  let items = (mkt.items || []).filter(it => it.net !== 0 && (!q || it.name.toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q)));
  const sortedItems = sortRows(items, 'tb-mkt');
  items = sortedItems === items ? items.sort((a, b) => (Math.abs(b.net) * b.value) - (Math.abs(a.net) * a.value)) : sortedItems;
  items = items.slice(0, 300);

  $('mkt-count').textContent = (mkt.items || []).filter(it => it.net > 0 && (!q || it.name.toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q))).length + ' items';
  $('mkt-badge').textContent = (mkt.items || []).filter(it => it.net > 0).length;

  $('tb-mkt').innerHTML = items.length ? items.map(it => `
    <tr>
      <td class="item">${esc(it.name)}${tabAdjBtn(it.id, it.name, it.net, 'market')}</td>
      <td class="cat dim">${esc(it.category || '')}</td>
      <td class="green hv-cell" data-item="${it.id}" data-dir="in" data-source="Market Added">+${fmtQty(it.in)}</td>
      <td class="gold hv-cell" data-item="${it.id}" data-dir="out" data-source="Market Sold">${fmtQty(it.sold)}</td>
      <td class="red hv-cell" data-item="${it.id}" data-dir="out" data-source="Market Removed">−${fmtQty(it.removed)}</td>
      <td class="${it.net >= 0 ? 'green' : 'red'}">${it.net >= 0 ? '+' : ''}${fmtQty(it.net)}</td>
      <td class="gold">${fmt$(it.net * it.value)}</td>
      <td class="dim r">${fmtTime(it.lastTs)}</td>
    </tr>`).join('')
    : '<tr><td colspan="8" class="empty">No item market activity yet since 02:00 AM.</td></tr>';
}

// ── Trading view: trade events (4445 out / 4446 in) ──
function renderTrades(q) {
  const trd = state.trades || { trades: [], items: [], countOut: 0, countIn: 0, sentQty: 0, receivedQty: 0, moneyOut: 0, moneyIn: 0 };
  $('trd-out-count').textContent = fmtQty(trd.countOut);
  $('trd-in-count').textContent  = fmtQty(trd.countIn);
  $('trd-sent').textContent      = '−' + fmtQty(trd.sentQty);
  $('trd-recv').textContent      = '+' + fmtQty(trd.receivedQty);
  $('trd-money-out').textContent = fmt$(trd.moneyOut);
  $('trd-money-in').textContent  = fmt$(trd.moneyIn);

  const groups = sortRows((trd.trades || [])
    .filter(t => !q || (t.gave.items || []).some(i => (i.name || '').toLowerCase().includes(q))
                || (t.received.items || []).some(i => (i.name || '').toLowerCase().includes(q))
                || String(t.counterpartId || '').includes(q)), 'tb-trd');
  $('trd-count').textContent = groups.length + ' trades';
  $('trd-badge').textContent = (trd.trades || []).length;

  const sideSummary = side => {
    const parts = [];
    if (side.money > 0) parts.push(fmt$(side.money));
    if (side.items.length === 1) parts.push(`${fmtQty(side.items[0].qty)}× ${esc(side.items[0].name)}`);
    else if (side.items.length > 1) parts.push(`${fmtQty(side.items.reduce((s, i) => s + i.qty, 0))} items`);
    if (side.properties > 0) parts.push(`${side.properties} prop.`);
    return parts.join(' + ') || '<span class="dim">—</span>';
  };
  const tradeLink = id => `<a class="trade-link" href="https://www.torn.com/trade.php#step=view&amp;ID=${encodeURIComponent(id)}" target="_blank" rel="noopener">#${esc(id)}</a>`;
  const playerLink = id => `<a class="trade-link" href="https://www.torn.com/profiles.php?XID=${id}" target="_blank" rel="noopener">Player #${id}</a>`;
  const sideList = side => {
    const lines = [];
    if (side.money > 0) lines.push(`<div class="trade-item"><span class="trade-item-qty">💰</span>${fmt$(side.money)}</div>`);
    side.items.forEach(i => {
      const price = i.value ? ` <span class="trade-item-price">@ ${fmt$(i.value)} ea</span>` : '';
      lines.push(`<div class="trade-item"><span class="trade-item-qty">${fmtQty(i.qty)}×</span>${esc(i.name || i.itemId)}${price}</div>`);
    });
    for (let p = 0; p < side.properties; p++) lines.push('<div class="trade-item"><span class="trade-item-qty">🏠</span>Property</div>');
    return lines.join('') || '<div class="trade-item dim">—</div>';
  };

  $('tb-trd').innerHTML = groups.length ? groups.map((t, i) => `
    <tr class="trade-row" data-idx="${i}" style="cursor:pointer">
      <td class="dim">${fmtTime(t.ts)}</td>
      <td>${tradeLink(t.tradeId)}</td>
      <td class="dim">${t.counterpartId ? playerLink(t.counterpartId) : '—'}</td>
      <td class="red">${sideSummary(t.gave)}</td>
      <td class="green">${sideSummary(t.received)}</td>
      <td class="trade-arrow">▶</td>
    </tr>
    <tr class="trade-detail" id="trd-det-${i}" style="display:none">
      <td colspan="6" class="trade-detail-cell">
        <div class="trade-cols">
          <div class="trade-col"><div class="trade-col-hdr red">You Gave</div>${sideList(t.gave)}</div>
          <div class="trade-col"><div class="trade-col-hdr green">You Received</div>${sideList(t.received)}</div>
        </div>
      </td>
    </tr>`).join('')
    : '<tr><td colspan="6" class="empty">No trades yet since 02:00 AM.</td></tr>';

  $('tb-trd').querySelectorAll('.trade-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('a')) return;   // don't expand when clicking links
      const idx    = row.dataset.idx;
      const detail = document.getElementById('trd-det-' + idx);
      const arrow  = row.querySelector('.trade-arrow');
      const open   = detail.style.display !== 'none';
      detail.style.display = open ? 'none' : 'table-row';
      arrow.textContent = open ? '▶' : '▼';
    });
  });

  let items = (trd.items || []).filter(it => it.net !== 0 && (!q || it.name.toLowerCase().includes(q) || (it.category || '').toLowerCase().includes(q)));
  const sortedItems = sortRows(items, 'tb-trd-items');
  items = sortedItems === items ? items.sort((a, b) => (Math.abs(b.net) * b.value) - (Math.abs(a.net) * a.value)) : sortedItems;
  items = items.slice(0, 300);
  $('tb-trd-items').innerHTML = items.length ? items.map(it => `
    <tr>
      <td class="item">${esc(it.name)}${invNetBtn(it.id, it.name)}</td>
      <td class="cat dim">${esc(it.category || '')}</td>
      <td class="green hv-cell" data-item="${it.id}" data-dir="in">+${fmtQty(it.in)}</td>
      <td class="red hv-cell" data-item="${it.id}" data-dir="out">−${fmtQty(it.out)}</td>
      <td class="${it.net >= 0 ? 'green' : 'red'} hv-cell" data-item="${it.id}" data-dir="both" title="History">${it.net >= 0 ? '+' : ''}${fmtQty(it.net)}</td>
      <td class="gold">${fmt$(it.net * it.value)}</td>
      <td class="dim r">${fmtTime(it.lastTs)}</td>
    </tr>`).join('')
    : '<tr><td colspan="7" class="empty">No trades yet since 02:00 AM.</td></tr>';
}

// ── Museum view: exchange rewards (points_received) ──
function renderMuseum(q) {
  const mus = state.museum || { pointsReceived: 0, swapCount: 0, unitsSpent: 0, swaps: [] };
  $('mus-points').textContent = fmtQty(mus.pointsReceived);
  $('mus-count').textContent  = fmtQty(mus.swapCount);
  $('mus-spent').textContent  = fmtQty(mus.unitsSpent);

  const swaps = sortRows((mus.swaps || [])
    .filter(s => !q || (s.set || '').toLowerCase().includes(q)), 'tb-mus');
  $('mus-title-count').textContent = swaps.length + ' swaps';
  $('mus-badge').textContent = (mus.swaps || []).length;

  $('tb-mus').innerHTML = swaps.length ? swaps.map(s => `
    <tr>
      <td class="dim">${fmtTime(s.ts)}</td>
      <td class="item">${esc(s.set)}</td>
      <td class="gold r">${fmtQty(s.quantity)}</td>
      <td class="gold r">+${fmtQty(s.pointsReceived)}</td>
      <td class="dim">Museum exchange</td>
    </tr>`).join('')
    : '<tr><td colspan="5" class="empty">No museum exchanges yet since 02:00 AM.</td></tr>';
}

// ── Transfers view: location→location moves ──
function renderTransfers(q) {
  const tr = state.transfers || { counts: {}, items: [] };
  const counts = tr.counts || {};
  const dirs = ['Inventory → Bazaar', 'Bazaar → Inventory', 'Inventory → Display', 'Display → Inventory', 'Inventory → Market', 'Market → Inventory', 'Bazaar → Sold', 'Market → Sold'];
  $('tr-tiles').innerHTML = dirs.map(d => `
    <div class="tile ${d.includes('Sold') ? 'gold' : 'blue'}">
      <div class="lbl">${esc(d)}</div>
      <div class="val hv-cell" data-route="${esc(d)}" style="cursor:pointer">${fmtQty(counts[d] || 0)}</div>
    </div>`).join('');

  const items = sortRows((tr.items || [])
    .filter(t => !q || (t.name || '').toLowerCase().includes(q) || (t.category || '').toLowerCase().includes(q) || (t.itemId || '').includes(q)), 'tb-tr');
  $('tr-count').textContent = items.length + ' moves';
  $('tr-badge').textContent = (tr.items || []).length;

  $('tb-tr').innerHTML = items.length ? items.map(t => `
    <tr>
      <td class="dim">${fmtTime(t.ts)}</td>
      <td class="item">${esc(t.name || t.itemId)}</td>
      <td class="cat dim">${esc(t.category || '')}</td>
      <td><span class="badge">${esc(t.from)}</span>&nbsp;→&nbsp;<span class="badge">${esc(t.to)}</span></td>
      <td class="gold r">${fmtQty(t.qty)}</td>
      <td class="dim">${esc(t.title || '')}</td>
    </tr>`).join('')
    : '<tr><td colspan="6" class="empty">No transfers yet since 02:00 AM.</td></tr>';
}

async function load() {
  try {
    const r = await fetch('/admin/inventory/api/state');
    state = await r.json();
    render();
    if (view === 'monitor') loadActivity(true);
    // Fast-refresh while a poll is running so the progress bar stays live
    if (state.poll && state.poll.inProgress && !fastTimer) {
      fastTimer = setTimeout(() => { fastTimer = null; load(); }, 1500);
    }
  } catch (e) {
    $('st-poll').innerHTML = '<span class="dot bad"></span>cannot reach server';
  }
}

// ── Hover popup: per-item IN/OUT breakdown (When · Source · Qty) ──
const hoverCache = new Map();
let hoverPopVisible = false;
let hoverPopCell = null;   // the cell the open popup belongs to
function renderPop(title, rows) {
  $('hover-pop-title-text').textContent = title;
  $('hover-pop-body').innerHTML = rows.length ? rows.map(e => `
    <tr>
      <td class="dim">${fmtTime(e.ts)}</td>
      <td>${esc(e.label)}</td>
      <td class="dim">${esc(e.cat || '')}${e.type != null ? ` <span class="dim2">#${e.type}</span>` : ''}</td>
      <td class="r">${e.sign ? e.sign : ''}${fmtQty(e.qty)}</td>
    </tr>`).join('')
    : '<tr><td colspan="4" class="empty">Nothing to show yet.</td></tr>';
}
function positionPop(cell) {
  const pop = $('hover-pop');
  pop.style.display = '';
  hoverPopVisible = true;
  hoverPopCell = cell;
  const rect = cell.getBoundingClientRect();
  const w = Math.min(360, Math.max(300, pop.offsetWidth));
  pop.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - w - 8)) + 'px';
  pop.style.top  = Math.max(4, rect.bottom + 6) + 'px';
}
async function showHoverPop(cell) {
  const itemId = cell.dataset.item;
  const dir    = cell.dataset.dir;
  const source = cell.dataset.source || '';
  const key    = itemId + '|' + dir + '|' + source;
  if (!hoverCache.has(key)) {
    try {
      const qs = `itemId=${encodeURIComponent(itemId)}&dir=${dir}${source ? '&source=' + encodeURIComponent(source) : ''}&limit=100`;
      const r = await fetch('/admin/inventory/api/item-events?' + qs);
      hoverCache.set(key, (await r.json()).events || []);
    } catch { hoverCache.set(key, []); }
  }
  const events = hoverCache.get(key);
  const name = (cell.closest('tr') && cell.closest('tr').querySelector('.item') || {}).textContent || itemId;
  const title = source || (dir === 'both' ? 'History' : (dir === 'in' ? 'IN' : 'OUT'));
  renderPop(`${title} · ${name} · ${events.length} event${events.length === 1 ? '' : 's'}`,
    events.map(e => ({ ts: e.ts, label: e.source, cat: e.category, type: e.logType, qty: e.qty, sign: (e.dir || dir) === 'in' ? '+' : '−' })));
  positionPop(cell);
}
// Transfers tab: route-count tile → list of transfers for that route (client-side data)
function showRoutePop(cell) {
  const route = cell.dataset.route;
  const parts = route.split(' → ');
  const rows = (state.transfers && state.transfers.items || [])
    .filter(t => t.from === parts[0] && t.to === parts[1])
    .slice(0, 100)
    .map(t => ({ ts: t.ts, label: t.name || t.itemId, cat: 'Transfer', type: t.logType, qty: t.qty, sign: '+' }));
  renderPop(`${route} · ${rows.length} move${rows.length === 1 ? '' : 's'}`, rows);
  positionPop(cell);
}
function hideHoverPop() {
  if (!hoverPopVisible) return;
  hoverPopVisible = false;
  hoverPopCell = null;
  $('hover-pop').style.display = 'none';
}
// Click an IN/OUT number (or a Transfers route tile) → open/toggle the popup;
// click elsewhere (or the ×) → close.
document.addEventListener('click', async e => {
  const routeCell = e.target.closest && e.target.closest('[data-route]');
  if (routeCell && routeCell.dataset.route) {
    if (hoverPopVisible && hoverPopCell === routeCell) { hideHoverPop(); return; }   // toggle off
    e.stopPropagation();
    showRoutePop(routeCell);
    return;
  }
  const cell = e.target.closest && e.target.closest('.hv-cell');
  if (cell && cell.dataset && cell.dataset.item) {
    if (hoverPopVisible && hoverPopCell === cell) { hideHoverPop(); return; }   // toggle off
    e.stopPropagation();
    showHoverPop(cell);
    return;
  }
  const pop = $('hover-pop');
  if (pop && !pop.contains(e.target)) hideHoverPop();
});
$('hover-pop-close').addEventListener('click', hideHoverPop);

// ── Sortable columns: click any header to sort (click again to reverse) ──
const sortState = {};   // tbodyId → { key, dir }
const SORTS = {
  'tb-in':   { item: r => r.name, cat: r => r.category || '', in: r => r.in, val: r => r.value * r.in, src: r => Object.keys(r.sourcesIn || {}).join(','), last: r => r.lastTs },
  'tb-out':  { item: r => r.name, cat: r => r.category || '', out: r => r.out, val: r => r.value * r.out, src: r => Object.keys(r.sourcesOut || {}).join(','), last: r => r.lastTs },
  'tb-inv':  { item: r => r.name, cat: r => r.category || '', in: r => r.in, out: r => r.out, net: r => r.net, val: r => r.value * r.net, last: r => r.lastTs },
  'tb-bz':   { item: r => r.name, cat: r => r.category || '', added: r => r.in, sold: r => r.sold, removed: r => r.removed, net: r => r.net, val: r => r.value * r.net, last: r => r.lastTs },
  'tb-disp': { item: r => r.name, cat: r => r.category || '', added: r => r.in, removed: r => r.removed, net: r => r.net, val: r => r.value * r.net, last: r => r.lastTs },
  'tb-mkt':  { item: r => r.name, cat: r => r.category || '', listed: r => r.in, sold: r => r.sold, removed: r => r.removed, net: r => r.net, val: r => r.value * r.net, last: r => r.lastTs },
  'tb-trd':  { date: r => r.ts, trade: r => String(r.tradeId), counterpart: r => r.counterpartId || 0, gave: r => r.gave.money + r.gave.items.reduce((s, i) => s + i.qty, 0), received: r => r.received.money + r.received.items.reduce((s, i) => s + i.qty, 0) },
  'tb-trd-items': { item: r => r.name, cat: r => r.category || '', received: r => r.in, sent: r => r.out, net: r => r.net, val: r => r.value * r.net, last: r => r.lastTs },
  'tb-mus':  { date: r => r.ts, set: r => r.set, qty: r => r.quantity, points: r => r.pointsReceived },
  'tb-tr':   { date: r => r.ts, item: r => r.name || r.itemId, cat: r => r.category || '', route: r => (r.from || '') + '→' + (r.to || ''), qty: r => r.qty },
  'adj-list':{ date: r => r.ts, item: r => r.name || r.itemId, qty: r => r.qty, label: r => r.label },
};
function sortRows(rows, tbodyId) {
  const s = sortState[tbodyId];
  if (!s) return rows;
  const get = SORTS[tbodyId] && SORTS[tbodyId][s.key];
  if (!get) return rows;
  const dir = s.dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = get(a), bv = get(b);
    const an = av == null || av === '', bn = bv == null || bv === '';
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    const al = typeof av === 'string' ? av.toLowerCase() : av;
    const bl = typeof bv === 'string' ? String(bv).toLowerCase() : bv;
    return al < bl ? -dir : al > bl ? dir : 0;
  });
}
function updateSortIndicators() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const tbody = th.closest('table') && th.closest('table').querySelector('tbody');
    const id = tbody && tbody.id;
    const s = id && sortState[id];
    th.classList.remove('sort-asc', 'sort-desc');
    if (s && s.key === th.dataset.sort) th.classList.add(s.dir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}
document.addEventListener('click', e => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const tbody = th.closest('table').querySelector('tbody');
  const id = tbody.id;
  const key = th.dataset.sort;
  const prev = sortState[id];
  sortState[id] = { key, dir: prev && prev.key === key ? (prev.dir === 'asc' ? 'desc' : 'asc') : 'asc' };
  render();
});

// ── Manual adjustments modal ──
function openAdjModal() { $('adj-modal').style.display = 'flex'; renderAdjList(); }
function closeAdjModal() { $('adj-modal').style.display = 'none'; $('adj-err').style.display = 'none'; }
function renderAdjList() {
  const list = sortRows(state.adjustments || [], 'adj-list').slice(0, 50);
  $('adj-list').innerHTML = list.length ? list.map(a => `
    <tr>
      <td class="dim">${fmtTime(a.ts)}</td>
      <td class="item">${esc(a.name || a.itemId)}</td>
      <td class="${a.dir === 'in' ? 'green' : 'red'}">${a.dir === 'in' ? '+' : '−'}${fmtQty(a.qty)}</td>
      <td>${esc(a.label)}${a.scope && a.scope !== 'inventory' ? ` <span class="badge">${a.scope}</span>` : ''}</td>
      <td><button class="adj-del" data-del="${a.id}" title="Delete">🗑</button></td>
    </tr>`).join('')
    : '<tr><td colspan="5" class="empty">None yet.</td></tr>';
  $('adj-list').querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', async () => {
      await fetch('/admin/inventory/api/adjust/' + b.dataset.del, { method: 'DELETE' });
      load();
    });
  });
}
document.querySelectorAll('input[name="adj-mode"]').forEach(r => {
  r.addEventListener('change', () => {
    const balance = document.querySelector('input[name="adj-mode"]:checked').value === 'balance';
    $('adj-record').style.display = balance ? 'none' : '';
    $('adj-balance').style.display = balance ? '' : 'none';
  });
});
$('btn-adjust').addEventListener('click', openAdjModal);
$('adj-close').addEventListener('click', closeAdjModal);
$('adj-modal').addEventListener('click', e => { if (e.target === $('adj-modal')) closeAdjModal(); });
// Per-item ⚖ reconcile button → open the modal pre-filled (item + current balance, reconcile mode)
document.addEventListener('click', e => {
  const btn = e.target.closest('.btn-adj');
  if (!btn) return;
  e.stopPropagation();
  adjScope = btn.dataset.scope || 'inventory';
  openAdjModal();
  const balRadio = document.querySelector('input[name="adj-mode"][value="balance"]');
  balRadio.checked = true;
  balRadio.dispatchEvent(new Event('change'));
  $('adj-item').value = btn.dataset.itemName || btn.dataset.itemId;
  $('adj-bal').value = Math.max(0, parseInt(btn.dataset.net) || 0);
  $('adj-label').value = 'Reconcile';
  $('adj-note').value = '';
  $('adj-err').style.display = 'none';
  $('adj-bal').focus();
  $('adj-bal').select();
});
$('adj-save').addEventListener('click', async () => {
  const mode = document.querySelector('input[name="adj-mode"]:checked').value;
  const body = { item: $('adj-item').value, label: $('adj-label').value, note: $('adj-note').value, scope: adjScope };
  if (mode === 'balance') body.balance = $('adj-bal').value;
  else { body.dir = $('adj-dir').value; body.qty = $('adj-qty').value; }
  try {
    const r = await fetch('/admin/inventory/api/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) { $('adj-err').textContent = j.error || 'Failed to save.'; $('adj-err').style.display = ''; return; }
    closeAdjModal();
    showToast('Adjustment saved');
    load();
  } catch (e) { $('adj-err').textContent = 'Network error: ' + e.message; $('adj-err').style.display = ''; }
});

$('btn-poll').addEventListener('click', async () => {
  $('btn-poll').disabled = true;
  try {
    const r = await fetch('/admin/inventory/api/poll', { method: 'POST' });
    const j = await r.json();
    if (j.state) state = j.state;
    render();
    setTimeout(() => { $('btn-poll').disabled = false; }, 1500);
  } catch (e) { $('btn-poll').disabled = false; }
});

$('btn-reset').addEventListener('click', async () => {
  if (!confirm('Reset all tracked IN/OUT data and start fresh from the monitor start time?')) return;
  const r = await fetch('/admin/inventory/api/reset', { method: 'POST' });
  const j = await r.json();
  if (j.state) state = j.state;
  render();
  if (view === 'monitor') loadActivity(true);
});

document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));

let t;
$('search').addEventListener('input', () => {
  clearTimeout(t);
  t = setTimeout(() => { render(); if (view === 'monitor') loadActivity(true); }, 200);
});

// IO tab switch
document.querySelectorAll('.io-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    ioTab = btn.dataset.io;
    document.querySelectorAll('.io-tab').forEach(b => b.classList.toggle('active', b.dataset.io === ioTab));
    $('io-in-table').style.display  = ioTab === 'in'  ? '' : 'none';
    $('io-out-table').style.display = ioTab === 'out' ? '' : 'none';
  });
});

// Infinite scroll: load more IO rows when user scrolls near bottom of the IO card
$('io-card').addEventListener('scroll', () => {
  const el = $('io-card');
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200)
    if (view === 'monitor' && ioPaging[ioTab] < ioItemsCache[ioTab].length) loadIOPage();
});

// Infinite scroll: load more activity when user scrolls near bottom of the activity div
$('activity').addEventListener('scroll', () => {
  const el = $('activity');
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200)
    if (view === 'monitor') loadActivity(false);
});

load();
setInterval(load, 30000);   // dashboard auto-refresh
