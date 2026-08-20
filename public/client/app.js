(function () {
  'use strict';

  // ── State ──
  let currentItemId  = null;
  let currentData    = [];
  let activeChart    = null;
  let chartType      = 'line';
  let timeframe      = '30m';
  let autoRefresh    = null;
  let useTCT         = true;
  let awaitingSell   = false;
  let calcAutoOpen   = true;

  const tfBucketMs = {
    '1m': 60000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, 'day': 86400000,
  };

  // ── Helpers ──
  function p2(n) { return String(n).padStart(2, '0'); }

  function getLocalTimezoneAbbr() {
    try {
      return Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
        .formatToParts(new Date())
        .find(p => p.type === 'timeZoneName')?.value || 'Local';
    } catch { return 'Local'; }
  }

  function getDateInput() {
    if (useTCT) {
      return new Date().toISOString().slice(0, 10);
    } else {
      const d = new Date();
      return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    }
  }

  function formatDisplayDateTime(date) {
    if (useTCT) {
      return `${p2(date.getUTCHours())}:${p2(date.getUTCMinutes())} TCT`;
    } else {
      return `${p2(date.getHours())}:${p2(date.getMinutes())} ${getLocalTimezoneAbbr()}`;
    }
  }

  function fmt$(n) {
    if (!n && n !== 0) return '—';
    const v = Math.abs(n), sg = n < 0 ? '-' : '';
    if (v >= 1e9) return sg + '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return sg + '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return sg + '$' + (v / 1e3).toFixed(1) + 'K';
    return sg + '$' + v.toLocaleString();
  }

  function fmtFull(n) {
    return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmt(n) { return '$' + Number(n.toFixed(2)).toLocaleString(); }

  // ── Time display ──
  function updateTimeDisplay() {
    const el = document.getElementById('timeDisplay');
    if (!el) return;
    const now = new Date();
    const timeStr = formatDisplayDateTime(now);
    const spaceIdx = timeStr.lastIndexOf(' ');
    const time = timeStr.slice(0, spaceIdx);
    const tz   = timeStr.slice(spaceIdx + 1);
    el.innerHTML = `<span class="tl">${time}</span> ${tz}`;
  }
  updateTimeDisplay();
  setInterval(updateTimeDisplay, 60000);

  // ── Summary tiles ──
  function calcBuySell(data) {
    const priceData = data.map(d => ({ price: Number(d.price), quantity: Number(d.quantity) || 1 })).filter(d => d.price > 0);
    if (!priceData.length) return { buyPrice: null, sellPrice: null };
    const prices = priceData.map(d => d.price);
    const sorted = [...prices].sort((a, b) => a - b);
    const lowThreshold  = sorted[Math.floor(sorted.length * 0.3)];
    const highThreshold = sorted[Math.floor(sorted.length * 0.7)];
    const lowData  = priceData.filter(d => d.price <= lowThreshold);
    const highData = priceData.filter(d => d.price >= highThreshold);
    const weightedMode = (arr) => {
      if (!arr.length) return null;
      const freq = {};
      arr.forEach(({ price, quantity }) => { freq[price] = (freq[price] || 0) + quantity; });
      let max = 0, mode = arr[0].price;
      for (const [price, count] of Object.entries(freq)) { if (count > max) { max = count; mode = Number(price); } }
      return mode;
    };
    return { buyPrice: weightedMode(lowData) || sorted[0], sellPrice: weightedMode(highData) || sorted[sorted.length - 1] };
  }

  function updateSummary(data) {
    const setTile = (id, val) => {
      const e = document.getElementById(id);
      if (e) e.textContent = val != null && isFinite(val) ? fmt$(val) : '—';
    };
    if (!data.length) { ['sAvg', 'sMin', 'sMax', 'sBuy', 'sSell'].forEach(id => setTile(id, null)); return; }
    const prices    = data.map(d => +d.price).filter(p => p > 0);
    const avgPrices = data.map(d => +d.average_price).filter(p => p > 0);
    const avg = avgPrices.reduce((s, p) => s + p, 0) / (avgPrices.length || 1);
    const { buyPrice, sellPrice } = calcBuySell(data);
    setTile('sAvg',  avg);
    setTile('sMin',  Math.min(...prices));
    setTile('sMax',  Math.max(...prices));
    setTile('sBuy',  buyPrice);
    setTile('sSell', sellPrice);
  }

  // ── Recommendation ──
  function generateRecommendation() {
    const body = document.getElementById('recoBody');
    if (!currentData.length) { body.innerHTML = '<div class="reco-status">Load item data first.</div>'; return; }

    const priceData = currentData.map(d => ({
      price: Number(d.price), quantity: Number(d.quantity) || 1, avgPrice: Number(d.average_price)
    })).filter(d => d.price > 0);
    if (!priceData.length) { body.innerHTML = '<div class="reco-status">No valid price data.</div>'; return; }

    const prices    = priceData.map(d => d.price);
    const quantities = priceData.map(d => d.quantity);
    const sorted    = [...prices].sort((a, b) => a - b);
    const minPrice  = sorted[0];
    const maxPrice  = sorted[sorted.length - 1];
    const totalQuantity = quantities.reduce((s, q) => s + q, 0);
    const weightedAvg = totalQuantity > 0
      ? priceData.reduce((s, d) => s + d.price * d.quantity, 0) / totalQuantity
      : prices.reduce((s, p) => s + p, 0) / prices.length;

    const lowThreshold  = sorted[Math.floor(sorted.length * 0.3)];
    const highThreshold = sorted[Math.floor(sorted.length * 0.7)];
    const lowPriceData  = priceData.filter(d => d.price <= lowThreshold);
    const highPriceData = priceData.filter(d => d.price >= highThreshold);

    const { buyPrice, sellPrice } = calcBuySell(currentData);
    const supportLevel    = Math.min(...lowPriceData.map(d => d.price));
    const resistanceLevel = Math.max(...highPriceData.map(d => d.price));

    const buyData  = lowPriceData.filter(d => d.price === buyPrice);
    const sellData = highPriceData.filter(d => d.price === sellPrice);
    const buyQuantity  = buyData.reduce((s, d) => s + d.quantity, 0);
    const sellQuantity = sellData.reduce((s, d) => s + d.quantity, 0);

    const feePercent    = 5;
    const feeAmount     = sellPrice * (feePercent / 100);
    const totalCost     = buyPrice + feeAmount;
    const profitPerUnit = sellPrice - totalCost;
    const availableQty  = Math.min(buyQuantity, sellQuantity);
    const profitPerItem = profitPerUnit * availableQty;
    const marginPercent = totalCost > 0 ? (profitPerUnit / totalCost) * 100 : 0;

    const minQuantity = 10;
    let recommendation = 'HOLD', recClass = 'hold', recReason = '';
    if (marginPercent > 10 && availableQty >= minQuantity) {
      recommendation = 'STRONG BUY'; recClass = 'strong-buy';
      recReason = `High margin (${marginPercent.toFixed(2)}%) with ${availableQty} units available`;
    } else if (marginPercent > 3 && availableQty >= minQuantity) {
      recommendation = 'BUY'; recClass = 'buy';
      recReason = `Good margin (${marginPercent.toFixed(2)}%) with ${availableQty} units available`;
    } else if (availableQty < minQuantity) {
      recReason = `Limited quantity (${availableQty} units)`;
    } else {
      recReason = `Low margin (${marginPercent.toFixed(2)}%)`;
    }

    const profitClass = profitPerUnit >= 0 ? 'profit' : 'loss';

    body.innerHTML = `
      <div class="reco-section">
        <div class="reco-section-title">Price Analysis</div>
        <div class="reco-row"><span class="reco-label">Min Price</span><span class="reco-value">${fmt$(minPrice)}</span></div>
        <div class="reco-row"><span class="reco-label">Max Price</span><span class="reco-value">${fmt$(maxPrice)}</span></div>
        <div class="reco-row"><span class="reco-label">Weighted Avg</span><span class="reco-value">${fmt$(weightedAvg)}</span></div>
        <div class="reco-row"><span class="reco-label">Support</span><span class="reco-value buy">${fmt$(supportLevel)}</span></div>
        <div class="reco-row"><span class="reco-label">Resistance</span><span class="reco-value sell">${fmt$(resistanceLevel)}</span></div>
      </div>
      <div class="reco-section">
        <div class="reco-section-title">Trade Setup</div>
        <div class="reco-row"><span class="reco-label">Rec Buy</span><span class="reco-value buy">${fmt$(buyPrice)}</span></div>
        <div class="reco-row"><span class="reco-label">Rec Sell</span><span class="reco-value sell">${fmt$(sellPrice)}</span></div>
        <div class="reco-row"><span class="reco-label">Buy Qty</span><span class="reco-value">${buyQuantity}</span></div>
        <div class="reco-row"><span class="reco-label">Sell Qty</span><span class="reco-value">${sellQuantity}</span></div>
        <div class="reco-row"><span class="reco-label">Available</span><span class="reco-value">${availableQty}</span></div>
      </div>
      <div class="reco-section">
        <div class="reco-section-title">Profit Calculation</div>
        <div class="reco-row"><span class="reco-label">Fee (5%)</span><span class="reco-value">${fmt$(feeAmount)}</span></div>
        <div class="reco-row"><span class="reco-label">Total Cost</span><span class="reco-value">${fmt$(totalCost)}</span></div>
        <div class="reco-row"><span class="reco-label">Profit/Unit</span><span class="reco-value ${profitClass}">${fmt$(profitPerUnit)}</span></div>
        <div class="reco-row"><span class="reco-label">Profit/Batch</span><span class="reco-value ${profitClass}">${fmt$(profitPerItem)}</span></div>
        <div class="reco-row"><span class="reco-label">Margin</span><span class="reco-value ${profitClass}">${marginPercent.toFixed(2)}%</span></div>
      </div>
      <div class="reco-section" style="text-align:center">
        <div class="reco-section-title">Recommendation</div>
        <span class="reco-badge ${recClass}">${recommendation}</span>
        <div style="margin-top:8px;font-size:0.72rem;color:var(--text-muted)">${recReason}</div>
      </div>
    `;
  }

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
          if (el.datasetIndex === 2) return;
          const clickedPrice = el.datasetIndex === 0
            ? lowestOffer[el.index]?.y
            : avgPrice[el.index]?.y;
          if (!clickedPrice) return;

          const buyEl    = document.getElementById('buyPrice');
          const targetEl = document.getElementById('targetPrice');

          if (awaitingSell) {
            // Second click: set sell price
            targetEl.value = clickedPrice;
            awaitingSell = false;
            autoCalc = false;
            calcProfit();
            if (calcAutoOpen) openDrawer('calcDrawer');
          } else {
            // First/third click: set buy price, clear sell, start cycle
            buyEl.value    = clickedPrice;
            targetEl.value = '';
            awaitingSell   = true;
            autoCalc       = true;
            updateBreakEven();
            calcProfit();
          }
        },
      },
    });
  }

  function renderCandlestick(rows) {
    ctx.style.display = 'none';
    const div = document.getElementById('candlestickChart');
    div.style.display = 'block';
    if (activeChart) { activeChart.destroy(); activeChart = null; }

    const bucketMs = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, 'day': 86400000 };
    const ms = bucketMs[timeframe] || 1800000;
    const buckets = {};
    rows.forEach(r => {
      const t = Math.floor(new Date(r.created_at).getTime() / ms) * ms;
      if (!buckets[t]) buckets[t] = [];
      buckets[t].push(Number(r.price));
    });
    const chartData = Object.entries(buckets).sort((a, b) => a[0] - b[0]).map(([t, prices]) => ({
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

    const from   = getDatetime('startDate', 'startTime');
    const to     = getDatetime('endDate',   'endTime');
    const params = new URLSearchParams({ limit: 5000 });
    if (from) params.set('from', from);
    if (to)   params.set('to',   to);

    showStatus('Loading…');
    try {
      const res  = await fetch(`/api/market/${currentItemId}?${params}`);
      const rows = await res.json();
      currentData = rows;
      renderChart(rows);
      updateTable(rows);
      updateSummary(rows);
      const hint = document.getElementById('clickHint');
      if (hint) hint.style.display = rows.length ? 'block' : 'none';
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
    bestLoaded = false;
    const btn = document.getElementById('refreshBestBtn');
    if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
    try {
      const rawFee = parseFloat(document.getElementById('txFee').value);
      const fee = isNaN(rawFee) ? 5 : rawFee;
      const res = await fetch(`/api/best-items?fee=${fee}`);
      bestItems = await res.json();
      bestLoaded = true;
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
    const suffix = useTCT ? ':00Z' : ':00';
    return d ? `${d}T${t}${suffix}` : '';
  }

  document.getElementById('applyFilters').addEventListener('click', fetchData);

  document.getElementById('resetFilters').addEventListener('click', () => {
    const today = getDateInput();
    document.getElementById('startDate').value = today;
    document.getElementById('endDate').value   = today;
    document.getElementById('startTime').value = '00:00';
    document.getElementById('endTime').value   = '23:59';
    fetchData();
  });

  document.getElementById('prevDay').addEventListener('click', () => shiftDay(-1));
  document.getElementById('nextDay').addEventListener('click', () => shiftDay(1));
  function shiftDay(d) {
    if (useTCT) {
      const val = document.getElementById('startDate').value;
      const dt  = val ? new Date(val + 'T00:00:00Z') : new Date();
      dt.setUTCDate(dt.getUTCDate() + d);
      const s = dt.toISOString().slice(0, 10);
      document.getElementById('startDate').value = s;
      document.getElementById('endDate').value   = s;
    } else {
      const val = document.getElementById('startDate').value;
      const dt  = val ? new Date(val + 'T00:00:00') : new Date();
      dt.setDate(dt.getDate() + d);
      const s = `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`;
      document.getElementById('startDate').value = s;
      document.getElementById('endDate').value   = s;
    }
    fetchData();
  }

  // ── Timezone toggle ──
  document.querySelectorAll('.tz-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tz-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      useTCT = this.dataset.tz === 'tct';
      updateTimeDisplay();
      // Reset dates to today in new tz
      const today = getDateInput();
      document.getElementById('startDate').value = today;
      document.getElementById('endDate').value   = today;
      if (currentData.length) renderChart(currentData);
    });
  });

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
    autoCalc     = true;
    awaitingSell = false;
    document.getElementById('buyPrice').value    = '';
    document.getElementById('targetPrice').value = '';
    document.getElementById('txFee').value       = '5';
    calcProfit();
  });

  // ── calcAutoOpen toggle ──
  document.getElementById('calcAutoOpen').addEventListener('click', function () {
    calcAutoOpen = !calcAutoOpen;
    this.textContent = calcAutoOpen ? 'On' : 'Off';
    this.classList.toggle('active', calcAutoOpen);
  });

  // ── Drawer system ──
  function openDrawer(id) {
    ['calcDrawer','bestDrawer','recoDrawer'].forEach(d => {
      const el  = document.getElementById(d);
      const btn = document.getElementById(d.replace('Drawer','Btn'));
      el.classList.toggle('visible', d === id);
      if (btn) btn.classList.toggle('active', d === id);
    });
    if (id === 'recoDrawer')  generateRecommendation();
    if (id === 'bestDrawer' && !bestLoaded) loadBestItems();
  }

  function toggleDrawer(id) {
    const isOpen = document.getElementById(id).classList.contains('visible');
    isOpen ? (() => {
      document.getElementById(id).classList.remove('visible');
      const btn = document.getElementById(id.replace('Drawer','Btn'));
      if (btn) btn.classList.remove('active');
    })() : openDrawer(id);
  }

  let bestLoaded = false;

  document.getElementById('calcBtn') .addEventListener('click', () => toggleDrawer('calcDrawer'));
  document.getElementById('bestBtn') .addEventListener('click', () => toggleDrawer('bestDrawer'));
  document.getElementById('recoBtn') .addEventListener('click', () => toggleDrawer('recoDrawer'));

  document.querySelectorAll('.drawer-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.drawer;
      document.getElementById(id).classList.remove('visible');
      const nb = document.getElementById(id.replace('Drawer','Btn'));
      if (nb) nb.classList.remove('active');
    });
  });

  // Sync txFeeDrawer ↔ txFee
  document.getElementById('txFeeDrawer').addEventListener('input', function () {
    document.getElementById('txFee').value = this.value;
    clearTimeout(feeReloadTimer);
    feeReloadTimer = setTimeout(loadBestItems, 700);
  });

  // ── Init ──
  const today = getDateInput();
  document.getElementById('startDate').value = today;
  document.getElementById('endDate').value   = today;

  loadBestItems();
  showStatus('Select an item to view market data');
})();
