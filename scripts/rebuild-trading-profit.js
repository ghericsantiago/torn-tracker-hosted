'use strict';
require('dotenv').config();
const db = require('../db');
const { rebuildTradingProfit } = require('../services/trading-profit');

rebuildTradingProfit()
  .then(result => console.log(`Trading profit rebuilt: ${result.events} events, ${result.lots} inventory lots, ${result.outflows} outflows`))
  .catch(error => {
    console.error('[trading-profit-rebuild]', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
