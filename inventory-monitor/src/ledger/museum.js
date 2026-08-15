'use strict';

/**
 * Museum exchange reward (7000) — museum points earned per swap.
 * Returns null for non-museum logs.
 */

const C = require('../constants');

function logMuseumSwap(log) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  if (logType !== C.MUSEUM_LOG_TYPE) return null;
  return {
    set: d.set || 'Unknown',
    quantity: d.quantity || 1,
    pointsReceived: Number(d.points_received) || 0,
  };
}

module.exports = { logMuseumSwap };
