'use strict';

/**
 * Extractor: Trades — items only (ITEM_TRACKING.md §5).
 *  - 4445 Trade items outgoing → `out`
 *  - 4446 Trade items incoming → `in`
 * Money / property / anchor sub-logs (4430/4440/4441/4450/4451) produce NO inventory
 * flows — they only feed the trade grouping (ledger/trade.js) and are not registered.
 */

const C = require('../../constants');

const types = [...C.TRADE_OUT_LOG_TYPES, ...C.TRADE_IN_LOG_TYPES];

function extract(log) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  const dir     = C.TRADE_OUT_LOG_TYPES.has(logType) ? 'out' : 'in';
  return (d.items || []).map(i => ({ dir, itemId: i.id, qty: i.qty || 1, source: 'Trade' }));
}

module.exports = { types, extract };
