'use strict';

/**
 * Summary — builds the read-model for the dashboard + API from the live state.
 * The manual-adjustment reconciliation layer is replayed here on top of the log
 * ledger (never mutating live state), so /api/state is always the adjusted view.
 */

function createSummary({ state, catalog, config }) {
  return function summary() {
    // Deep-ish clones of each log-derived ledger so manual adjustments never mutate live state.
    const itemsById = new Map();
    Object.values(state.items).forEach(it => {
      itemsById.set(it.id, { ...it, sourcesIn: { ...it.sourcesIn }, sourcesOut: { ...it.sourcesOut } });
    });
    const bazaarById = new Map();
    Object.values(state.bazaar.items).forEach(it => bazaarById.set(it.id, { ...it }));
    const displayById = new Map();
    Object.values(state.display.items).forEach(it => displayById.set(it.id, { ...it }));
    const marketById = new Map();
    Object.values(state.market.items).forEach(it => marketById.set(it.id, { ...it }));

    // Manual reconciliation layer — applied on top of the log ledger per scope.
    const adjActivity = [];
    for (const a of state.adjustments) {
      const scope = a.scope || 'inventory';
      const label = `Manual: ${a.label || 'Manual'}`;

      if (scope === 'bazaar') {
        let it = bazaarById.get(a.itemId);
        if (!it) {
          it = { id: a.itemId, name: catalog.itemName(a.itemId), category: catalog.itemCategory(a.itemId), value: catalog.itemValue(a.itemId), in: 0, sold: 0, removed: 0, out: 0, net: 0, lastTs: 0 };
          bazaarById.set(a.itemId, it);
        }
        if (a.dir === 'in') { it.in += a.qty; it.net += a.qty; }
        else                { it.out += a.qty; it.net -= a.qty; }
        if (a.ts > it.lastTs) it.lastTs = a.ts;
      } else if (scope === 'display') {
        let it = displayById.get(a.itemId);
        if (!it) {
          it = { id: a.itemId, name: catalog.itemName(a.itemId), category: catalog.itemCategory(a.itemId), value: catalog.itemValue(a.itemId), in: 0, removed: 0, net: 0, lastTs: 0 };
          displayById.set(a.itemId, it);
        }
        if (a.dir === 'in') { it.in += a.qty; it.net += a.qty; }
        else                { it.removed += a.qty; it.net -= a.qty; }
        if (a.ts > it.lastTs) it.lastTs = a.ts;
      } else if (scope === 'market') {
        let it = marketById.get(a.itemId);
        if (!it) {
          it = { id: a.itemId, name: catalog.itemName(a.itemId), category: catalog.itemCategory(a.itemId), value: catalog.itemValue(a.itemId), in: 0, sold: 0, removed: 0, out: 0, net: 0, lastTs: 0 };
          marketById.set(a.itemId, it);
        }
        if (a.dir === 'in') { it.in += a.qty; it.net += a.qty; }
        else                { it.out += a.qty; it.net -= a.qty; }
        if (a.ts > it.lastTs) it.lastTs = a.ts;
      } else {
        // inventory (default)
        let it = itemsById.get(a.itemId);
        if (!it) {
          it = { id: a.itemId, name: catalog.itemName(a.itemId), category: catalog.itemCategory(a.itemId), value: catalog.itemValue(a.itemId), in: 0, out: 0, net: 0, lastTs: 0, sourcesIn: {}, sourcesOut: {} };
          itemsById.set(a.itemId, it);
        }
        if (a.dir === 'in') { it.in += a.qty; it.net += a.qty; it.sourcesIn[label] = (it.sourcesIn[label] || 0) + a.qty; }
        else                { it.out += a.qty; it.net -= a.qty; it.sourcesOut[label] = (it.sourcesOut[label] || 0) + a.qty; }
        if (a.ts > it.lastTs) it.lastTs = a.ts;
      }
      adjActivity.push({ ts: a.ts, logId: `manual-${a.id}`, logType: null, title: 'Manual adjustment',
                         dir: a.dir, itemId: a.itemId, name: catalog.itemName(a.itemId), qty: a.qty, source: label });
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

    // Bazaar stock ledger (adjusted clones, see ITEM_TRACKING.md §6c)
    const bzItems = [...bazaarById.values()];
    const bazaar = {
      revenue: state.bazaar.revenue,
      unitsSold: state.bazaar.unitsSold,
      unitsIn: bzItems.reduce((s, i) => s + i.in, 0),
      unitsOut: bzItems.reduce((s, i) => s + i.out, 0),
      netUnits: bzItems.reduce((s, i) => s + i.net, 0),
      stockItems: bzItems.filter(i => i.net > 0).length,
      items: bzItems.sort((a, b) => (b.in + b.out) - (a.in + a.out)),
    };

    // Display Case stock ledger (adjusted clones, see ITEM_TRACKING.md §6d)
    const dispItems = [...displayById.values()];
    const display = {
      unitsIn: dispItems.reduce((s, i) => s + i.in, 0),
      unitsOut: dispItems.reduce((s, i) => s + i.removed, 0),
      netUnits: dispItems.reduce((s, i) => s + i.net, 0),
      stockItems: dispItems.filter(i => i.net > 0).length,
      items: dispItems.sort((a, b) => (b.in + b.removed) - (a.in + a.removed)),
    };

    // Item Market listing ledger (adjusted clones, see ITEM_TRACKING.md §6e)
    const mktItems = [...marketById.values()];
    const market = {
      revenue: state.market.revenue,
      unitsSold: state.market.unitsSold,
      unitsIn: mktItems.reduce((s, i) => s + i.in, 0),
      unitsOut: mktItems.reduce((s, i) => s + i.out, 0),
      netUnits: mktItems.reduce((s, i) => s + i.net, 0),
      stockItems: mktItems.filter(i => i.net > 0).length,
      items: mktItems.sort((a, b) => (b.in + b.out) - (a.in + a.out)),
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
        id: it.id, name: it.name, category: it.category || '', value: it.value,
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

    const mappedItems = items
      .map(it => {
        const lots           = state.fifo.lots.get(it.id) || [];
        const active         = lots.filter(l => l.remaining > 0);
        const totalRemaining = active.reduce((s, l) => s + l.remaining, 0);
        const totalCost      = active.reduce((s, l) => s + l.remaining * l.unitCost, 0);
        const trueNet        = Math.max(0, it.net);
        // fifoMismatch: FIFO remaining doesn't equal the adjusted inventory net
        // (it.net already includes manual adjustments from itemsById above)
        const fifoMismatch   = totalRemaining !== trueNet;

        // avgCost: use active lots when available; fall back to an estimate when
        // all lots are depleted but inventory is non-zero (same logic as reconciler):
        //   1. Walk in-session depleted lots (newest first, unit_cost > 0) for a
        //      weighted estimate matching actual recent purchase prices.
        //   2. Fall back to lastKnownCost if no in-session history available.
        let avgCost = null;
        let avgCostEstimated = false;
        if (totalRemaining > 0) {
          avgCost = Math.round(totalCost / totalRemaining);
        } else if (trueNet > 0) {
          // Try in-session depleted lots (newest first) — mirrors reconciler pricing
          const depleted = lots.filter(l => l.remaining === 0 && l.unitCost > 0)
                               .slice().reverse(); // lots stored oldest-first; reverse = newest-first
          let estCost = 0, estUnits = 0, need = trueNet;
          for (const l of depleted) {
            if (need <= 0) break;
            const take = Math.min(need, l.totalQty);
            estCost  += take * l.unitCost;
            estUnits += take;
            need     -= take;
          }
          if (estUnits > 0) {
            avgCost = Math.round(estCost / estUnits);
            avgCostEstimated = true;
          } else {
            // No in-session depleted lots with price — use lastKnownCost as proxy
            const lkc = state.fifo.lastKnownCost.get(String(it.id));
            if (lkc > 0) { avgCost = lkc; avgCostEstimated = true; }
          }
        }

        return {
          ...it,
          avgCost,
          avgCostEstimated,
          costBasis:    totalCost,
          fifoLots:     active.length,
          fifoMismatch,
        };
      })
      .sort((a, b) => (b.in + b.out) - (a.in + a.out));

    const fifoMismatchCount = mappedItems.filter(it => it.fifoMismatch).length;

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
      items: mappedItems,
      fifoMismatchCount,
      activity: state.activity.concat(adjActivity).sort((a, b) => b.ts - a.ts).slice(0, 200),
      adjustments: state.adjustments.slice(0, 100).map(a => ({ id: a.id, ts: a.ts, itemId: a.itemId, name: catalog.itemName(a.itemId), scope: a.scope || 'inventory', dir: a.dir, qty: a.qty, label: a.label, note: a.note })),
    };
  };
}

module.exports = { createSummary };
