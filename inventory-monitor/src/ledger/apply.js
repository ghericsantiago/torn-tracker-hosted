'use strict';

/**
 * applyLog — the single place that turns one log into state changes:
 *   1. inventory flows (logFlows)        → state.items + activity
 *   2. bazaar flows (logBazaarFlows)     → state.bazaar + activity + transfers
 *   3. display flows (logDisplayFlows)   → state.display + activity + transfers
 *   4. market flows (logMarketFlows)     → state.market + activity + transfers
 *   5. trade events (logTradeEvent)      → state.trades (grouped)
 *   6. museum swaps (logMuseumSwap)      → state.museum
 * Returns the number of flows applied (0 = nothing changed → poll can skip persist).
 */

const C = require('../constants');
const { createLogFlows } = require('./extractors');
const { logBazaarFlows, logDisplayFlows, logMarketFlows } = require('./locations');
const { createTrade } = require('./trade');
const { logMuseumSwap } = require('./museum');
const { fifoIn, fifoOut } = require('./fifo');
const { logTransactionEvent } = require('./transactions');

function createApplyLog({ catalog, config }) {
  const logFlows = createLogFlows({ catalog });
  const { logTradeEvent, mergeTradeItems } = createTrade({ catalog });

  return function applyLog(log, state) {
    const flows = logFlows(log);
    const ts      = log.timestamp * 1000;
    const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
    const title   = log.details?.title || log.title || `Log ${logType}`;
    const category = log.details?.category || log.category || '';

    // 1. Main inventory ledger
    flows.forEach(f => {
      const key = String(f.itemId);
      if (!state.items[key]) {
        state.items[key] = {
          id: key,
          name: catalog.itemName(f.itemId),
          category: catalog.itemCategory(f.itemId),
          value: catalog.itemValue(f.itemId),
          in: 0, out: 0, net: 0,
          lastTs: 0,
          sourcesIn: {},   // sources that added qty (shown in the IN table)
          sourcesOut: {},  // sources that removed qty (shown in the OUT table)
        };
      }
      const it = state.items[key];
      if (f.dir === 'in') {
        it.in += f.qty;
        it.sourcesIn[f.source] = (it.sourcesIn[f.source] || 0) + f.qty;
      } else {
        it.out += f.qty;
        it.sourcesOut[f.source] = (it.sourcesOut[f.source] || 0) + f.qty;
      }
      it.net = it.in - it.out;
      if (ts > it.lastTs) it.lastTs = ts;

      state.activity.unshift({
        ts, logId: log.id, logType, title, category,
        dir: f.dir, itemId: key, name: it.name, qty: f.qty, source: f.source,
      });
    });

    // 2. Bazaar stock ledger (separate scope — see ITEM_TRACKING.md §6c)
    const bzFlows = logBazaarFlows(log);
    bzFlows.forEach(f => {
      const key = String(f.itemId);
      if (!state.bazaar.items[key]) {
        state.bazaar.items[key] = {
          id: key, name: catalog.itemName(f.itemId), category: catalog.itemCategory(f.itemId), value: catalog.itemValue(f.itemId),
          in: 0, sold: 0, removed: 0, out: 0, net: 0,
          lastTs: 0, sources: {},
        };
      }
      const it = state.bazaar.items[key];
      if (f.dir === 'in') it.in += f.qty;
      else if (f.kind === 'Sold') it.sold += f.qty;
      else it.removed += f.qty;
      it.out = it.sold + it.removed;
      it.net = it.in - it.out;
      it.sources[f.kind] = (it.sources[f.kind] || 0) + f.qty;
      if (f.money) {
        state.bazaar.revenue += f.money;
        state.bazaar.unitsSold += f.qty;
      }
      if (ts > it.lastTs) it.lastTs = ts;

      state.activity.unshift({
        ts, logId: log.id, logType, title, category,
        dir: f.dir, itemId: key, name: it.name, qty: f.qty, source: `Bazaar ${f.kind}`,
      });
      state.locationEvents.bazaar.unshift({ ts, itemId: key, kind: f.kind, qty: f.qty });
      if (f.from && f.to) {
        state.transfers.unshift({ ts, logId: log.id, logType, title, itemId: key, name: it.name, category: it.category, qty: f.qty, from: f.from, to: f.to });
      }
    });

    // 3. Display Case stock ledger (separate scope — see ITEM_TRACKING.md §6d)
    const dispFlows = logDisplayFlows(log);
    dispFlows.forEach(f => {
      const key = String(f.itemId);
      if (!state.display.items[key]) {
        state.display.items[key] = {
          id: key, name: catalog.itemName(f.itemId), category: catalog.itemCategory(f.itemId), value: catalog.itemValue(f.itemId),
          in: 0, removed: 0, net: 0, lastTs: 0,
        };
      }
      const it = state.display.items[key];
      if (f.dir === 'in') it.in += f.qty; else it.removed += f.qty;
      it.net = it.in - it.removed;
      if (ts > it.lastTs) it.lastTs = ts;

      state.activity.unshift({
        ts, logId: log.id, logType, title, category,
        dir: f.dir, itemId: key, name: it.name, qty: f.qty, source: `Display ${f.kind}`,
      });
      state.locationEvents.display.unshift({ ts, itemId: key, kind: f.kind, qty: f.qty });
      if (f.from && f.to) {
        state.transfers.unshift({ ts, logId: log.id, logType, title, itemId: key, name: it.name, category: it.category, qty: f.qty, from: f.from, to: f.to });
      }
    });

    // 4. Item Market listing ledger (separate scope — see ITEM_TRACKING.md §6e)
    const mktFlows = logMarketFlows(log);
    mktFlows.forEach(f => {
      const key = String(f.itemId);
      if (!state.market.items[key]) {
        state.market.items[key] = {
          id: key, name: catalog.itemName(f.itemId), category: catalog.itemCategory(f.itemId), value: catalog.itemValue(f.itemId),
          in: 0, sold: 0, removed: 0, out: 0, net: 0,
          lastTs: 0, sources: {},
        };
      }
      const it = state.market.items[key];
      if (f.dir === 'in') it.in += f.qty;
      else if (f.kind === 'Sold') it.sold += f.qty;
      else it.removed += f.qty;
      it.out = it.sold + it.removed;
      it.net = it.in - it.out;
      it.sources[f.kind] = (it.sources[f.kind] || 0) + f.qty;
      if (f.money) {
        state.market.revenue += f.money;
        state.market.unitsSold += f.qty;
      }
      if (ts > it.lastTs) it.lastTs = ts;

      state.activity.unshift({
        ts, logId: log.id, logType, title, category,
        dir: f.dir, itemId: key, name: it.name, qty: f.qty, source: `Market ${f.kind}`,
      });
      state.locationEvents.market.unshift({ ts, itemId: key, kind: f.kind, qty: f.qty });
      if (f.from && f.to) {
        state.transfers.unshift({ ts, logId: log.id, logType, title, itemId: key, name: it.name, category: it.category, qty: f.qty, from: f.from, to: f.to });
      }
    });

    if (state.activity.length > config.activityMax) state.activity.length = config.activityMax;
    if (state.transfers.length > config.transferMax) state.transfers.length = config.transferMax;
    if (state.locationEvents.bazaar.length > config.locationEventMax) state.locationEvents.bazaar.length = config.locationEventMax;
    if (state.locationEvents.display.length > config.locationEventMax) state.locationEvents.display.length = config.locationEventMax;
    if (state.locationEvents.market.length > config.locationEventMax) state.locationEvents.market.length = config.locationEventMax;

    // 5. Completed trades — group sub-logs by parsed_trade_id (ITEM_TRACKING.md §5)
    const tradeEvent = logTradeEvent(log);
    if (tradeEvent) {
      let g = state.trades.byId.get(tradeEvent.tradeId);
      if (!g) {
        g = { tradeId: tradeEvent.tradeId, ts: tradeEvent.ts, counterpartId: tradeEvent.counterpartId,
              gave: { money: 0, items: [], properties: 0 },
              received: { money: 0, items: [], properties: 0 } };
        state.trades.byId.set(tradeEvent.tradeId, g);
        state.trades.trades.unshift(g);
      }
      if (tradeEvent.ts > g.ts) g.ts = tradeEvent.ts;
      if (tradeEvent.counterpartId != null) g.counterpartId = tradeEvent.counterpartId;
      if (tradeEvent.dir === 'out') {
        if (tradeEvent.money) g.gave.money += tradeEvent.money;
        if (tradeEvent.items && tradeEvent.items.length) mergeTradeItems(g.gave.items, tradeEvent.items);
        if (tradeEvent.properties) g.gave.properties += tradeEvent.properties;
      } else if (tradeEvent.dir === 'in') {
        if (tradeEvent.money) g.received.money += tradeEvent.money;
        if (tradeEvent.items && tradeEvent.items.length) mergeTradeItems(g.received.items, tradeEvent.items);
        if (tradeEvent.properties) g.received.properties += tradeEvent.properties;
      }
      // keep newest-first
      if (state.trades.trades[0] !== g) {
        const idx = state.trades.trades.indexOf(g);
        if (idx > 0) { state.trades.trades.splice(idx, 1); state.trades.trades.unshift(g); }
      }
      if (state.trades.trades.length > config.tradeEventMax) {
        const dropped = state.trades.trades.pop();
        state.trades.byId.delete(dropped.tradeId);
      }
    }

    // 6. Museum exchange reward (7000) — museum points earned
    const mSwap = logMuseumSwap(log);
    if (mSwap) {
      state.museum.pointsReceived += mSwap.pointsReceived;
      state.museum.swaps.unshift({ ts, logId: log.id, set: mSwap.set, quantity: mSwap.quantity, pointsReceived: mSwap.pointsReceived });
      if (state.museum.swaps.length > config.museumSwapMax) state.museum.swaps.length = config.museumSwapMax;
    }

    // 7. FIFO cost basis — create lots (IN) and deplete lots (OUT)
    //    IN: all acquisition events (buys, free items, trade receives, points listing cancelled)
    //    OUT: permanent removals — sells, usage, trades gave, bazaar/market sold
    //    Note: points FIFO OUT fires at 5000 (listing = wallet exit), NOT 5011 (ITEM_TRACKING §6f)
    // Trade items (4445/4446) are handled exclusively by finalizeNewTrades() in trade-fifo.js,
    // which runs after the full batch so proportional cost allocation uses the complete trade group.
    const isFifoIn = C.BUY_LOG_TYPES.has(logType)
      || C.FREE_LOG_TYPES.has(logType)
      || C.AMMO_BUY_LOG_TYPES.has(logType)
      || C.POINTS_LOG_TYPES.has(logType)
      || C.POINTS_MARKET_REMOVE_LOG_TYPES.has(logType)
      || logType === C.VIRUS_COMPLETE_LOG_TYPE
      || logType === C.RACING_UNENLIST_LOG_TYPE;
    if (isFifoIn) fifoIn(log, state, catalog);

    const isFifoOut = C.USAGE_LOG_TYPES.has(logType)
      || C.SELL_LOG_TYPES.has(logType)
      || C.AMMO_SELL_LOG_TYPES.has(logType)
      || C.POINTS_MARKET_ADD_LOG_TYPES.has(logType);  // 5000: points listed → FIFO OUT __points__
    if (isFifoOut) {
      flows.forEach(f => { if (f.dir === 'out') fifoOut(f.itemId, f.qty, state); });
    }
    // Bazaar/market sold events — FIFO out at the time of sale (not when listed)
    bzFlows.forEach(f => { if (f.kind === 'Sold') fifoOut(f.itemId, f.qty, state); });
    mktFlows.forEach(f => { if (f.kind === 'Sold') fifoOut(f.itemId, f.qty, state); });

    // 8. Transaction ledger — record buy/sell money flows for the Ledger tab
    //    Trade transactions are deferred to finalizeNewTrades() in trade-fifo.js
    const tx = logTransactionEvent(log, catalog);
    if (tx) {
      state.transactions.push({ ts, logId: log.id ?? null, logType, ...tx });
    }

    return flows.length + bzFlows.length + dispFlows.length + mktFlows.length;
  };
}

module.exports = { createApplyLog };
