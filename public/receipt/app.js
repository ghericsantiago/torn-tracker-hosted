(async () => {
  const id = window.location.pathname.replace(/^\/receipt\/?/, '').split('/')[0];
  if (!id) return showError('No receipt ID in URL.');

  let pollTimer = null;
  let marketChart = null;
  let chartLoadToken = 0;
  const helpTooltip = document.createElement('div');
  helpTooltip.className = 'receipt-help-tooltip hidden';
  helpTooltip.setAttribute('role', 'tooltip');
  document.body.appendChild(helpTooltip);

  function showHelpTooltip(target) {
    helpTooltip.textContent = target.dataset.help || '';
    helpTooltip.classList.remove('hidden');

    const anchor = target.getBoundingClientRect();
    const tip = helpTooltip.getBoundingClientRect();
    const gap = 8;
    const margin = 8;
    const left = Math.min(
      window.innerWidth - tip.width - margin,
      Math.max(margin, anchor.left + anchor.width / 2 - tip.width / 2)
    );
    const fitsAbove = anchor.top >= tip.height + gap + margin;
    const top = fitsAbove
      ? anchor.top - tip.height - gap
      : anchor.bottom + gap;

    helpTooltip.style.left = `${left}px`;
    helpTooltip.style.top = `${Math.min(
      window.innerHeight - tip.height - margin,
      Math.max(margin, top)
    )}px`;
  }

  function hideHelpTooltip() {
    helpTooltip.classList.add('hidden');
  }

  document.addEventListener('mouseover', event => {
    const target = event.target.closest('.protection-help');
    if (target && !target.contains(event.relatedTarget)) showHelpTooltip(target);
  });
  document.addEventListener('mouseout', event => {
    const target = event.target.closest('.protection-help');
    if (target && !target.contains(event.relatedTarget)) hideHelpTooltip();
  });
  document.addEventListener('focusin', event => {
    const target = event.target.closest('.protection-help');
    if (target) showHelpTooltip(target);
  });
  document.addEventListener('focusout', event => {
    if (event.target.closest('.protection-help')) hideHelpTooltip();
  });
  window.addEventListener('scroll', hideHelpTooltip, true);
  window.addEventListener('resize', hideHelpTooltip);

  const chartOverlay = document.getElementById('marketChartOverlay');
  const chartTitle = document.getElementById('marketChartTitle');
  const chartMeta = document.getElementById('marketChartMeta');
  const chartMessage = document.getElementById('marketChartMessage');
  const chartClose = document.getElementById('marketChartClose');

  function closeMarketChart() {
    chartLoadToken += 1;
    chartOverlay.classList.add('hidden');
    document.body.classList.remove('chart-open');
  }

  chartClose.addEventListener('click', closeMarketChart);
  chartOverlay.addEventListener('click', event => {
    if (event.target === chartOverlay) closeMarketChart();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !chartOverlay.classList.contains('hidden')) closeMarketChart();
  });

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
    // PoorMe is always the buyer — detect which DB field they landed in
    const poorMeIsSeller = r.seller_name === 'PoorMe';
    const buyerDisplay  = poorMeIsSeller ? (r.seller_name || `Player #${r.seller_id}`) : (r.buyer_name  || `Player #${r.buyer_id}`);
    const sellerDisplay = poorMeIsSeller ? (r.buyer_name  || `Player #${r.buyer_id}`)  : (r.seller_name || `Player #${r.seller_id}`);
    document.getElementById('buyerName').textContent  = buyerDisplay  || '—';
    document.getElementById('sellerName').textContent = sellerDisplay || '—';
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
      const chartButton = item.market_protection_applied
        ? `<button class="receipt-chart-btn" type="button" aria-label="Show market graph" title="Show market graph">&#128200;</button>`
        : '';

      let adjustBadge = item.market_protection_applied
        ? `<span class="protection-help" tabindex="0" role="img"
            aria-label="Market price protection applied"
            data-help="The median of the day's densest 1% lowest-market price band is below market value, so this offer was calculated from that supported price.">
            <svg class="protection-shield" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2.5 20 6v5.3c0 5.1-3.2 8.6-8 10.2-4.8-1.6-8-5.1-8-10.2V6l8-3.5Z" />
              <path d="m8.7 12 2.1 2.1 4.6-4.7" />
            </svg>
          </span>`
        : '';
      if (!item.market_protection_applied && item.catalog_price != null && item.effective_price != null && item.effective_price !== item.catalog_price) {
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
              <div class="item-name-row"><div class="item-name">${item.item_name}</div>${chartButton}</div>
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
      const graphButton = tr.querySelector('.receipt-chart-btn');
      if (graphButton) {
        graphButton.setAttribute('aria-label', `Show market graph for ${item.item_name}`);
        graphButton.addEventListener('click', () => openMarketChart(item));
      }
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
      if (item.market_protection_applied) continue;
      const key = item.price_mode === 'fixed'
        ? 'fixed'
        : item.resolved_pct != null ? pct(item.resolved_pct) + '_market' : 'unknown';
      if (!modeGroups[key]) modeGroups[key] = { items: [], mode: item.price_mode, pct: item.resolved_pct, unlisted: [] };
      if (item.in_catalog) modeGroups[key].items.push(item.item_name);
      else                 modeGroups[key].unlisted.push(item.item_name);
    }

    const protectionRows = [];
    const protectedItems = items.filter(item => item.market_protection_applied);
    for (const item of protectedItems) {
      const rate = pct(item.resolved_pct) || 'configured rate';
      const drop = item.market_drop_pct != null
        ? Number(item.market_drop_pct).toFixed(1).replace(/\.0$/, '') + '%'
        : 'below market value';
      const protectedLowest = item.protection_lowest_price ?? item.market_reference_price ?? item.latest_lowest_price;
      const protectedMarketValue = item.protection_market_value ?? item.market_price;
      const referenceDate = item.market_reference_date
        ? String(item.market_reference_date).slice(0, 10)
        : 'the most recent tracked day';
      const sampleText = item.market_reference_samples
        ? ` It was recorded ${item.market_reference_samples} time${Number(item.market_reference_samples) === 1 ? '' : 's'} on ${referenceDate}.`
        : ` It came from ${referenceDate}.`;
      const protectionHelp = `Frequent support is the median of the densest 1% lowest-market price band during the selected tracking day.${sampleText} ` +
        `Because ${fmt(protectedLowest)} was ${drop} below Torn market value ${fmt(protectedMarketValue)}, the ${rate} buy rate was applied to support instead of market value. ` +
        `That changed the unit offer from ${fmt(item.unprotected_price)} to ${fmt(item.effective_price)}.`;
      protectionRows.push(
        `<div class="calc-row">
          <span class="protection-help calc-help" tabindex="0" role="img" aria-label="Detailed market protection explanation" data-help="${protectionHelp}">
            <svg class="calc-shield" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 20 6v5.3c0 5.1-3.2 8.6-8 10.2-4.8-1.6-8-5.1-8-10.2V6l8-3.5Z"/><path d="m8.7 12 2.1 2.1 4.6-4.7"/></svg>
          </span>
          <strong class="calc-item">${item.item_name}</strong>
          <span class="calc-step"><small>Market</small>${fmt(protectedMarketValue)}</span>
          <span class="calc-arrow">→</span>
          <span class="calc-step support"><small>Support · −${drop}</small>${fmt(protectedLowest)}</span>
          <span class="calc-arrow">→</span>
          <span class="calc-step offer"><small>${rate} offer</small>${fmt(item.effective_price)}</span>
          <span class="calc-was">was ${fmt(item.unprotected_price)}</span>
        </div>`
      );
    }
    const ruleChips = [];
    for (const [, g] of Object.entries(modeGroups)) {
      const allNames = [...g.items, ...g.unlisted];
      if (!allNames.length) continue;
      if (g.mode === 'fixed') {
        ruleChips.push(`<span class="rule-chip"><strong>Fixed</strong>${allNames.join(', ')}</span>`);
      } else if (g.pct != null) {
        ruleChips.push(`<span class="rule-chip"><strong>${pct(g.pct)}</strong>${allNames.join(', ')}</span>`);
      } else {
        ruleChips.push(`<span class="rule-chip muted"><strong>No price</strong>${allNames.join(', ')}</span>`);
      }
    }

    body.innerHTML = `${protectionRows.length ? `<div class="calc-list">${protectionRows.join('')}</div>` : ''}${ruleChips.length ? `<div class="rule-chips">${ruleChips.join('')}</div>` : ''}`;
  }

  function trackingDayBounds(value) {
    const day = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const start = new Date(`${day}T00:00:00+08:00`);
    if (Number.isNaN(start.getTime())) return null;
    return {
      day,
      from: start.toISOString(),
      to: new Date(start.getTime() + 86400000 - 1).toISOString(),
    };
  }

  function chartTime(iso) {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila', hour12: false,
    });
  }

  async function openMarketChart(item) {
    const bounds = trackingDayBounds(item.market_reference_date);
    chartTitle.textContent = item.item_name;
    chartMeta.textContent = bounds
      ? `${bounds.day} · Asia/Manila · ${item.market_reference_samples || 0} support-band sample${Number(item.market_reference_samples) === 1 ? '' : 's'}`
      : 'Most recent tracked market data';
    chartMessage.textContent = 'Loading market history…';
    chartMessage.classList.remove('hidden');
    chartOverlay.classList.remove('hidden');
    document.body.classList.add('chart-open');
    chartClose.focus();

    const token = ++chartLoadToken;
    const query = bounds
      ? `?from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}&limit=5000`
      : '?limit=5000';

    try {
      const response = await fetch(`/api/market/${item.torn_item_id}${query}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();
      if (token !== chartLoadToken) return;
      const observations = (Array.isArray(rows) ? rows : []).filter(row => Number(row.price) > 0);
      if (!observations.length) {
        if (marketChart) marketChart.destroy();
        marketChart = null;
        chartMessage.textContent = 'No market observations are available for this tracking day.';
        return;
      }

      const labels = observations.map(row => chartTime(row.created_at));
      const lowestOffers = observations.map(row => Number(row.price));
      const support = Number(item.protection_lowest_price ?? item.market_reference_price);
      const marketValue = Number(item.protection_market_value ?? item.market_price);
      const repeated = value => observations.map(() => Number.isFinite(value) && value > 0 ? value : null);

      if (marketChart) marketChart.destroy();
      marketChart = new window.Chart(document.getElementById('marketChartCanvas').getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Lowest Offer', data: lowestOffers,
              borderColor: '#6ee7f7', backgroundColor: 'rgba(110,231,247,.07)',
              pointRadius: observations.length > 150 ? 1 : 3,
              pointHoverRadius: 6, borderWidth: 2, tension: .2, fill: true,
            },
            {
              label: 'Frequent Support', data: repeated(support),
              borderColor: '#f87171', pointRadius: 0, borderWidth: 2, tension: 0,
            },
            {
              label: 'Torn Market Value', data: repeated(marketValue),
              borderColor: 'rgba(148,163,184,.65)', borderDash: [5, 4],
              pointRadius: 0, borderWidth: 1.5, tension: 0,
            },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: '#94a3b8', boxWidth: 16, font: { size: 10 } } },
            tooltip: { callbacks: { label: context => `${context.dataset.label}: ${fmt(context.parsed.y)}` } },
          },
          scales: {
            x: {
              ticks: { color: '#64748b', maxRotation: 0, maxTicksLimit: 10, font: { size: 10 } },
              grid: { color: 'rgba(255,255,255,.05)' },
            },
            y: {
              ticks: { color: '#94a3b8', font: { size: 10 }, callback: value => fmt(value) },
              grid: { color: 'rgba(255,255,255,.05)' },
            },
          },
        },
      });
      chartMessage.classList.add('hidden');
    } catch (_error) {
      if (token !== chartLoadToken) return;
      chartMessage.textContent = 'Failed to load market history.';
      chartMessage.classList.remove('hidden');
    }
  }

  function showError(msg) {
    document.getElementById('skeleton').style.display = 'none';
    const el = document.getElementById('errorState');
    el.classList.remove('hidden');
    document.getElementById('errorMsg').textContent = msg;
  }

  await load();
})();
