'use strict';

/**
 * Extractor: Museum exchange (7000) — ITEM_TRACKING.md §4.
 *  - deducts the real set composition from the catalog (× quantity), else a
 *    `__set__<name>` pseudo-item
 *  - also EARNs the swap points (`points_received`) → `__points__` `in`
 */

const C = require('../../constants');

const types = [C.MUSEUM_LOG_TYPE];

function extract(log, ctx) {
  const d     = log.data || {};
  const qty   = d.quantity || 1;
  const flows = [];

  const set = ctx.catalog.museum.get(d.set);
  if (set) {
    set.items.forEach(id => flows.push({ dir: 'out', itemId: id, qty, source: `Museum: ${d.set}` }));
  } else {
    flows.push({ dir: 'out', itemId: `__set__${d.set}`, qty, source: 'Museum Swap' });
  }

  // Museum exchanges also EARN Torn Points → inventory IN
  const points = Number(d.points_received) || 0;
  if (points > 0) flows.push({ dir: 'in', itemId: '__points__', qty: points, source: `Museum: ${d.set}` });

  return flows;
}

module.exports = { types, extract };
