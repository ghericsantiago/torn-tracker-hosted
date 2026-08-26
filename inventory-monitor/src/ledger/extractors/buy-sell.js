'use strict';

/**
 * Extractor: Buy / Sell — inlined shape (ITEM_TRACKING.md §1).
 *  - Buy  (BUY_LOG_TYPES)  → `in`  source 'Buy'
 *  - Sell (SELL_LOG_TYPES) → `out` source 'Sell'
 * Point market buy (5010) has no item id → `__points__` pseudo-item.
 */

const C = require('../../constants');

const types = [...C.BUY_LOG_TYPES, ...C.SELL_LOG_TYPES];

function extract(log) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  const flows   = [];

  let itemId = (Array.isArray(d.item) ? d.item[0]?.id : d.item) ?? d.items?.[0]?.id;
  if (!itemId && C.POINTS_LOG_TYPES.has(logType)) itemId = '__points__';
  if (!itemId) return flows;

  flows.push({
    dir: C.BUY_LOG_TYPES.has(logType) ? 'in' : 'out',
    itemId,
    qty: d.quantity ?? d.items?.[0]?.qty ?? 1,
    source: C.BUY_LOG_TYPES.has(logType) ? 'Buy' : 'Sell',
  });
  return flows;
}

module.exports = { types, extract };
