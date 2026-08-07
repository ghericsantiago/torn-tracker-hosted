#!/usr/bin/env node
'use strict';

require('dotenv').config();
const db = require('../db');
const { processLots } = require('../services/lot-processor');

async function main() {
  console.log('[build-lots] Connecting to DB...');

  // Sanity check: count existing torn_logs
  const { rows: logCount } = await db.query('SELECT COUNT(*) AS n FROM torn_logs');
  console.log(`[build-lots] torn_logs rows: ${logCount[0].n}`);

  const reset     = process.argv.includes('--reset');
  const fullReset = process.argv.includes('--full-reset');

  if (fullReset) {
    await db.query('TRUNCATE torn_lot_events, torn_lots RESTART IDENTITY CASCADE');
    await db.query("DELETE FROM torn_sync_state WHERE key = 'last_lot_ts'");
    console.log('[build-lots] Full reset — lot tables wiped, reprocessing all logs');
  } else if (reset) {
    await db.query("DELETE FROM torn_sync_state WHERE key = 'last_lot_ts'");
    console.log('[build-lots] Cursor reset — will reprocess all logs');
  }

  console.log('[build-lots] Running lot processor...');
  const processed = await processLots();

  // Print result summary
  const { rows: lotRows }   = await db.query('SELECT COUNT(*) AS n, SUM(qty_remaining) AS remaining FROM torn_lots');
  const { rows: eventRows } = await db.query('SELECT COUNT(*) AS n, SUM(pnl) AS total_pnl FROM torn_lot_events');

  console.log('\n── Results ──────────────────────────────');
  console.log(`  Logs processed:    ${processed}`);
  console.log(`  Lots created:      ${lotRows[0].n}`);
  console.log(`  Total remaining:   ${lotRows[0].remaining ?? 0} units`);
  console.log(`  Events recorded:   ${eventRows[0].n}`);
  console.log(`  Realized P&L:      ${Number(eventRows[0].total_pnl ?? 0).toLocaleString()}`);

  await db.end();
}

main().catch(err => {
  console.error('[build-lots] Error:', err.message);
  process.exit(1);
});
