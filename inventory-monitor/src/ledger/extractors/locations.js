'use strict';

/**
 * Extractor: Bazaar / Display / Market stocking — the *inventory-side* of the
 * transfer, keeping the person ledger aligned with the location ledgers
 * (ITEM_TRACKING.md §6c/§6d/§6e):
 *   add    → `out` (item moved out of your inventory)
 *   remove → `in`  (item moved back into your inventory)
 * Sells (1221/1226, 1104/1113) are NOT registered — the item already left inventory
 * when it was stocked/listed (they flow through ledger/locations.js only).
 */

const C = require('../../constants');
const { extractBazaarItems } = require('../extract');

const types = [
  ...C.BAZAAR_ADD_LOG_TYPES, ...C.BAZAAR_REMOVE_LOG_TYPES,
  ...C.DISPLAY_ADD_LOG_TYPES, ...C.DISPLAY_REMOVE_LOG_TYPES,
  ...C.MARKET_ADD_LOG_TYPES, ...C.MARKET_REMOVE_LOG_TYPES,
];

function extract(log) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;

  if (C.BAZAAR_ADD_LOG_TYPES.has(logType)) {
    return extractBazaarItems(d).map(e => ({ dir: 'out', itemId: e.id, qty: e.qty, source: 'Bazaar Add' }));
  }
  if (C.BAZAAR_REMOVE_LOG_TYPES.has(logType)) {
    return extractBazaarItems(d).map(e => ({ dir: 'in', itemId: e.id, qty: e.qty, source: 'Bazaar Remove' }));
  }
  if (C.DISPLAY_ADD_LOG_TYPES.has(logType)) {
    return extractBazaarItems(d).map(e => ({ dir: 'out', itemId: e.id, qty: e.qty, source: 'Display Add' }));
  }
  if (C.DISPLAY_REMOVE_LOG_TYPES.has(logType)) {
    return extractBazaarItems(d).map(e => ({ dir: 'in', itemId: e.id, qty: e.qty, source: 'Display Remove' }));
  }
  if (C.MARKET_ADD_LOG_TYPES.has(logType)) {
    return extractBazaarItems(d).map(e => ({ dir: 'out', itemId: e.id, qty: e.qty, source: 'Market Add' }));
  }
  if (C.MARKET_REMOVE_LOG_TYPES.has(logType)) {
    return extractBazaarItems(d).map(e => ({ dir: 'in', itemId: e.id, qty: e.qty, source: 'Market Remove' }));
  }
  return [];
}

module.exports = { types, extract };
