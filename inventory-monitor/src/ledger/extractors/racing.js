'use strict';

/**
 * Extractor: Racing car enlist / unenlist (8700 / 8701) — the car is an inventory item
 * (`data.car`) that moves to/from your racing garage:
 *   - 8700 Racing enlist car   → `out` (car left inventory for the garage)
 *   - 8701 Racing unenlist car → `in`  (car back in inventory)
 */

const C = require('../../constants');

const types = [C.RACING_ENLIST_LOG_TYPE, C.RACING_UNENLIST_LOG_TYPE];

function extract(log) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  if (d.car == null) return [];
  return [{
    dir: logType === C.RACING_ENLIST_LOG_TYPE ? 'out' : 'in',
    itemId: d.car,
    qty: 1,
    source: logType === C.RACING_ENLIST_LOG_TYPE ? 'Racing Enlist' : 'Racing Unenlist',
  }];
}

module.exports = { types, extract };
