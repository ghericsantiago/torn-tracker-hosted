'use strict';

const db = require('../db');
const {
  BUY_TYPE_SET,
  SELL_TYPE_SET,
  RECEIVE_TYPE_SET,
  SEND_TYPE_SET,
  USE_TYPE_SET,
  DUMP_TYPE_SET,
  TRADE_IN_TYPE_SET,
  TRADE_OUT_TYPE_SET,
} = require('./log-types');

const TAX = 0.05;

// Extract all item entries from a log's data field.
// Returns an array — multi-item logs (trades, abroad buys) yield multiple entries.
// Two Torn API shapes:
//   data.items[]  — buy/sell/receive/trade (array, may have multiple items)
//   data.item     — integer item ID, qty always 1 (use events)
// For multi-item logs cost_total is absent/zero, so unit_cost is 0 (cost unknown).
// For single-item buy logs cost_total / qty gives the correct unit cost.
function extractItems(data) {
  if (Array.isArray(data.items) && data.items.length > 0) {
    // Only attribute cost_total when there is a single item — otherwise it's
    // the combined total across all items and can't be split reliably.
    const costTotal = data.items.length === 1
      ? Number(data.cost_total ?? 0) || 0
      : 0;
    return data.items.map(it => {
      const itemId = Number(it.id ?? it.ID);
      const qty    = Number(it.qty ?? it.quantity ?? 1);
      if (!itemId || qty <= 0) return null;
      return { item_id: itemId, qty, cost_total: costTotal };
    }).filter(Boolean);
  }
  if (data.item != null) {
    const itemId = Number(data.item);
    if (!itemId) return [];
    // Old-format logs store quantity in data.quantity (not inside an items array).
    // cost_total is present for buy/sell types; 0 for use/misc types.
    const qty       = Number(data.quantity ?? 1) || 1;
    const costTotal = Number(data.cost_total ?? 0) || 0;
    return [{ item_id: itemId, qty, cost_total: costTotal }];
  }
  return [];
}

async function withTx(fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function createLot(client, { item_id, qty, unit_cost, source, acquired_log, acquired_at }) {
  await client.query(
    `INSERT INTO torn_lots
       (item_id, acquired_log, acquired_at, qty_original, qty_remaining, unit_cost, source)
     VALUES ($1, $2, $3, $4, $4, $5, $6)
     ON CONFLICT (acquired_log, item_id) DO NOTHING`,
    [item_id, acquired_log, acquired_at, qty, unit_cost, source]
  );
}

// Consume qty units from the oldest available lots (FIFO).
// Creates a synthetic pre_tracking lot at cost=0 if inventory runs short.
// Idempotent: skips entirely if this log_id was already applied to this item.
async function consumeFifo(client, { item_id, qty, unit_revenue, reason, log_id, happened_at }) {
  const { rows: existing } = await client.query(
    `SELECT 1 FROM torn_lot_events e
     JOIN torn_lots l ON l.id = e.lot_id
     WHERE e.log_id = $1 AND l.item_id = $2 LIMIT 1`,
    [log_id, item_id]
  );
  if (existing.length > 0) return;

  const { rows: lots } = await client.query(
    `SELECT id, qty_remaining, unit_cost
     FROM torn_lots
     WHERE item_id = $1 AND qty_remaining > 0
     ORDER BY acquired_at ASC, id ASC
     FOR UPDATE`,
    [item_id]
  );

  const totalAvail = lots.reduce((s, l) => s + l.qty_remaining, 0);
  if (totalAvail < qty) {
    const deficit = qty - totalAvail;
    const { rows: [synth] } = await client.query(
      `INSERT INTO torn_lots
         (item_id, acquired_log, acquired_at, qty_original, qty_remaining, unit_cost, source)
       VALUES ($1, NULL, to_timestamp(0), $2, $2, 0, 'pre_tracking')
       RETURNING id, qty_remaining, unit_cost`,
      [item_id, deficit]
    );
    lots.unshift(synth);
  }

  let remaining = qty;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.qty_remaining);
    const pnl  = (unit_revenue - Number(lot.unit_cost)) * take;

    const { rowCount } = await client.query(
      `INSERT INTO torn_lot_events
         (lot_id, log_id, happened_at, qty, unit_revenue, pnl, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (lot_id, log_id) DO NOTHING`,
      [lot.id, log_id, happened_at, take, unit_revenue, pnl, reason]
    );

    if (rowCount > 0) {
      await client.query(
        'UPDATE torn_lots SET qty_remaining = qty_remaining - $1 WHERE id = $2',
        [take, lot.id]
      );
    }

    remaining -= take;
  }
}

async function processEntry(client, { id, log_type, happened_at, data }) {
  const items = extractItems(data);
  if (!items.length) return;

  for (const item of items) {
    if (BUY_TYPE_SET.has(log_type)) {
      await createLot(client, {
        item_id:      item.item_id,
        qty:          item.qty,
        unit_cost:    item.qty > 0 ? item.cost_total / item.qty : 0,
        source:       'buy',
        acquired_log: id,
        acquired_at:  happened_at,
      });

    } else if (RECEIVE_TYPE_SET.has(log_type)) {
      await createLot(client, {
        item_id:      item.item_id,
        qty:          item.qty,
        unit_cost:    0,
        source:       'received',
        acquired_log: id,
        acquired_at:  happened_at,
      });

    } else if (TRADE_IN_TYPE_SET.has(log_type)) {
      await createLot(client, {
        item_id:      item.item_id,
        qty:          item.qty,
        unit_cost:    0,
        source:       'trade_in',
        acquired_log: id,
        acquired_at:  happened_at,
      });

    } else if (SELL_TYPE_SET.has(log_type)) {
      const unit_revenue = item.qty > 0 ? (item.cost_total * (1 - TAX)) / item.qty : 0;
      await consumeFifo(client, {
        item_id:      item.item_id,
        qty:          item.qty,
        unit_revenue,
        reason:       'sell',
        log_id:       id,
        happened_at,
      });

    } else if (TRADE_OUT_TYPE_SET.has(log_type)) {
      await consumeFifo(client, {
        item_id:      item.item_id,
        qty:          item.qty,
        unit_revenue: 0,
        reason:       'trade_out',
        log_id:       id,
        happened_at,
      });

    } else if (SEND_TYPE_SET.has(log_type)) {
      await consumeFifo(client, {
        item_id:      item.item_id,
        qty:          item.qty,
        unit_revenue: 0,
        reason:       'send',
        log_id:       id,
        happened_at,
      });

    } else if (USE_TYPE_SET.has(log_type)) {
      await consumeFifo(client, {
        item_id:      item.item_id,
        qty:          item.qty,
        unit_revenue: 0,
        reason:       'use',
        log_id:       id,
        happened_at,
      });

    } else if (DUMP_TYPE_SET.has(log_type)) {
      await consumeFifo(client, {
        item_id:      item.item_id,
        qty:          item.qty,
        unit_revenue: 0,
        reason:       'dump',
        log_id:       id,
        happened_at,
      });
    }
    // Unknown log types are silently skipped
  }
}

// Process all torn_logs entries newer than the last cursor, building FIFO lots.
// Safe to call multiple times — every step is idempotent.
async function processLots() {
  const { rows: stateRows } = await db.query(
    "SELECT value FROM torn_sync_state WHERE key = 'last_lot_ts'"
  );
  const lastUnix = stateRows[0]?.value ? Number(stateRows[0].value) : null;

  const { rows: logs } = await db.query(
    `SELECT id, log_type, happened_at, data
     FROM torn_logs
     WHERE ($1::numeric IS NULL OR EXTRACT(EPOCH FROM happened_at) > $1)
     ORDER BY happened_at ASC, id ASC`,
    [lastUnix]
  );

  if (logs.length === 0) {
    console.log('[lots] Nothing new to process');
    return 0;
  }

  let processed = 0;
  for (const log of logs) {
    try {
      await withTx(client => processEntry(client, log));
      processed++;
    } catch (err) {
      console.error(`[lots] Error on log ${log.id} (type ${log.log_type}):`, err.message);
    }
  }

  const newUnix = Math.floor(new Date(logs[logs.length - 1].happened_at).getTime() / 1000);
  await db.query(
    `INSERT INTO torn_sync_state (key, value) VALUES ('last_lot_ts', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(newUnix)]
  );

  console.log(`[lots] ${processed}/${logs.length} log entries processed`);
  return processed;
}

module.exports = { processLots };
