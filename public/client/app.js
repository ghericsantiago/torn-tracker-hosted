(function () {
  'use strict';

  // ── State ──
  let currentItemId  = null;
  let currentData    = [];
  let activeChart    = null;
  let chartType      = 'line';
  let timeframe      = '30m';
  let autoRefresh    = null;

  const tfBucketMs = {
    '1m': 60000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, 'day': 86400000,
  };

  // ── Chart.js setup ──
  const ctx    = document.getElementById('priceChart');
  const status = document.getElementById('chartStatus');

  function showStatus(msg) {
    status.textContent = msg;
    status.classList.remove('hidden');
    ctx.style.display = 'none';
    document.getElementById('candlestickChart').style.display = 'none';
  }
  function hideStatus() {
    status.classList.add('hidden');
  }

  function aggregateByTF(rows) {
    const ms = tfBucketMs[timeframe] || 1800000;
    const buckets = new Map();
    rows.forEach(r => {
      const t = Math.floor(new Date(r.created_at).getTime() / ms) * ms;
      if (!buckets.has(t)) buckets.set(t, []);
      buckets.get(t).push(r);
    });
    return Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([t, recs]) => {
      const last = recs[recs.length - 1];
      return {
        created_at:    new Date(t).toISOString(),
        price:         Number(last.price),
        average_price: recs.reduce((s, r) => s + Number(r.average_price), 0) / recs.length,
        quantity:      Number(last.quantity),
      };
    });
  }

  function buildChartDatasets(rows) {
    const lowestOffer = rows.map(r => ({ x: new Date(r.created_at), y: Number(r.price) }));
    const avgPrice    = rows.map(r => ({ x: new Date(r.created_at), y: Number(r.average_price) }));
    const quantity    = rows.map(r => ({ x: new Date(r.created_at), y: Number(r.quantity) }));
    return { lowestOffer, avgPrice, quantity };
  }

  function renderChart(rows) {
    if (!rows.length) { showStatus('No data for selected filters'); return; }
    hideStatus();

    if (chartType === 'candlestick') {
      renderCandlestick(rows);
      return;
    }

    document.getElementById('candlestickChart').style.display = 'none';
    ctx.style.display = 'block';

    if (activeChart) activeChart.destroy();

    const { lowestOffer, avgPrice, quantity } = buildChartDatasets(aggregateByTF(rows));
    const isBar     = chartType === 'bar';
    const isScatter = chartType === 'scatter';

    activeChart = new Chart(ctx, {
      type: isScatter ? 'scatter' : 'line',
      data: {
        datasets: [
          {
            label: 'Lowest Offer',
            data:  lowestOffer,
            yAxisID: 'y',
            borderColor:     '#6ee7f7',
            backgroundColor: isBar ? 'rgba(110,231,247,0.25)' : 'rgba(110,231,247,0.08)',
            borderWidth: 2,
            pointRadius:      isScatter ? 4 : 3,
            pointHoverRadius: 6,
            fill: !isBar && !isScatter,
            tension: 0.3,
            type: isBar ? 'bar' : 'line',
            order: 1,
          },
          {
            label: 'Market Value (Avg)',
            data:  avgPrice,
            yAxisID: 'y',
            borderColor:     '#818cf8',
            backgroundColor: 'rgba(129,140,248,0.0)',
            borderWidth: 2,
            borderDash: [6, 3],
            pointRadius:      isScatter ? 3 : 0,
            pointHoverRadius: 5,
            fill: false,
            tension: 0.3,
            type: 'line',
            order: 0,
          },
          {
            label: 'Quantity',
            data:  quantity,
            yAxisID: 'yQty',
            type: 'line',
            borderColor:     'rgba(251,191,36,0.5)',
            backgroundColor: 'rgba(251,191,36,0.08)',
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 3,
            fill: 'origin',
            tension: 0.3,
            order: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              color: '#94a3b8',
              font: { size: 11 },
              boxWidth: 24,
              padding: 16,
              usePointStyle: true,
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                if (ctx.dataset.label === 'Quantity')
                  return `Quantity: ${Number(ctx.parsed.y).toLocaleString()}`;
                return `${ctx.dataset.label}: $${Number(ctx.parsed.y).toLocaleString()}`;
              },
            },
          },
          zoom: {
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
            pan:  { enabled: true, mode: 'x' },
          },
        },
        scales: {
          x: {
            type: 'time',
            ticks: { color: '#64748b', maxTicksLimit: 8 },
            grid:  { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            position: 'left',
            ticks: {
              color: '#64748b',
              callback: v => '$' + Number(v).toLocaleString(),
            },
            grid: { color: 'rgba(255,255,255,0.04)' },
          },
          yQty: {
            position: 'right',
            min: 0,
            max: Math.max(...quantity.map(p => p.y), 1) * 5,
            grid: { drawOnChartArea: false },
            ticks: {
              color: 'rgba(251,191,36,0.55)',
              maxTicksLimit: 4,
              callback: (v) => {
                const maxQty = Math.max(...quantity.map(p => p.y), 1);
                return v <= maxQty ? Number(v).toLocaleString() : null;
              },
            },
          },
        },
        onClick: (e, elements) => {
          if (!elements.length) return;
          const el = elements[0];
          // ignore clicks on the quantity bars
          if (el.datasetIndex === 2) return;
          const clickedPrice = el.datasetIndex === 0
            ? lowestOffer[el.index]?.y
            : avgPrice[el.index]?.y;
          if (!clickedPrice) return;

          const buyEl    = document.getElementById('buyPrice');
          const targetEl = document.getElementById('targetPrice');
          const buy    = parseFloat(buyEl.value)    || 0;
          const target = parseFloat(targetEl.value) || 0;

          if (target && buy) {
            if (clickedPrice > target)      targetEl.value = clickedPrice;
            else if (clickedPrice < buy)    buyEl.value    = clickedPrice;
            else                            buyEl.value    = clickedPrice;
          } else if (buy && !target) {
            if (clickedPrice > buy)  targetEl.value = clickedPrice;
            else { targetEl.value = buyEl.value; buyEl.value = clickedPrice; }
          } else {
            buyEl.value = clickedPrice;
          }

          autoCalc = !target;
          updateBreakEven();
          calcProfit();
        },
      },
    });
  }

  function renderCandlestick(rows) {
    ctx.style.display = 'none';
    const div = document.getElementById('candlestickChart');
    div.style.display = 'block';
    if (activeChart) { activeChart.destroy(); activeChart = null; }

    // Group into OHLC buckets client-side
    const bucketMs = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, 'day': 86400000 };
    const ms = bucketMs[timeframe] || 1800000;
    const buckets = {};
    rows.forEach(r => {
      const t = Math.floor(new Date(r.created_at).getTime() / ms) * ms;
      if (!buckets[t]) buckets[t] = [];
      buckets[t].push(Number(r.price));
    });
    const chartData = Object.entries(buckets).sort((a,b) => a[0]-b[0]).map(([t, prices]) => ({
      date:  new Date(Number(t)).toISOString(),
      open:  prices[0],
      high:  Math.max(...prices),
      low:   Math.min(...prices),
      close: prices[prices.length - 1],
    }));

    AmCharts.useUTC = false;
    AmCharts.makeChart('candlestickChart', {
      type: 'serial',
      theme: 'dark',
      dataProvider: chartData,
      categoryField: 'date',
      categoryAxis: { parseDates: true, minPeriod: 'mm', color: '#64748b' },
      valueAxes: [{ color: '#64748b', labelFunction: v => '$' + Number(v).toLocaleString() }],
      graphs: [{
        type: 'candlestick',
        openField: 'open', closeField: 'close',
        highField: 'high', lowField: 'low',
        lineColor: '#4ade80', negativeFillColors: '#f87171', negativeLineColor: '#f87171',
        fillAlphas: 1, lineAlpha: 1,
        balloonText: 'O: $[[open]]<br>H: $[[high]]<br>L: $[[low]]<br>C: $[[close]]',
      }],
      chartScrollbar: { enabled: true, scrollbarHeight: 20 },
      chartCursor: { enabled: true, categoryBalloonEnabled: true },
      balloon: { color: '#07080f' },
      backgroundColor: 'transparent',
      backgroundAlpha: 0,
    });
  }

  function updateTable(rows) {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = rows.slice().reverse().slice(0, 200).map(r => `
      <tr>
        <td>${new Date(r.created_at).toLocaleString()}</td>
        <td>${r.item_id}</td>
        <td>${r.name || '—'}</td>
        <td>$${Number(r.average_price).toLocaleString()}</td>
        <td>$${Number(r.price).toLocaleString()}</td>
        <td>${r.quantity}</td>
      </tr>
    `).join('');
  }

  // ── Fetch market data ──
  async function fetchData() {
    if (!currentItemId) return;

    const from     = getDatetime('startDate', 'startTime');
    const to       = getDatetime('endDate',   'endTime');
    const params   = new URLSearchParams({ limit: 2000 });
    if (from) params.set('from', from);
    if (to)   params.set('to',   to);

    showStatus('Loading…');
    try {
      const res  = await fetch(`/api/market/${currentItemId}?${params}`);
      const rows = await res.json();
      currentData = rows;
      renderChart(rows);
      updateTable(rows);
      if (rows.length) {
        const last = rows[rows.length - 1];
        document.getElementById('displayName').textContent  = last.name || `Item #${currentItemId}`;
        document.getElementById('displayPrice').textContent = `$${Number(last.price).toLocaleString()} · ${new Date(last.created_at).toLocaleString()}`;
      }
    } catch (e) {
      showStatus('Failed to load data');
    }
  }

  // ── Best items (sortable) ──
  let bestItems = [];
  let bestSort  = { col: 'net_profit', dir: 'desc' };

  function renderBestItems() {
    const el = document.getElementById('bestItemsList');
    if (!bestItems.length) { el.innerHTML = '<div class="loading-msg">No profitable items found yet</div>'; return; }

    const { col, dir } = bestSort;
    const sorted = [...bestItems].sort((a, b) => {
      const av = col === 'name' ? String(a[col]).toLowerCase() : Number(a[col]);
      const bv = col === 'name' ? String(b[col]).toLowerCase() : Number(b[col]);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === 'asc' ? cmp : -cmp;
    });

    el.innerHTML = sorted.map(item => {
      const m = Number(item.margin_pct);
      const c = Number(item.confidence_pct);
      const marginClass = m >= 15 ? 'best-item-margin high'
                        : m >=  5 ? 'best-item-margin mid'
                        :           'best-item-margin';
      const confClass = c >= 80 ? 'bi-conf high'
                      : c >= 50 ? 'bi-conf mid'
                      :           'bi-conf low';
      return `
        <div class="best-item-row"
          title="Buy avg $${Number(item.buy_target).toLocaleString()} → Sell avg $${Number(item.sell_target).toLocaleString()} · ${item.swing_days}/7 days with price movement"
          onclick="selectItem(${item.item_id}, '${(item.name || '').replace(/'/g, "\\'")}')">
          <span class="best-item-name">${item.name}</span>
          <span class="best-item-price">$${Number(item.net_profit).toLocaleString()}</span>
          <span class="${marginClass}">+${m}%</span>
          <span class="${confClass}">${c}%</span>
        </div>`;
    }).join('');

    // Update sort icons
    document.querySelectorAll('.bi-sort').forEach(el => {
      const icon = el.querySelector('.bi-sort-icon');
      if (el.dataset.col === col) {
        el.classList.add('bi-sorted');
        icon.textContent = dir === 'asc' ? '↑' : '↓';
      } else {
        el.classList.remove('bi-sorted');
        icon.textContent = '↕';
      }
    });
  }

  async function loadBestItems() {
    const btn = document.getElementById('refreshBestBtn');
    if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
    try {
      const rawFee = parseFloat(document.getElementById('txFee').value);
      const fee = isNaN(rawFee) ? 5 : rawFee;
      const res = await fetch(`/api/best-items?fee=${fee}`);
      bestItems = await res.json();
      renderBestItems();
    } catch (e) {
      document.getElementById('bestItemsList').innerHTML = '<div class="loading-msg">Failed to load</div>';
    } finally {
      if (btn) { btn.classList.remove('spinning'); btn.disabled = false; }
    }
  }

  document.querySelectorAll('.bi-sort').forEach(el => {
    el.addEventListener('click', () => {
      const col = el.dataset.col;
      bestSort = col === bestSort.col
        ? { col, dir: bestSort.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: col === 'name' ? 'asc' : 'desc' };
      renderBestItems();
    });
  });

  // ── Item selection ──
  window.selectItem = function (id, name) {
    currentItemId = id;
    document.getElementById('itemSearch').value   = name || '';
    document.getElementById('itemIdInput').value  = id;
    document.getElementById('displayName').textContent = name || `Item #${id}`;
    document.getElementById('autocomplete').classList.add('hidden');
    fetchData();
  };

  // ── Autocomplete ──
  let acTimeout;
  document.getElementById('itemSearch').addEventListener('input', function () {
    clearTimeout(acTimeout);
    const q = this.value.trim();
    const ac = document.getElementById('autocomplete');
    if (!q) { ac.classList.add('hidden'); return; }
    acTimeout = setTimeout(async () => {
      const res   = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const items = await res.json();
      if (!items.length) { ac.classList.add('hidden'); return; }
      ac.innerHTML = items.map(i =>
        `<div class="autocomplete-item" onclick="selectItem(${i.item_id}, '${(i.name || '').replace(/'/g, "\\'")}')">
          ${i.name} <span style="color:var(--text-muted);font-size:0.7em">#${i.item_id}</span>
        </div>`
      ).join('');
      ac.classList.remove('hidden');
    }, 250);
  });

  document.getElementById('itemIdInput').addEventListener('change', function () {
    const id = parseInt(this.value);
    if (id) selectItem(id, `Item #${id}`);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) {
      document.getElementById('autocomplete').classList.add('hidden');
    }
  });

  // ── Filters ──
  function getDatetime(dateId, timeId) {
    const d = document.getElementById(dateId).value;
    const t = document.getElementById(timeId).value || '00:00';
    return d ? `${d}T${t}:00` : '';
  }

  document.getElementById('applyFilters').addEventListener('click', fetchData);

  document.getElementById('resetFilters').addEventListener('click', () => {
    ['startDate','endDate','startTime','endTime'].forEach(id => {
      document.getElementById(id).value = id === 'startTime' ? '00:00' : id === 'endTime' ? '23:59' : '';
    });
    fetchData();
  });

  document.getElementById('prevDay').addEventListener('click', () => shiftDay(-1));
  document.getElementById('nextDay').addEventListener('click', () => shiftDay(1));
  function shiftDay(d) {
    const dt = new Date(document.getElementById('startDate').value || Date.now());
    dt.setDate(dt.getDate() + d);
    const s = dt.toISOString().slice(0, 10);
    document.getElementById('startDate').value = s;
    document.getElementById('endDate').value   = s;
    fetchData();
  }

  // ── Timeframe buttons ──
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      timeframe = this.dataset.tf;
      if (currentData.length) renderChart(currentData);
    });
  });

  // ── Chart type tabs ──
  document.querySelectorAll('.ct-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.ct-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      chartType = this.dataset.ct;
      if (currentData.length) renderChart(currentData);
    });
  });

  // ── Data table toggle ──
  document.getElementById('toggleTable').addEventListener('click', function () {
    const el = document.getElementById('dataTable');
    const hidden = el.classList.toggle('hidden');
    this.textContent = hidden ? 'Show Data Table' : 'Hide Data Table';
  });

  // ── Auto-refresh ──
  document.getElementById('autoRefreshToggle').addEventListener('click', function () {
    if (autoRefresh) {
      clearInterval(autoRefresh);
      autoRefresh = null;
      this.textContent = 'Auto-Refresh: Off';
      this.classList.remove('btn-primary');
      this.classList.add('btn-ghost');
    } else {
      autoRefresh = setInterval(fetchData, 60000);
      this.textContent = 'Auto-Refresh: On';
      this.classList.remove('btn-ghost');
      this.classList.add('btn-primary');
    }
  });

  // ── Profit Calculator ──
  let autoCalc = true;

  function updateBreakEven() {
    if (!autoCalc) return;
    const buy = parseFloat(document.getElementById('buyPrice').value) || 0;
    const fee = parseFloat(document.getElementById('txFee').value)    || 0;
    const breakEven = fee < 100 ? buy / (1 - fee / 100) : 0;
    document.getElementById('targetPrice').value = breakEven.toFixed(2);
  }

  function calcProfit() {
    const buy    = parseFloat(document.getElementById('buyPrice').value)    || 0;
    const fee    = parseFloat(document.getElementById('txFee').value)       || 0;
    const target = parseFloat(document.getElementById('targetPrice').value) || 0;

    const feeAmt    = target * (fee / 100);
    const totalCost = buy + feeAmt;
    const profit    = target - totalCost;
    const pct       = totalCost > 0 ? (profit / totalCost) * 100 : 0;

    document.getElementById('feeAmount').textContent    = fmt(feeAmt);
    document.getElementById('totalCost').textContent    = fmt(totalCost);
    document.getElementById('profitAmount').textContent = fmt(profit);
    document.getElementById('profitPct').textContent    = pct.toFixed(2) + '%';

    const cls = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral';
    document.getElementById('profitAmount').className = cls;
    document.getElementById('profitPct').className    = cls;
  }

  function fmt(n) { return '$' + Number(n.toFixed(2)).toLocaleString(); }

  document.getElementById('buyPrice').addEventListener('input', () => {
    updateBreakEven();
    calcProfit();
  });
  let feeReloadTimer;
  document.getElementById('txFee').addEventListener('input', () => {
    updateBreakEven();
    calcProfit();
    clearTimeout(feeReloadTimer);
    feeReloadTimer = setTimeout(loadBestItems, 700);
  });

  document.getElementById('refreshBestBtn').addEventListener('click', loadBestItems);
  document.getElementById('targetPrice').addEventListener('input', () => {
    autoCalc = false;
    calcProfit();
  });

  document.getElementById('resetCalc').addEventListener('click', () => {
    autoCalc = true;
    document.getElementById('buyPrice').value    = '';
    document.getElementById('targetPrice').value = '';
    document.getElementById('txFee').value       = '5';
    calcProfit();
  });

  // ── Init ──
  // Default to today in Torn City Time (TCT = UTC)
  const tornToday = new Date().toISOString().slice(0, 10);
  document.getElementById('startDate').value = tornToday;
  document.getElementById('endDate').value   = tornToday;

  loadBestItems();
  showStatus('Select an item to view market data');
})();
