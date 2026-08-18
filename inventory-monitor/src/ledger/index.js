'use strict';

/**
 * Ledger module — assembles the flow extraction + state application pipeline
 * (one log → state changes). Consumers receive a single `ledger` object via
 * dependency injection (DIP).
 */

const { createApplyLog } = require('./apply');
const { createTradeFifoFinalizer } = require('./trade-fifo');
const { createFifoReconciler } = require('./reconcile');

function createLedger({ catalog, config }) {
  return {
    applyLog:          createApplyLog({ catalog, config }),
    finalizeNewTrades: createTradeFifoFinalizer({ catalog }),
    reconcileFifo:     createFifoReconciler({ catalog }),
  };
}

module.exports = { createLedger };
