'use strict';

/**
 * Location-ledger flows — Bazaar / Display Case / Item Market.
 * All return uniform `{ dir, itemId, qty, kind, from, to, money? }` flows
 * (LSP: same contract as the inventory flows, but scoped to a location).
 */

const C = require('../constants');
const { extractBazaarItems } = require('./extract');

// Bazaar-scoped flows
function logBazaarFlows(log) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  if (C.BAZAAR_ADD_LOG_TYPES.has(logType)) {
    return extractBazaarItems(d).map(e => ({ dir: 'in', itemId: e.id, qty: e.qty, kind: 'Added', from: 'Inventory', to: 'Bazaar' }));
  }
  if (C.BAZAAR_REMOVE_LOG_TYPES.has(logType)) {
    return extractBazaarItems(d).map(e => ({ dir: 'out', itemId: e.id, qty: e.qty, kind: 'Removed', from: 'Bazaar', to: 'Inventory' }));
  }
  if (C.BAZAAR_SELL_LOG_TYPES.has(logType)) {
    const money = d.cost_total ?? d.cost ?? 0;
    return extractBazaarItems(d).map(e => ({ dir: 'out', itemId: e.id, qty: e.qty, kind: 'Sold', from: 'Bazaar', to: 'Sold', money }));
  }
  return [];
}

// Display Case flows
function logDisplayFlows(log) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  if (C.DISPLAY_ADD_LOG_TYPES.has(logType)) {
    return extractBazaarItems(d).map(e => ({ dir: 'in', itemId: e.id, qty: e.qty, kind: 'Added', from: 'Inventory', to: 'Display' }));
  }
  if (C.DISPLAY_REMOVE_LOG_TYPES.has(logType)) {
    return extractBazaarItems(d).map(e => ({ dir: 'out', itemId: e.id, qty: e.qty, kind: 'Removed', from: 'Display', to: 'Inventory' }));
  }
  return [];
}

// Item Market listing flows
function logMarketFlows(log) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  if (C.MARKET_ADD_LOG_TYPES.has(logType)) {
    return extractBazaarItems(d).map(e => ({ dir: 'in', itemId: e.id, qty: e.qty, kind: 'Added', from: 'Inventory', to: 'Market' }));
  }
  if (C.MARKET_REMOVE_LOG_TYPES.has(logType)) {
    return extractBazaarItems(d).map(e => ({ dir: 'out', itemId: e.id, qty: e.qty, kind: 'Removed', from: 'Market', to: 'Inventory' }));
  }
  if (C.MARKET_SELL_LOG_TYPES.has(logType)) {
    const money = d.cost_total ?? d.cost ?? 0;
    return extractBazaarItems(d).map(e => ({ dir: 'out', itemId: e.id, qty: e.qty, kind: 'Sold', from: 'Market', to: 'Sold', money }));
  }
  return [];
}

module.exports = { logBazaarFlows, logDisplayFlows, logMarketFlows };
