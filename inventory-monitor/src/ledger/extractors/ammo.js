'use strict';

/**
 * Extractor: Ammo buy (4500) / sell (4510).
 * Data shape: { ammo: <typeId>, quantity: <rounds>, value: <$> }
 * Maps to the same __ammo__<typeId>__0 pseudo-item used by crime/stock/company ammo.
 */

const C = require('../../constants');

const types = [...C.AMMO_BUY_LOG_TYPES, ...C.AMMO_SELL_LOG_TYPES];

function extract(log) {
  const d       = log.data || {};
  const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
  if (!d.ammo || !d.quantity) return [];
  const dir    = C.AMMO_BUY_LOG_TYPES.has(logType) ? 'in' : 'out';
  const source = C.AMMO_BUY_LOG_TYPES.has(logType) ? 'Ammo Buy' : 'Ammo Sell';
  return [{ dir, itemId: `__ammo__${d.ammo}__0`, qty: d.quantity, source }];
}

module.exports = { types, extract };
