'use strict';

/**
 * Extractor: Item usage — consumption / loss (ITEM_TRACKING.md §3).
 * All USAGE_LOG_TYPES → `out`, labelled via USAGE_SOURCE_MAP.
 * Skipped when the source is 'Consumed' and data.faction is set (faction-armory use).
 *
 * 7000 (museum), 2340 (blood bag) and the container-opening transforms
 * (2390/2400/2480/2535) are deliberately excluded — they have their own extractors
 * (museum-swap.js, blood-bag.js, transform.js) so the registry stays unambiguous.
 */

const C = require('../../constants');
const { extractFreeItems } = require('../extract');
const { types: TRANSFORM_TYPES } = require('./transform');

const types = [...C.USAGE_LOG_TYPES].filter(t =>
  t !== C.MUSEUM_LOG_TYPE && t !== C.BLOOD_BAG_LOG_TYPE && !TRANSFORM_TYPES.includes(t));

function extract(log) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  const source  = C.USAGE_SOURCE_MAP[logType] || 'Used';

  if (source === 'Consumed' && d.faction) return [];   // armory use → no player flow
  return extractFreeItems(d, logType).map(({ id, qty }) => ({ dir: 'out', itemId: id, qty, source }));
}

module.exports = { types, extract };
