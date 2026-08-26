'use strict';

/**
 * FIFO cost-basis tracking.
 *
 * fifoIn  — creates a new cost lot on acquisition (buy, free item, trade receive).
 * fifoOut — depletes the oldest lot(s) on removal (sell, use, trade give).
 *
 * Lots live in state.fifo.lots (Map: item_id → lot[]), oldest-first.
 * New lots go into state.fifo.newLots for INSERT on the next persist.
 * Modified lots have their id added to state.fifo.dirtyIds for UPDATE.
 */

const C = require('../constants');

function _itemIdFromLog(log) {
  const d = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  if (C.POINTS_LOG_TYPES.has(logType) || C.POINTS_MARKET_REMOVE_LOG_TYPES.has(logType)) return '__points__';
  const raw = Array.isArray(d.item) ? d.item[0]?.id : d.item;
  return raw != null ? String(raw) : (d.items?.[0]?.id != null ? String(d.items[0].id) : null);
}

function _qtyFromLog(log) {
  const d = log.data || {};
  return Number(d.quantity ?? d.items?.[0]?.qty ?? 1) || 1;
}

function fifoIn(log, state, catalog) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  const ts      = (log.timestamp || 0) * 1000;
  const logId   = log.id ?? null;

  const itemId = _itemIdFromLog(log);
  if (!itemId) return null;

  const qty = _qtyFromLog(log);

  // Unit cost: paid buys use cost_total; everything else (free, trade-receive, etc.) is $0.
  let unitCost = 0;
  if (C.BUY_LOG_TYPES.has(logType) || C.AMMO_BUY_LOG_TYPES.has(logType)) {
    const total = Number(d.cost_total ?? d.cost ?? 0) || 0;
    unitCost = qty > 0 ? Math.round(total / qty) : 0;
  }
  // Points market buy (5010) — cost_total is the $ paid for the points
  if (C.POINTS_LOG_TYPES.has(logType)) {
    const total = Number(d.cost_total ?? d.cost ?? 0) || 0;
    unitCost = qty > 0 ? Math.round(total / qty) : 0;
  }

  const source = C.BUY_LOG_TYPES.has(logType) ? 'Buy'
    : C.AMMO_BUY_LOG_TYPES.has(logType) ? 'Ammo Buy'
    : C.POINTS_LOG_TYPES.has(logType) ? 'Points Buy'
    : C.POINTS_MARKET_REMOVE_LOG_TYPES.has(logType) ? 'Points Return'
    : C.FREE_LOG_TYPES.has(logType) ? (C.FREE_SOURCE_MAP[logType] || 'Free')
    : C.TRADE_IN_LOG_TYPES.has(logType) ? 'Trade'
    : logType === C.VIRUS_COMPLETE_LOG_TYPE ? 'Virus'
    : logType === C.RACING_UNENLIST_LOG_TYPE ? 'Racing'
    : 'Free';

  const lot = {
    id: null,  // filled in by persist after INSERT RETURNING id
    ts,
    logId,
    itemId,
    itemName: itemId === '__points__' ? 'Torn Points' : (catalog.itemName(itemId) || itemId),
    category: itemId === '__points__' ? 'Points' : (catalog.itemCategory(itemId) || ''),
    totalQty: qty,
    remaining: qty,
    unitCost,
    source,
  };

  // Push into the in-memory map (append = oldest-first order since logs are applied chronologically)
  if (!state.fifo.lots.has(itemId)) state.fifo.lots.set(itemId, []);
  state.fifo.lots.get(itemId).push(lot);

  // Track the most recent non-zero price so the reconciler can price shortfall lots
  if (unitCost > 0) state.fifo.lastKnownCost.set(itemId, unitCost);

  state.fifo.newLots.push(lot);
  return lot;
}

function fifoOut(itemId, qty, state) {
  if (!qty || qty <= 0) return;
  const lots = state.fifo.lots.get(String(itemId));
  if (!lots || !lots.length) return;

  let toConsume = qty;
  for (const lot of lots) {
    if (lot.remaining <= 0) continue;
    if (toConsume <= 0) break;
    const take = Math.min(lot.remaining, toConsume);
    lot.remaining -= take;
    toConsume     -= take;
    if (lot.id != null) {
      state.fifo.dirtyIds.add(lot.id);
    } else {
      // Lot not yet persisted (created this batch) — dirty tracking via newLots array reference is enough.
      // The persist step INSERTs with the current remaining value, so nothing extra needed here.
    }
  }
}

module.exports = { fifoIn, fifoOut };
