'use strict';

/**
 * Ledger module — assembles the flow extraction + state application pipeline
 * (one log → state changes). Consumers receive a single `ledger` object via
 * dependency injection (DIP).
 */

const { createApplyLog } = require('./apply');

function createLedger({ catalog, config }) {
  return {
    applyLog: createApplyLog({ catalog, config }),
  };
}

module.exports = { createLedger };
