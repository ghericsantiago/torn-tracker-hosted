const cron = require('node-cron');
const { syncAllItems } = require('./services/sync');
const { cancelUnmatchedPendingReceipts } = require('./services/receipt-reconciliation');
const db = require('./db');

let running      = false;
let lastCleanup  = 0;
let lastReceiptReconciliation = 0;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

async function runCleanup() {
  const now = Date.now();
  if (now - lastCleanup < ONE_DAY_MS) return;
  lastCleanup = now;
  try {
    const deleted = await cleanupOldRecords();
    if (deleted > 0) console.log(`[cleanup] Deleted ${deleted} old market records`);
  } catch (err) {
    console.error('[cleanup] Error:', err.message);
  }
}

async function cleanupOldRecords() {
  const { rows } = await db.query(
    "SELECT value FROM settings WHERE key = 'retention_days'"
  );
  const days = Number(rows[0]?.value) || 0;
  if (!days) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const result = await db.query(
    'DELETE FROM item_market WHERE created_at < $1',
    [cutoff.toISOString()]
  );
  return result.rowCount ?? 0;
}

async function runReceiptReconciliation() {
  const now = Date.now();
  if (now - lastReceiptReconciliation < ONE_HOUR_MS) return;
  lastReceiptReconciliation = now;
  try {
    const cancelled = await cancelUnmatchedPendingReceipts();
    if (cancelled.length) console.log(`[receipts] Auto-cancelled ${cancelled.length} pending receipt(s) without a completed inventory trade`);
  } catch (err) {
    console.error('[receipts] Auto-cancel error:', err.message);
  }
}

function start() {
  cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try {
      await syncAllItems();
      await runCleanup();
      await runReceiptReconciliation();
    } catch (err) {
      console.error('[scheduler] Unexpected error:', err.message, '\n', err.stack);
    } finally {
      running = false;
    }
  });
  console.log('[scheduler] Cron started — syncing every minute');
}

module.exports = { start, cleanupOldRecords };
