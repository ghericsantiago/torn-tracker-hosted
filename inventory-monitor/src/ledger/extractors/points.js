'use strict';

/**
 * Extractor: Torn Points — market listing + usage (ITEM_TRACKING.md §6f).
 * Points are the `__points__` pseudo-item ("Torn Points" in the UI):
 *   - 5000 Points market add (listing) → `out` 'Points Market Add'
 *   - 5001 Points market remove        → `in`  'Points Market Remove'
 *   - 4900–4975 Points usage           → `out` 'Points Used: <kind>'
 *     qty = data.points_used; skipped when data.faction is set (faction-armory points).
 */

const C = require('../../constants');

const types = [
  ...C.POINTS_MARKET_ADD_LOG_TYPES, ...C.POINTS_MARKET_REMOVE_LOG_TYPES,
  ...C.POINT_USAGE_LOG_TYPES,
];

function extract(log) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  const flows   = [];

  // Market listing — listing moves points out of your wallet, removing moves them back
  if (C.POINTS_MARKET_ADD_LOG_TYPES.has(logType) || C.POINTS_MARKET_REMOVE_LOG_TYPES.has(logType)) {
    const add = C.POINTS_MARKET_ADD_LOG_TYPES.has(logType);
    const qty = Number(d.quantity) || 0;
    if (qty > 0) flows.push({ dir: add ? 'out' : 'in', itemId: '__points__', qty,
                              source: add ? 'Points Market Add' : 'Points Market Remove' });
    return flows;
  }

  // Usage — points spent on refills / unlocks / merits
  if (d.faction && String(d.faction).trim()) return flows;   // used from faction armory → no player flow
  const qty = Number(d.points_used ?? d.points ?? 0);
  if (qty > 0) flows.push({ dir: 'out', itemId: '__points__', qty, source: C.POINT_USAGE_SOURCE[logType] || 'Points Used' });
  return flows;
}

module.exports = { types, extract };
