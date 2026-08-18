'use strict';

/**
 * logTransactionEvent — extracts a transaction record from a buy/sell log.
 * Returns null for log types that are not tracked in the transaction ledger.
 *
 * Trade-generated transaction rows are produced separately in trade-fifo.js
 * (they need all sub-logs assembled before allocation math can run).
 */

const C = require('../constants');

function logTransactionEvent(log, catalog) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  const meta    = C.TRANSACTION_CHANNEL_MAP.get(logType);
  if (!meta) return null;

  let itemId;
  if (C.POINTS_LOG_TYPES.has(logType) || logType === 5011) {
    itemId = '__points__';
  } else {
    const raw = Array.isArray(d.item) ? d.item[0]?.id : d.item;
    itemId = raw != null ? String(raw) : (d.items?.[0]?.id != null ? String(d.items[0].id) : null);
  }
  if (!itemId) return null;

  const qty        = Number(d.quantity ?? d.items?.[0]?.qty ?? 1) || 1;
  const totalPrice = (d.cost_total != null ? Number(d.cost_total) : d.cost != null ? Number(d.cost) : null);
  const unitPrice  = (totalPrice != null && qty > 0) ? Math.round(totalPrice / qty) : null;

  return {
    channel:    meta.channel,
    side:       meta.side,
    itemId,
    itemName:   itemId === '__points__' ? 'Torn Points' : (catalog.itemName(itemId) || itemId),
    category:   itemId === '__points__' ? 'Points' : (catalog.itemCategory(itemId) || ''),
    qty,
    totalPrice,
    unitPrice,
  };
}

module.exports = { logTransactionEvent };
