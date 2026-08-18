'use strict';

/**
 * DB → memory load: read the persisted derived state back into `state` at startup.
 * node-postgres returns bigint as strings — every numeric field is coerced with
 * Number() (avoiding "5" + 1 = "51" style corruption).
 */

async function loadState(pool, state, config, catalog) {
  const meta = await pool.query('SELECT * FROM monitor_meta WHERE id = 1');
  if (meta.rows.length) {
    const m = meta.rows[0];
    if (m.start_ts) state.startTs = Number(m.start_ts);
    if (m.last_ts != null) state.lastTs = Number(m.last_ts);
    state.poll = { lastTs: Number(m.poll_last_ts) || 0, lastOk: m.poll_ok, lastMsg: m.poll_msg || '', processed: Number(m.poll_processed) || 0 };
  }

  const totals = await pool.query('SELECT * FROM item_totals');
  const items = {};
  totals.rows.forEach(r => {
    items[r.item_id] = {
      id: r.item_id, name: r.name, category: catalog ? catalog.itemCategory(r.item_id) : '',
      value: Number(r.value), in: Number(r.in_qty), out: Number(r.out_qty),
      net: Number(r.in_qty) - Number(r.out_qty),
      lastTs: Number(r.last_ts), sourcesIn: {}, sourcesOut: {},
    };
  });
  const srcs = await pool.query('SELECT * FROM item_sources');
  srcs.rows.forEach(r => {
    if (!items[r.item_id]) return;
    if (r.dir === 'in') items[r.item_id].sourcesIn[r.source] = Number(r.qty);
    else items[r.item_id].sourcesOut[r.source] = Number(r.qty);
  });
  state.items = items;

  const act = await pool.query(`SELECT * FROM activity ORDER BY ts DESC, id DESC LIMIT ${config.activityMax}`);
  state.activity = act.rows.map(r => ({
    ts: Number(r.ts), logId: r.log_id, logType: r.log_type === null ? null : Number(r.log_type), title: r.title,
    category: r.category || '', dir: r.dir, itemId: r.item_id, name: r.item_name, qty: Number(r.qty), source: r.source,
  }));

  const proc = await pool.query(`SELECT log_id FROM processed_logs ORDER BY processed_at DESC LIMIT ${config.processedMax}`);
  state.processedIds = proc.rows.map(r => r.log_id);

  // Bazaar stock ledger
  const bzTotals = await pool.query('SELECT * FROM bazaar_totals');
  state.bazaar.items = {};
  bzTotals.rows.forEach(r => {
    const inQ = Number(r.in_qty), soldQ = Number(r.sold_qty), remQ = Number(r.removed_qty);
    state.bazaar.items[r.item_id] = {
      id: r.item_id, name: r.name, category: catalog ? catalog.itemCategory(r.item_id) : '', value: Number(r.value),
      in: inQ, sold: soldQ, removed: remQ, out: soldQ + remQ, net: inQ - soldQ - remQ,
      lastTs: Number(r.last_ts),
      sources: { Added: inQ, Sold: soldQ, Removed: remQ },
    };
  });
  const bzMeta = await pool.query('SELECT * FROM bazaar_meta WHERE id = 1');
  if (bzMeta.rows.length) {
    state.bazaar.revenue = Number(bzMeta.rows[0].revenue);
    state.bazaar.unitsSold = Number(bzMeta.rows[0].units_sold);
  }

  // Display Case stock ledger
  const dispTotals = await pool.query('SELECT * FROM display_totals');
  state.display.items = {};
  dispTotals.rows.forEach(r => {
    const inQ = Number(r.in_qty), remQ = Number(r.removed_qty);
    state.display.items[r.item_id] = {
      id: r.item_id, name: r.name, category: catalog ? catalog.itemCategory(r.item_id) : '', value: Number(r.value),
      in: inQ, removed: remQ, net: inQ - remQ, lastTs: Number(r.last_ts),
    };
  });

  // Item Market listing ledger
  const mktTotals = await pool.query('SELECT * FROM market_totals');
  state.market.items = {};
  mktTotals.rows.forEach(r => {
    const inQ = Number(r.in_qty), soldQ = Number(r.sold_qty), remQ = Number(r.removed_qty);
    state.market.items[r.item_id] = {
      id: r.item_id, name: r.name, category: catalog ? catalog.itemCategory(r.item_id) : '', value: Number(r.value),
      in: inQ, sold: soldQ, removed: remQ, out: soldQ + remQ, net: inQ - soldQ - remQ,
      lastTs: Number(r.last_ts),
      sources: { Added: inQ, Sold: soldQ, Removed: remQ },
    };
  });
  const mktMeta = await pool.query('SELECT * FROM market_meta WHERE id = 1');
  if (mktMeta.rows.length) {
    state.market.revenue = Number(mktMeta.rows[0].revenue);
    state.market.unitsSold = Number(mktMeta.rows[0].units_sold);
  }

  // Completed trades — grouped by parsed_trade_id
  const trdRows = await pool.query(`SELECT * FROM trade_events ORDER BY ts DESC, id DESC LIMIT ${config.tradeEventMax}`);
  const emptySide = () => ({ money: 0, items: [], properties: 0 });
  state.trades.trades = trdRows.rows.map(r => ({
    tradeId: r.trade_id,
    ts: Number(r.ts),
    counterpartId: r.counterpart_id === null ? null : Number(r.counterpart_id),
    gave: Object.assign(emptySide(), JSON.parse(r.gave_json || '{}')),
    received: Object.assign(emptySide(), JSON.parse(r.received_json || '{}')),
  }));
  state.trades.byId = new Map(state.trades.trades.map(g => [g.tradeId, g]));

  // Museum exchange rewards (7000)
  const mswRows = await pool.query(`SELECT * FROM museum_swaps ORDER BY ts DESC, id DESC LIMIT ${config.museumSwapMax}`);
  state.museum.swaps = mswRows.rows.map(r => ({
    ts: Number(r.ts), logId: r.log_id, set: r.set_name,
    quantity: Number(r.quantity), pointsReceived: Number(r.points_received),
  }));
  const mmRows = await pool.query('SELECT * FROM museum_meta WHERE id = 1');
  if (mmRows.rows.length) state.museum.pointsReceived = Number(mmRows.rows[0].points_received);

  // Transfer events (location→location moves)
  const trRows = await pool.query(`SELECT * FROM transfers ORDER BY ts DESC, id DESC LIMIT ${config.transferMax}`);
  state.transfers = trRows.rows.map(r => ({
    ts: Number(r.ts), logId: r.log_id, logType: r.log_type === null ? null : Number(r.log_type),
    title: r.title, itemId: r.item_id, name: r.item_name, category: catalog ? catalog.itemCategory(r.item_id) : '',
    qty: Number(r.qty), from: r.from_loc, to: r.to_loc,
  }));

  // Location-ledger events (per-scope per-item history for the Bazaar/Display/Market popups)
  const locRows = await pool.query('SELECT scope, item_id, kind, ts, qty FROM location_events ORDER BY ts DESC, id DESC');
  state.locationEvents = { bazaar: [], display: [], market: [] };
  locRows.rows.forEach(r => {
    const list = state.locationEvents[r.scope];
    if (list && list.length < config.locationEventMax) list.push({ ts: Number(r.ts), itemId: r.item_id, kind: r.kind, qty: Number(r.qty) });
  });

  // Manual adjustments (reconciliation layer) — replayed on top of the ledger at read time
  const adjRows = await pool.query('SELECT * FROM manual_adjustments ORDER BY ts DESC, id DESC');
  state.adjustments = adjRows.rows.map(r => ({
    id: r.id, ts: Number(r.ts), itemId: String(r.item_id), dir: r.dir, qty: Number(r.qty),
    label: r.label || 'Manual', note: r.note || '', scope: r.scope || 'inventory',
  }));

  // FIFO cost lots — load active lots (remaining_qty > 0) oldest-first per item
  const fifoRows = await pool.query(
    'SELECT * FROM fifo_lots WHERE remaining_qty > 0 ORDER BY item_id, ts ASC, id ASC'
  );
  state.fifo.lots = new Map();
  fifoRows.rows.forEach(r => {
    const key = r.item_id;
    if (!state.fifo.lots.has(key)) state.fifo.lots.set(key, []);
    state.fifo.lots.get(key).push({
      id: Number(r.id), ts: Number(r.ts), logId: r.log_id,
      itemId: key, itemName: r.item_name, category: r.item_category || '',
      totalQty: Number(r.total_qty), remaining: Number(r.remaining_qty),
      unitCost: Number(r.unit_cost), source: r.source,
    });
  });

  console.log(`[init] DB loaded: ${Object.keys(state.items).length} items, ${Object.keys(state.bazaar.items).length} bazaar, ${Object.keys(state.display.items).length} display, ${Object.keys(state.market.items).length} market, ${state.activity.length} activity, ${state.transfers.length} transfers, ${state.trades.trades.length} trades, ${state.museum.swaps.length} museum swaps, ${state.adjustments.length} adjustments, ${state.processedIds.length} processed, ${fifoRows.rows.length} fifo lots, lastTs=${state.lastTs}`);
}

module.exports = { loadState };
