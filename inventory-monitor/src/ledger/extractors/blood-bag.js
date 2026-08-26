'use strict';

/**
 * Extractor: Empty blood bag transformation (2340) — GAME_MECHANICS.md §1,
 * ITEM_TRACKING.md §3. `out` empty bag (data.item), `in` filled bag (data.blood_bag)
 * unless it lands in the faction armory (data.armory_deposit).
 */

const C = require('../../constants');

const types = [C.BLOOD_BAG_LOG_TYPE];

function extract(log) {
  const d     = log.data || {};
  const flows = [];

  if (d.faction) return flows;              // used from faction armory → no player flow
  flows.push({ dir: 'out', itemId: d.item, qty: d.quantity || 1, source: 'Transformed' });
  if (!d.armory_deposit && d.blood_bag) {   // filled bag created in own inventory
    flows.push({ dir: 'in', itemId: d.blood_bag, qty: 1, source: 'Transformed' });
  }
  return flows;
}

module.exports = { types, extract };
