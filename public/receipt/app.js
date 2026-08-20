(async () => {
  const id = window.location.pathname.replace(/^\/receipt\/?/, '').split('/')[0];
  if (!id) return showError('No receipt ID in URL.');

  let pollTimer = null;

  async function load() {
    try {
      const res = await fetch(`/api/receipt/${id}`);
      if (!res.ok) return showError(res.status === 404 ? 'Receipt not found.' : `Error ${res.status}`);
      const data = await res.json();
      render(data);
      if (data.status === 'pending') {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(load, 10000);
      } else {
        clearTimeout(pollTimer);
      }
    } catch (e) {
      showError('Failed to load receipt.');
    }
  }

  function fmt(n) {
    if (n == null) return '—';
    return '$' + Number(n).toLocaleString();
  }

  function pct(v) {
    if (v == null) return null;
    return (Number(v) * 100).toFixed(1).replace(/\.0$/, '') + '%';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function render(r) {
    document.getElementById('skeleton').style.display = 'none';
    document.getElementById('receiptContent').classList.remove('hidden');

    document.getElementById('receiptTradeId').textContent = `#${r.trade_id}`;
    document.getElementById('buyerName').textContent  = r.buyer_name  || `Player #${r.buyer_id}`  || '—';
    document.getElementById('sellerName').textContent = r.seller_name || `Player #${r.seller_id}` || '—';
    document.getElementById('createdAt').textContent  = fmtDate(r.created_at);

    // Status
    const pill = document.getElementById('statusPill');
    const statusText = document.getElementById('statusText');
    pill.className = 'status-pill ' + r.status;
    statusText.textContent = r.status === 'completed' ? 'Completed' : 'In Progress';

    if (r.completed_at) {
      document.getElementById('completedSep').style.display   = '';
      document.getElementById('completedLabel').style.display = '';
      document.getElementById('completedAt').style.display    = '';
      document.getElementById('completedAt').textContent = fmtDate(r.completed_at);
    }

    // Items
    const items = Array.isArray(r.items) ? r.items : [];
    document.getElementById('itemsCount').textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;

    const tbody = document.getElementById('itemsBody');
    tbody.innerHTML = '';
    for (const item of items) {
      const tr = document.createElement('tr');
      const imgSrc = `https://www.torn.com/images/items/${item.torn_item_id}/large.png`;

      const pctBadge = item.in_catalog && item.price_mode === 'market_pct' && item.resolved_pct
        ? `<span class="pct-badge">${pct(item.resolved_pct)}</span>` : '';
      const notInCatalog = !item.in_catalog && item.resolved_pct
        ? `<span class="pct-badge">${pct(item.resolved_pct)}</span>` : '';

      let adjustBadge = '';
      if (item.catalog_price != null && item.effective_price != null && item.effective_price !== item.catalog_price) {
        const delta = item.effective_price - item.catalog_price;
        const deltaPct = Math.abs((delta / item.catalog_price) * 100).toFixed(1);
        if (delta > 0) {
          adjustBadge = `<span class="adjust-badge discount">↑ +${deltaPct}% bonus</span>`;
        } else {
          adjustBadge = `<span class="adjust-badge markup">↓ −${deltaPct}% below rate</span>`;
        }
      }

      tr.innerHTML = `
        <td>
          <div class="item-cell">
            <img class="item-icon" src="${imgSrc}" alt="" onerror="this.style.display='none'">
            <div class="item-text">
              <div class="item-name">${item.item_name}</div>
              ${item.item_type ? `<div class="item-type">${item.item_type}</div>` : ''}
            </div>
          </div>
        </td>
        <td class="col-num">${item.quantity}</td>
        <td class="col-num price-cell">${item.market_price != null ? fmt(item.market_price) : '—'}</td>
        <td class="col-num price-cell">
          <span class="price-val-wrap">${item.effective_price != null ? fmt(item.effective_price) : '—'}${pctBadge}${notInCatalog}${adjustBadge}</span>
        </td>
        <td class="col-num price-cell total-cell">
          ${item.effective_total != null ? fmt(item.effective_total) : '—'}
        </td>
      `;
      tbody.appendChild(tr);
    }

    // Total row
    const tfoot = document.getElementById('itemsFoot');
    tfoot.innerHTML = `
      <tr class="total-row">
        <td colspan="4" class="total-label">Total</td>
        <td class="col-num price-cell total-value">${fmt(r.total_value)}</td>
      </tr>
    `;

    // Explanation
    buildExplanation(items);
  }

  function buildExplanation(items) {
    const card = document.getElementById('explainCard');
    const body = document.getElementById('explainBody');
    if (!items.length) { card.style.display = 'none'; return; }

    const modeGroups = {};
    for (const item of items) {
      const key = item.price_mode === 'fixed'
        ? 'fixed'
        : item.resolved_pct != null ? pct(item.resolved_pct) + '_market' : 'unknown';
      if (!modeGroups[key]) modeGroups[key] = { items: [], mode: item.price_mode, pct: item.resolved_pct, unlisted: [] };
      if (item.in_catalog) modeGroups[key].items.push(item.item_name);
      else                 modeGroups[key].unlisted.push(item.item_name);
    }

    const lines = [];
    for (const [, g] of Object.entries(modeGroups)) {
      const allNames = [...g.items, ...g.unlisted];
      if (!allNames.length) continue;
      if (g.mode === 'fixed') {
        lines.push(`<li><strong>Fixed price</strong>: ${allNames.join(', ')}</li>`);
      } else if (g.pct != null) {
        lines.push(`<li><strong>${pct(g.pct)} of current market price</strong>: ${allNames.join(', ')}</li>`);
      } else {
        lines.push(`<li class="muted"><strong>No price data</strong>: ${allNames.join(', ')}</li>`);
      }
    }

    body.innerHTML = `<ul>${lines.join('')}</ul>`;
  }

  function showError(msg) {
    document.getElementById('skeleton').style.display = 'none';
    const el = document.getElementById('errorState');
    el.classList.remove('hidden');
    document.getElementById('errorMsg').textContent = msg;
  }

  await load();
})();
