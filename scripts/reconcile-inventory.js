#!/usr/bin/env node
'use strict';

require('dotenv').config();
const db = require('../db');

async function main() {
  console.log('[reconcile] Loading latest inventory snapshot...');

  // 1. Get latest snapshot totals per item (sum across inventory + bazaar + display)
  const { rows: snapRows } = await db.query(`
    WITH latest AS (
      SELECT DISTINCT ON (item_id, location) item_id, location, qty
      FROM torn_inventory_snapshots
      ORDER BY item_id, location, taken_at DESC
    )
    SELECT item_id, SUM(qty) AS real_qty
    FROM latest
    GROUP BY item_id
  `);
  console.log(`[reconcile] Snapshot: ${snapRows.length} distinct items`);

  // 2. Get tracked lot totals
  const { rows: lotRows } = await db.query(`
    SELECT item_id, SUM(qty_remaining) AS tracked_qty
    FROM torn_lots
    WHERE qty_remaining > 0
    GROUP BY item_id
  `);
  console.log(`[reconcile] Tracked lots: ${lotRows.length} distinct items`);

  // Build lookup maps
  const snapMap = new Map(snapRows.map(r => [r.item_id, Number(r.real_qty)]));
  const lotMap  = new Map(lotRows.map(r  => [r.item_id, Number(r.tracked_qty)]));

  // Collect all item IDs from both sides
  const allIds = new Set([...snapMap.keys(), ...lotMap.keys()]);

  let addedLots    = 0;
  let consumedLots = 0;
  let addedUnits   = 0;
  let removedUnits = 0;

  const now = new Date().toISOString();

  for (const itemId of allIds) {
    const real    = snapMap.get(itemId) || 0;
    const tracked = lotMap.get(itemId)  || 0;
    const diff    = real - tracked;

    if (diff === 0) continue;

    if (diff > 0) {
      // Real inventory has MORE — create a synthetic lot
      const marketPrice = await getMarketPrice(itemId);
      await db.query(`
        INSERT INTO torn_lots (item_id, acquired_at, qty_original, qty_remaining, unit_cost, source)
        VALUES ($1, NOW(), $2, $2, $3, 'reconciliation')
      `, [itemId, diff, marketPrice]);
      addedLots++;
      addedUnits += diff;
      console.log(`  + ${itemId}: added ${diff} units (market price: ${marketPrice})`);
    } else {
      // Tracked has MORE — consume from FIFO lots
      const excess = -diff;
      const consumed = await consumeFifoLots(itemId, excess, now);
      consumedLots += consumed.lots;
      removedUnits += consumed.units;
      console.log(`  - ${itemId}: consumed ${consumed.units} units across ${consumed.lots} lots`);
    }
  }

  console.log('\n── Reconciliation complete ─────────────────');
  console.log(`  Lots created:   ${addedLots}  (${addedUnits} units added)`);
  console.log(`  Lots consumed:  ${consumedLots}  (${removedUnits} units removed)`);
  console.log(`  Items touched:  ${addedLots + consumedLots}`);

  await db.end();
}

async function getMarketPrice(itemId) {
  const { rows } = await db.query(
    'SELECT market_price FROM torn_items WHERE id = $1', [itemId]
  );
  return rows[0]?.market_price != null ? Number(rows[0].market_price) : 0;
}

// Consume excess quantity from lots using FIFO (oldest lots first)
async function consumeFifoLots(itemId, needed, happenedAt) {
  const { rows: lots } = await db.query(`
    SELECT id, qty_remaining, unit_cost
    FROM torn_lots
    WHERE item_id = $1 AND qty_remaining > 0
    ORDER BY acquired_at ASC, id ASC
  `, [itemId]);

  let remaining = needed;
  let lotsTouched = 0;
  let totalConsumed = 0;

  for (const lot of lots) {
    if (remaining <= 0) break;
    const consume = Math.min(remaining, lot.qty_remaining);

    await db.query(`
      INSERT INTO torn_lot_events (lot_id, happened_at, qty, unit_revenue, pnl, reason)
      VALUES ($1, $2, $3, 0, $4, 'reconciliation')
    `, [lot.id, happenedAt, consume, -consume * Number(lot.unit_cost)]);

    await db.query(`
      UPDATE torn_lots SET qty_remaining = qty_remaining - $1 WHERE id = $2
    `, [consume, lot.id]);

    remaining -= consume;
    totalConsumed += consume;
    lotsTouched++;
  }

  return { lots: lotsTouched, units: totalConsumed };
}

main().catch(err => {
  console.error('[reconcile] Error:', err.message);
  process.exit(1);
});
