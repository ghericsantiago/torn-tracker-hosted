(() => {
  const $ = id => document.getElementById(id);
  const money = n => '$' + Math.round(Number(n) || 0).toLocaleString();
  const num = n => (Number(n) || 0).toLocaleString();
  const profitClass = n => n > 0 ? 'positive' : n < 0 ? 'negative' : '';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

  let state = { items: [], totals: {}, total: 0 };
  let selected = null;
  let detail = null;
  let tab = 'open';
  const itemPage = { limit: 50, sort: 'date', direction: 'desc', loading: false };
  const lotPage = { limit: 30, sort: 'date', direction: 'desc', loading: false };

  async function api(url, options) {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, ...options });
    const json = await response.json();
    if (response.status === 401) { location.href = '/admin'; throw new Error('Sign in required'); }
    if (!response.ok) throw new Error(json.error || 'Request failed');
    return json;
  }

  function summaryCard(label, value, hint, className = '') {
    return `<div class="summary-card"><div class="label">${label}</div><div class="value ${className}">${value}</div><div class="hint">${hint}</div></div>`;
  }

  function itemParams(offset) {
    const params = new URLSearchParams({
      q: $('itemSearch').value.trim(), limit: itemPage.limit, offset,
      sort: itemPage.sort, direction: itemPage.direction,
      category: $('categoryFilter').value,
      current_only: $('currentLotsOnly').checked,
    });
    if ($('dateFrom').value) params.set('from', $('dateFrom').value);
    if ($('dateTo').value) params.set('to', $('dateTo').value);
    return params;
  }

  async function loadCategories() {
    const response = await api('/admin/api/trading-profit/categories');
    $('categoryFilter').insertAdjacentHTML('beforeend', response.categories.map(category =>
      `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join(''));
  }

  async function loadItems(reset = true) {
    if (itemPage.loading) return;
    itemPage.loading = true;
    $('loadMoreItems').textContent = 'Loading…';
    try {
      const offset = reset ? 0 : state.items.length;
      const response = await api('/admin/api/trading-profit/overview?' + itemParams(offset));
      state = {
        items: reset ? response.items : state.items.concat(response.items),
        totals: response.totals, total: response.total,
      };
      if (reset && selected && !state.items.some(item => item.item_id === selected)) closeDetail();
      renderItems();
    } catch (error) {
      $('itemRows').innerHTML = `<tr><td colspan="11" class="negative">${escapeHtml(error.message)}</td></tr>`;
    } finally {
      itemPage.loading = false;
      $('loadMoreItems').textContent = 'Load more items';
    }
  }

  function parkDetail() {
    const row = document.querySelector('.detail-row');
    if (row) { $('detailHome').append($('itemDetail')); row.remove(); }
  }

  function mountDetail(itemId) {
    const row = document.querySelector(`#itemRows tr[data-id="${itemId}"]`);
    if (!row) return;
    const detailRow = document.createElement('tr');
    const cell = document.createElement('td');
    detailRow.className = 'detail-row';
    cell.colSpan = 11;
    detailRow.append(cell);
    row.insertAdjacentElement('afterend', detailRow);
    cell.append($('itemDetail'));
  }

  function renderItems() {
    parkDetail();
    const totals = state.totals;
    const margin = totals.revenue ? totals.profit / totals.revenue * 100 : 0;
    $('summaryGrid').innerHTML =
      summaryCard('Purchase cost', money(totals.purchase_cost), 'Bought during period') +
      summaryCard('Sales revenue', money(totals.revenue), 'Sold during period') +
      summaryCard('Realized profit', money(totals.profit), 'Matched FIFO sales', profitClass(totals.profit)) +
      summaryCard('Profit margin', totals.revenue ? margin.toFixed(1) + '%' : '—', 'Profit ÷ revenue', profitClass(totals.profit)) +
      summaryCard('Remaining units', num(totals.remaining), 'Open lots · now') +
      summaryCard('Open cost basis', money(totals.open_cost), 'Unsold lots · now');

    $('itemRows').innerHTML = state.items.map(item => `<tr data-id="${item.item_id}" class="${selected === item.item_id ? 'selected' : ''}">
      <td><div class="item-cell"><img loading="lazy" src="https://www.torn.com/images/items/${item.item_id}/large.png" alt=""><div><div class="item-name">${escapeHtml(item.name)}</div><div class="item-type">${escapeHtml(item.type || 'Other')}${item.unmatched ? ` · <span class="warning">${item.unmatched} unmatched</span>` : ''}</div></div></div></td>
      <td>${item.last_activity ? new Date(item.last_activity).toLocaleDateString() : '—'}</td>
      <td>${num(item.bought)}</td><td>${money(item.purchase_cost)}</td><td>${num(item.sold)}</td>
      <td>${money(item.revenue)}</td><td>${money(item.fifo_cost)}</td><td class="${profitClass(item.profit)}">${money(item.profit)}</td>
      <td class="${profitClass(item.profit)}">${item.revenue ? (item.profit / item.revenue * 100).toFixed(1) + '%' : '—'}</td>
      <td>${num(item.remaining)}</td><td class="chevron">›</td></tr>`).join('');
    $('emptyState').style.display = state.items.length ? 'none' : 'block';
    $('loadMoreItems').classList.toggle('visible', state.items.length < state.total);
    document.querySelectorAll('#itemRows tr[data-id]').forEach(row => row.onclick = () => openItem(Number(row.dataset.id)));
    updateSortButtons('[data-item-sort]', itemPage);
    if (selected && detail) mountDetail(selected);
  }

  function updateSortButtons(selector, page) {
    document.querySelectorAll(selector).forEach(button => {
      const key = button.dataset.itemSort || button.dataset.lotSort;
      button.classList.toggle('active', key === page.sort);
      let arrow = button.querySelector('span');
      if (key === page.sort) {
        if (!arrow) { arrow = document.createElement('span'); button.append(' ', arrow); }
        arrow.textContent = page.direction === 'desc' ? '↓' : '↑';
      } else if (arrow) arrow.remove();
    });
  }

  async function openItem(itemId) {
    selected = itemId;
    tab = 'open';
    detail = null;
    $('itemDetail').classList.add('visible');
    renderItems();
    await loadLots(true);
    document.querySelector(`#itemRows tr[data-id="${itemId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function lotParams(offset) {
    return new URLSearchParams({
      lot_limit: lotPage.limit, lot_offset: offset, lot_sort: lotPage.sort,
      lot_direction: lotPage.direction, lot_status: tab,
    });
  }

  async function loadLots(reset = true) {
    if (!selected || lotPage.loading || tab === 'activity') return;
    lotPage.loading = true;
    $('loadMoreLots').textContent = 'Loading…';
    try {
      const offset = reset || !detail ? 0 : detail.lots.length;
      const response = await api(`/admin/api/trading-profit/items/${selected}?${lotParams(offset)}`);
      detail = reset || !detail ? response : { ...response, lots: detail.lots.concat(response.lots) };
      if (!document.querySelector('.detail-row')) mountDetail(selected);
      renderDetail();
    } finally {
      lotPage.loading = false;
      $('loadMoreLots').textContent = 'Load more lots';
    }
  }

  function sourceLabel(value) {
    return value.trade_id ? `Trade #${escapeHtml(value.trade_id)}` : escapeHtml((value.channel || 'other').replaceAll('_', ' '));
  }

  function renderDetail() {
    if (!detail) return;
    const item = detail.item;
    const row = state.items.find(value => value.item_id === selected) || {};
    $('detailImage').src = `https://www.torn.com/images/items/${item.item_id}/large.png`;
    $('detailName').textContent = item.name;
    $('detailMeta').textContent = `${item.type || 'Other'} · Item #${item.item_id}`;
    $('detailStats').innerHTML = [
      ['Bought', num(row.bought) + ' units', ''], ['Purchase cost', money(row.purchase_cost), ''],
      ['Sold', num(row.sold) + ' units', ''], ['Sales revenue', money(row.revenue), ''],
      ['FIFO cost', money(row.fifo_cost), ''],
      ['Realized profit', money(row.profit), profitClass(row.profit)],
      ['Margin', row.revenue ? (row.profit / row.revenue * 100).toFixed(1) + '%' : '—', profitClass(row.profit)],
      ['Open lots', detail.lotCounts.open, ''], ['Sold lots', detail.lotCounts.sold, ''],
      ['Remaining', num(row.remaining) + ' units', ''], ['Open basis', money(row.open_cost), ''],
    ].map(value => `<div class="mini-stat"><span>${value[0]}</span><strong class="${value[2]}">${value[1]}</strong></div>`).join('');
    $('openCount').textContent = detail.lotCounts.open;
    $('soldCount').textContent = detail.lotCounts.sold;
    $('convertedCount').textContent = detail.lotCounts.converted;
    $('allCount').textContent = detail.lotCounts.all;
    $('activityCount').textContent = detail.activity.length;
    document.querySelectorAll('.tabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    $('asOfNote').style.display = tab === 'open' ? 'block' : 'none';
    if (tab === 'activity') { renderActivity(); return; }

    $('lotHead').innerHTML = `<tr>
      <th><button class="sort-button active" data-lot-sort="date">Acquired</button></th><th>Status</th><th>Source</th>
      <th><button class="sort-button" data-lot-sort="original">Original</button></th><th>Sold</th><th>Converted</th><th>Other out</th>
      <th><button class="sort-button" data-lot-sort="remaining">Remaining</button></th>
      <th><button class="sort-button" data-lot-sort="unit_cost">Unit cost</button></th>
      <th><button class="sort-button" data-lot-sort="remaining_cost">Remaining cost</button></th><th>Revenue</th><th>Profit</th></tr>`;
    $('lotRows').innerHTML = detail.lots.map(lot => {
      const sold = lot.sales.filter(s => s.side === 'sell');
      const soldQty = sold.reduce((sum, sale) => sum + Number(sale.qty), 0);
      const convertedQty = lot.sales.filter(s => s.side === 'museum').reduce((sum, sale) => sum + Number(sale.qty), 0);
      const otherQty = lot.sales.filter(s => s.side === 'use').reduce((sum, sale) => sum + Number(sale.qty), 0);
      const revenue = sold.reduce((sum, sale) => sum + Number(sale.qty) * Number(sale.unit_revenue), 0);
      const profit = sold.reduce((sum, sale) => sum + Number(sale.profit), 0);
      const kinds = [soldQty, convertedQty, otherQty].filter(Boolean).length;
      const status = lot.qty_remaining ? (lot.qty_remaining === lot.qty_original ? 'Open' : 'Partial') :
        kinds > 1 ? 'Mixed' : convertedQty ? 'Converted' : soldQty ? 'Sold' : 'Depleted';
      return `<tr><td>${new Date(lot.acquired_at).toLocaleDateString()}</td><td><span class="status-pill status-${status.toLowerCase()}">${status}</span></td>
        <td>${sourceLabel(lot)}</td><td>${num(lot.qty_original)}</td><td>${num(soldQty)}</td><td>${num(convertedQty)}</td><td>${num(otherQty)}</td>
        <td>${num(lot.qty_remaining)}</td><td>${money(lot.unit_cost)}</td><td>${money(lot.qty_remaining * lot.unit_cost)}</td>
        <td>${soldQty ? money(revenue) : '—'}</td><td class="${profitClass(profit)}">${soldQty ? money(profit) : '—'}</td></tr>`;
    }).join('');
    $('loadMoreLots').classList.toggle('visible', detail.lots.length < detail.lotTotal);
    updateSortButtons('[data-lot-sort]', lotPage);
    document.querySelectorAll('[data-lot-sort]').forEach(button => button.onclick = () => setLotSort(button.dataset.lotSort));
  }

  function renderActivity() {
    $('lotHead').innerHTML = '<tr><th>Date ↓</th><th>Direction</th><th>Source</th><th>Qty</th><th>Unit price</th><th>Total</th><th>Cost status</th></tr>';
    $('lotRows').innerHTML = detail.activity.map(event => `<tr><td>${new Date(event.happened_at).toLocaleString()}</td>
      <td>${event.side === 'buy' ? 'Acquired' : event.side === 'museum' ? 'Museum conversion' : event.side === 'use' ? 'Other out' : 'Sold'}</td>
      <td>${sourceLabel(event)}</td><td>${num(event.qty)}</td><td>${['museum', 'use'].includes(event.side) ? '—' : money(event.unit_price)}</td>
      <td>${['museum', 'use'].includes(event.side) ? '—' : money(event.total_price)}</td><td class="${event.unmatched_qty ? 'warning' : ''}">${event.unmatched_qty ? event.unmatched_qty + ' unmatched' : 'Matched'}</td></tr>`).join('');
    $('loadMoreLots').classList.remove('visible');
  }

  function setItemSort(sort) {
    if (itemPage.sort === sort) itemPage.direction = itemPage.direction === 'desc' ? 'asc' : 'desc';
    else { itemPage.sort = sort; itemPage.direction = sort === 'item' ? 'asc' : 'desc'; }
    loadItems(true);
  }

  function setLotSort(sort) {
    if (lotPage.sort === sort) lotPage.direction = lotPage.direction === 'desc' ? 'asc' : 'desc';
    else { lotPage.sort = sort; lotPage.direction = 'desc'; }
    loadLots(true);
  }

  function closeDetail() {
    parkDetail();
    $('itemDetail').classList.remove('visible');
    selected = null;
    detail = null;
    renderItems();
  }

  function preset(value) {
    const date = new Date();
    const to = date.toISOString().slice(0, 10);
    let from = '';
    if (value === 'month') from = to.slice(0, 8) + '01';
    else if (value !== 'all') { date.setDate(date.getDate() - Number(value)); from = date.toISOString().slice(0, 10); }
    $('dateFrom').value = from;
    $('dateTo').value = value === 'all' ? '' : to;
    document.querySelectorAll('.date-presets button').forEach(button => button.classList.toggle('selected', button.dataset.days === value));
    loadItems(true);
  }

  let searchTimer;
  $('itemSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadItems(true), 250); };
  $('dateFrom').onchange = $('dateTo').onchange = () => loadItems(true);
  $('categoryFilter').onchange = () => loadItems(true);
  $('currentLotsOnly').onchange = () => loadItems(true);
  document.querySelectorAll('.date-presets button').forEach(button => button.onclick = () => preset(button.dataset.days));
  document.querySelectorAll('[data-item-sort]').forEach(button => button.onclick = () => setItemSort(button.dataset.itemSort));
  document.querySelectorAll('.tabs button').forEach(button => button.onclick = async () => {
    tab = button.dataset.tab;
    if (tab === 'activity') renderDetail(); else await loadLots(true);
  });
  $('loadMoreItems').onclick = () => loadItems(false);
  $('loadMoreLots').onclick = () => loadLots(false);
  $('resetFilters').onclick = () => { $('itemSearch').value = ''; $('categoryFilter').value = ''; $('currentLotsOnly').checked = true; itemPage.sort = 'date'; itemPage.direction = 'desc'; preset('30'); };
  $('closeDetail').onclick = closeDetail;
  $('rebuildLedger').onclick = async () => {
    const button = $('rebuildLedger'); button.disabled = true; button.textContent = 'Rebuilding…';
    try { const response = await api('/admin/api/trading-profit/rebuild', { method: 'POST' }); button.textContent = `Rebuilt ${response.events} events`; await loadItems(true); }
    catch (error) { button.textContent = error.message; }
    finally { setTimeout(() => { button.disabled = false; button.textContent = 'Rebuild ledger'; }, 2500); }
  };

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting || !entry.target.classList.contains('visible')) return;
      if (entry.target.id === 'loadMoreItems') loadItems(false); else loadLots(false);
    }), { rootMargin: '200px' });
    observer.observe($('loadMoreItems'));
    observer.observe($('loadMoreLots'));
  }

  loadCategories().then(() => preset('30')).catch(error => {
    $('itemRows').innerHTML = `<tr><td colspan="11" class="negative">${escapeHtml(error.message)}</td></tr>`;
  });
})();
