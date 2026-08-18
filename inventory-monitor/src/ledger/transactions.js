'use strict';

/**
 * logTransactionEvent — extracts a transaction record from a buy/sell log.
 * Returns null for log types that are not tracked in the transaction ledger.
 *
 * logUsageTransactionEvents — extracts usage/gift/faction/museum outflow records.
 * Returns an array (can be empty or multi-item) for USAGE_LOG_TYPES.
 *
 * Trade-generated transaction rows are produced separately in trade-fifo.js
 * (they need all sub-logs assembled before allocation math can run).
 */

const C = require('../constants');
const { extractFreeItems } = require('./extract');

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

// Produces usage/gift/faction/museum outflow records for USAGE_LOG_TYPES.
// Returns [] if this log type is not tracked or yields no useful items.
// Each returned object includes `logId` (null for multi-item logs to avoid
// unique-index conflicts — dedup is handled by the poller's processedSet).
function logUsageTransactionEvents(log, catalog) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;

  if (!C.USAGE_LOG_TYPES.has(logType)) return [];

  const source = C.USAGE_SOURCE_MAP[logType] || 'Used';

  // Faction armory use by a member — item stays in armory, player didn't consume it
  if (source === 'Consumed' && d.faction) return [];

  const channel = C.USAGE_SOURCE_TO_CHANNEL[source] || 'usage';
  const items   = extractFreeItems(d, logType).filter(({ id }) => {
    const s = String(id);
    return !s.startsWith('__set__') && !s.startsWith('__ammo__');
  });

  if (!items.length) return [];

  // Use the real log_id only for single-item logs; multi-item logs get null
  // (ON CONFLICT partial index covers only non-null log_ids).
  const logId = items.length === 1 ? (log.id ?? null) : null;

  return items.map(({ id, qty }) => ({
    channel,
    side:      'use',
    itemId:    String(id),
    itemName:  catalog.itemName(String(id)) || String(id),
    category:  catalog.itemCategory(String(id)) || '',
    qty:       Number(qty) || 1,
    totalPrice: null,
    unitPrice:  null,
    logId,
  }));
}

module.exports = { logTransactionEvent, logUsageTransactionEvents };
