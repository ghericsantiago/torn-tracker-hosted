'use strict';

/**
 * Extractor: Container-opening transformations — GAME_MECHANICS.md §1,
 * ITEM_TRACKING.md §3. One log = consume the container + receive its contents:
 *
 *   data.item  → `out` ×1        (the container: drug pack, safe, bag, basket…)
 *   data.item2 → `in` ×quantity  (single result item, e.g. drug pack → drug)
 *   data.items → `in` each       (array [{id, qty}] or object {id: qty} — goodie bag,
 *                                 halloween basket)
 *
 * Skipped entirely when data.faction is set (container came from the faction armory).
 * If neither item2 nor items is present it falls back to plain consumption (out item).
 */

const C = require('../../constants');

// Types verified (against real log data) to carry container→contents shapes:
//   2390 Item use drug pack        → item2 + quantity
//   2400 Item use goodie bag       → items array
//   2480 Item use dukes safe       → item2
//   2535 Item use halloween basket → items object
const types = [2390, 2400, 2480, 2535];

const SOURCE = 'Opened';

function extract(log) {
  const d     = log.data || {};
  const flows = [];

  if (d.faction) return flows;              // faction-armory container → no player flow

  if (d.item != null) {
    flows.push({ dir: 'out', itemId: d.item, qty: 1, source: SOURCE });
  }

  const qty = Number(d.quantity) || 1;
  if (d.item2 != null) {
    flows.push({ dir: 'in', itemId: d.item2, qty, source: SOURCE });
  } else if (Array.isArray(d.items)) {
    d.items.forEach(i => flows.push({ dir: 'in', itemId: i.id, qty: i.qty || 1, source: SOURCE }));
  } else if (d.items && typeof d.items === 'object') {
    Object.entries(d.items).forEach(([id, q]) => flows.push({ dir: 'in', itemId: parseInt(id), qty: q, source: SOURCE }));
  }

  return flows;
}

module.exports = { types, extract };
