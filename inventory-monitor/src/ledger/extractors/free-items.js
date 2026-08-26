'use strict';

/**
 * Extractor: Free items — income (ITEM_TRACKING.md §2).
 * All FREE_LOG_TYPES → `in`, labelled per type via FREE_SOURCE_MAP.
 */

const C = require('../../constants');
const { extractFreeItems } = require('../extract');

const types = [...C.FREE_LOG_TYPES];

function extract(log) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  const source  = C.FREE_SOURCE_MAP[logType] || 'Free';
  return extractFreeItems(d, logType).map(({ id, qty }) => ({ dir: 'in', itemId: id, qty, source }));
}

module.exports = { types, extract };
