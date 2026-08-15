'use strict';

/**
 * Summary — builds the read-model for the dashboard + API from the live state.
 * The manual-adjustment reconciliation layer is replayed here on top of the log
 * ledger (never mutating live state), so /api/state is always the adjusted view.
 */

function createSummary({ state, catalog, config }) {
  return function summary() {
    // Deep-ish clone of the log-derived ledger so manual adjustments never mutate live state.
    const itemsById = new Map();
    Object.values(state.items).forEach(it => {
      itemsById.set(it.id, { ...it, sourcesIn: { ...it.sourcesIn }, sourcesOut: { ...it.sourcesOut } });
    });

    // Manual reconciliation layer — applied on top of the log ledger (see manual_adjustments).
    // Returns the adjustment rows as activity entries so they show in the feed too.
    const adjActivity = [];
    for (const a of state.adjustments) {
      let it = itemsById.get(a.itemId);
      if (!it) {
        it = { id: a.itemId, name: catalog.itemName(a.itemId), value: catalog.itemValue(a.itemId), in: 0, out: 0, net: 0, lastTs: 0, sourcesIn: {}, sourcesOut: {} };
        itemsById.set(a.itemId, it);
      }
      const label = `Manual: ${a.label || 'Manual'}`;
      if (a.dir === 'in') { it.in += a.qty; it.net += a.qty; it.sourcesIn[label] = (it.sourcesIn[label] || 0) + a.qty; }
      else                { it.out += a.qty; it.net -= a.qty; it.sourcesOut[label] = (it.sourcesOut[label] || 0) + a.qty; }
      if (a.ts > it.lastTs) it.lastTs = a.ts;
      adjActivity.push({ ts: a.ts, logId: `manual-${a.id}`, logType: null, title: 'Manual adjustment',
                         dir: a.dir, itemId: a.itemId, name: it.name, qty: a.qty, source: label });
    }

    const items = [...itemsById.values()];
    let inQty = 0, outQty = 0, valueIn = 0, valueOut = 0;
    let uniqueIn = 0, uniqueOut = 0;
    items.forEach(it => {
      if (it.in > 0) { uniqueIn++; inQty += it.in; valueIn += it.value * it.in; }
      if (it.out > 0) { uniqueOut++; outQty += it.out; valueOut += it.value * it.out; }
    });
    // Current inventory view — the ledger: baseline (zero) + net flows since startTs.
    // Negative net = the item drew from pre-existing stock (true balance unknown).
    const holdings   = items.filter(it => it.net > 0);
    const overdrawn  = items.filter(it => it.net < 0);
    const current = {
      baseline: 'zero',   // delta-only ledger: current = net since startTs
      stockItems: holdings.length,
      stockQty: holdings.reduce((s, i) => s + i.net, 0),
      stockValue: holdings.reduce((s, i) => s + i.net * i.value, 0),
      overdrawnItems: overdrawn.length,
    };

    // Bazaar stock ledger (see ITEM_TRACKING.md §6c)
    const bzItems = Object.values(state.bazaar.items);
    const bazaar = {
      revenue: state.bazaar.revenue,
      unitsSold: state.bazaar.unitsSold,
      unitsIn: bzItems.reduce((s, i) => s + i.in, 0),
      unitsOut: bzItems.reduce((s, i) => s + i.out, 0),
      netUnits: bzItems.reduce((s, i) => s + i.net, 0),
      stockItems: bzItems.filter(i => i.net > 0).length,
      items: bzItems
        .map(it => ({ ...it }))
        .sort((a, b) => (b.in + b.out) - (a.in + a.out)),
    };

    // Display Case stock ledger (see ITEM_TRACKING.md §6d)
    const dispItems = Object.values(state.display.items);
    const display = {
      unitsIn: dispItems.reduce((s, i) => s + i.in, 0),
      unitsOut: dispItems.reduce((s, i) => s + i.removed, 0),
      netUnits: dispItems.reduce((s, i) => s + i.net, 0),
      stockItems: dispItems.filter(i => i.net > 0).length,
      items: dispItems
        .map(it => ({ ...it }))
        .sort((a, b) => (b.in + b.removed) - (a.in + a.removed)),
    };

    // Item Market listing ledger (see ITEM_TRACKING.md §6e)
    const mktItems = Object.values(state.market.items);
    const market = {
      revenue: state.market.revenue,
      unitsSold: state.market.unitsSold,
      unitsIn: mktItems.reduce((s, i) => s + i.in, 0),
      unitsOut: mktItems.reduce((s, i) => s + i.out, 0),
      netUnits: mktItems.reduce((s, i) => s + i.net, 0),
      stockItems: mktItems.filter(i => i.net > 0).length,
      items: mktItems
        .map(it => ({ ...it }))
        .sort((a, b) => (b.in + b.out) - (a.in + a.out)),
    };

    // Transfer events between locations — counts per direction + recent items
    const transferCounts = {};
    state.transfers.forEach(t => {
      const k = `${t.from} → ${t.to}`;
      transferCounts[k] = (transferCounts[k] || 0) + t.qty;
    });
    const transfers = { counts: transferCounts, items: state.transfers.slice(0, 200) };

    // Trade event history + per-item trade ledger (derived from the main ledger's
    // 'Trade' sources — always consistent with the Inventory tab)
    const tradeItems = Object.values(state.items)
      .filter(it => (it.sourcesIn?.Trade || 0) > 0 || (it.sourcesOut?.Trade || 0) > 0)
      .map(it => ({
        id: it.id, name: it.name, value: it.value,
        in: it.sourcesIn?.Trade || 0,
        out: it.sourcesOut?.Trade || 0,
        net: (it.sourcesIn?.Trade || 0) - (it.sourcesOut?.Trade || 0),
        lastTs: it.lastTs,
      }))
      .sort((a, b) => (b.in + b.out) - (a.in + a.out));
    const tradeGroups = state.trades.trades;
    const trades = {
      countOut: tradeGroups.filter(t => t.gave.money > 0 || t.gave.items.length || t.gave.properties).length,
      countIn: tradeGroups.filter(t => t.received.money > 0 || t.received.items.length || t.received.properties).length,
      sentQty: tradeGroups.reduce((s, t) => s + t.gave.items.reduce((x, i) => x + i.qty, 0), 0),
      receivedQty: tradeGroups.reduce((s, t) => s + t.received.items.reduce((x, i) => x + i.qty, 0), 0),
      moneyOut: tradeGroups.reduce((s, t) => s + t.gave.money, 0),
      moneyIn: tradeGroups.reduce((s, t) => s + t.received.money, 0),
      items: tradeItems,
      trades: tradeGroups.slice(0, 200),
    };

    // Museum exchange rewards (7000) — points earned per swap
    const museum = {
      pointsReceived: state.museum.pointsReceived,
      swapCount: state.museum.swaps.length,
      unitsSpent: state.museum.swaps.reduce((s, e) => s + (catalog.museum.get(e.set)?.items.length || 1) * e.quantity, 0),
      swaps: state.museum.swaps.slice(0, 200),
    };

    return {
      startTs: state.startTs,
      startLabel: new Date(state.startTs * 1000).toISOString(),
      lastTs: state.lastTs,
      poll: state.poll,
      pollInterval: config.pollInterval,
      apiKeySet: true,                 // no key needed — logs come from LOGS_SERVER
      logSource: config.logsServer,
      counts: { uniqueIn, uniqueOut, inQty, outQty, netQty: inQty - outQty, valueIn, valueOut },
      current,
      bazaar,
      display,
      market,
      trades,
      museum,
      transfers,
      items: items
        .map(it => ({ ...it }))
        .sort((a, b) => (b.in + b.out) - (a.in + a.out)),
      activity: state.activity.concat(adjActivity).sort((a, b) => b.ts - a.ts).slice(0, 200),
      adjustments: state.adjustments.slice(0, 100).map(a => ({ id: a.id, ts: a.ts, itemId: a.itemId, name: catalog.itemName(a.itemId), dir: a.dir, qty: a.qty, label: a.label, note: a.note })),
    };
  };
}

module.exports = { createSummary };
