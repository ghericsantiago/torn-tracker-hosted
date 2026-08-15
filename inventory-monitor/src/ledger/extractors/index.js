'use strict';

/**
 * Extractor registry — the dispatcher behind `logFlows`.
 *
 * Each extractor module exports `{ types: number[], extract(log, ctx) }` where
 * `extract` returns the uniform `{ dir, itemId, qty, source }` flow list. At build
 * time the registry flattens `types` into a `Map<logType → extractor>` and verifies
 * integrity (no duplicate registrations, no unmapped types in ALL_LOG_TYPES).
 *
 * OCP: adding a new log type = drop in an extractor file + add it to MODULES.
 * The dispatcher never changes.
 */

const C = require('../../constants');

const MODULES = [
  require('./buy-sell'),
  require('./trade-items'),
  require('./museum-swap'),
  require('./blood-bag'),
  require('./transform'),
  require('./virus'),
  require('./racing'),
  require('./locations'),
  require('./points'),
  require('./free-items'),
  require('./usage'),
];

function createLogFlows({ catalog }) {
  const ctx = { catalog };

  // Build Map<logType → extractor>. Type sets are disjoint by construction (the
  // usage extractor excludes 7000/2340 which have their own extractors).
  const registry = new Map();
  for (const mod of MODULES) {
    for (const t of mod.types) {
      if (registry.has(t)) console.warn(`[ledger] duplicate extractor for log type ${t}`);
      registry.set(t, mod.extract);
    }
  }

  // Integrity: every fetched log type must have a registered extractor (types with no
  // inventory flows — trade money/anchor/property, location sells — are expected gaps).
  const NO_FLOW_TYPES = new Set([
    4430, 4440, 4441, 4450, 4451,          // trade sub-logs → grouping only (ledger/trade.js)
    ...C.BAZAAR_SELL_LOG_TYPES,            // 1221/1226 → bazaar ledger only
    ...C.MARKET_SELL_LOG_TYPES,            // 1104/1113 → market ledger only
  ]);
  for (const t of C.ALL_LOG_TYPES) {
    if (!registry.has(t) && !NO_FLOW_TYPES.has(t)) {
      console.warn(`[ledger] log type ${t} has no extractor — check extractors/`);
    }
  }

  return function logFlows(log) {
    const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
    const fn = registry.get(logType);
    return fn ? fn(log, ctx) : [];
  };
}

module.exports = { createLogFlows };
