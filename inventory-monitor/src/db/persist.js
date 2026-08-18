'use strict';

/**
 * Memory → DB persist: write state changes in one transaction.
 * - monitor_meta: always (every poll, keeps poll status durable)
 * - items/sources/activity/bazaar/display/market/transfers/trades/museum: rewritten
 *   only when new flows were applied (full-replace of derived tables)
 * - processed_logs: appended incrementally, pruned to the newest processedMax
 */

async function persistState(pool, state, config, newProcessed, applied) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO monitor_meta (id, start_ts, last_ts, poll_last_ts, poll_ok, poll_msg, poll_processed, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         start_ts = $1, last_ts = $2, poll_last_ts = $3, poll_ok = $4, poll_msg = $5, poll_processed = $6, updated_at = now()`,
      [state.startTs, state.lastTs, state.poll.lastTs, state.poll.lastOk, state.poll.lastMsg, state.poll.processed]
    );

    if (applied > 0) {
      await client.query('DELETE FROM item_totals');   // cascades item_sources
      for (const it of Object.values(state.items)) {
        await client.query(
          'INSERT INTO item_totals (item_id, name, value, in_qty, out_qty, last_ts) VALUES ($1,$2,$3,$4,$5,$6)',
          [it.id, it.name, it.value, it.in, it.out, it.lastTs]
        );
        for (const [source, qty] of Object.entries(it.sourcesIn)) {
          await client.query('INSERT INTO item_sources (item_id, source, dir, qty) VALUES ($1,$2,$3,$4)', [it.id, source, 'in', qty]);
        }
        for (const [source, qty] of Object.entries(it.sourcesOut)) {
          await client.query('INSERT INTO item_sources (item_id, source, dir, qty) VALUES ($1,$2,$3,$4)', [it.id, source, 'out', qty]);
        }
      }
      await client.query('DELETE FROM activity');
      for (const a of state.activity) {
        await client.query(
          'INSERT INTO activity (ts, log_id, log_type, title, category, dir, item_id, item_name, qty, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [a.ts, a.logId ?? null, a.logType ?? null, a.title ?? null, a.category || '', a.dir, a.itemId, a.name ?? null, a.qty, a.source]
        );
      }
      await client.query(`DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY ts DESC, id DESC LIMIT ${config.activityMax})`);

      // Bazaar stock ledger
      await client.query('DELETE FROM bazaar_totals');
      for (const it of Object.values(state.bazaar.items)) {
        await client.query(
          'INSERT INTO bazaar_totals (item_id, name, value, in_qty, sold_qty, removed_qty, last_ts) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [it.id, it.name, it.value, it.in, it.sold, it.removed, it.lastTs]
        );
      }
      await client.query(
        `INSERT INTO bazaar_meta (id, revenue, units_sold, updated_at)
         VALUES (1, $1, $2, now())
         ON CONFLICT (id) DO UPDATE SET revenue = $1, units_sold = $2, updated_at = now()`,
        [state.bazaar.revenue, state.bazaar.unitsSold]
      );

      // Display Case stock ledger
      await client.query('DELETE FROM display_totals');
      for (const it of Object.values(state.display.items)) {
        await client.query(
          'INSERT INTO display_totals (item_id, name, value, in_qty, removed_qty, last_ts) VALUES ($1,$2,$3,$4,$5,$6)',
          [it.id, it.name, it.value, it.in, it.removed, it.lastTs]
        );
      }

      // Item Market listing ledger
      await client.query('DELETE FROM market_totals');
      for (const it of Object.values(state.market.items)) {
        await client.query(
          'INSERT INTO market_totals (item_id, name, value, in_qty, sold_qty, removed_qty, last_ts) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [it.id, it.name, it.value, it.in, it.sold, it.removed, it.lastTs]
        );
      }
      await client.query(
        `INSERT INTO market_meta (id, revenue, units_sold, updated_at)
         VALUES (1, $1, $2, now())
         ON CONFLICT (id) DO UPDATE SET revenue = $1, units_sold = $2, updated_at = now()`,
        [state.market.revenue, state.market.unitsSold]
      );

      // Transfer events
      await client.query('DELETE FROM transfers');
      for (const t of state.transfers) {
        await client.query(
          'INSERT INTO transfers (ts, log_id, log_type, title, item_id, item_name, qty, from_loc, to_loc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [t.ts, t.logId ?? null, t.logType ?? null, t.title ?? null, t.itemId, t.name ?? null, t.qty, t.from, t.to]
        );
      }
      await client.query(`DELETE FROM transfers WHERE id NOT IN (SELECT id FROM transfers ORDER BY ts DESC, id DESC LIMIT ${config.transferMax})`);

      // Completed trades (grouped)
      await client.query('DELETE FROM trade_events');
      for (const g of state.trades.trades) {
        await client.query(
          'INSERT INTO trade_events (ts, trade_id, counterpart_id, gave_json, received_json) VALUES ($1,$2,$3,$4,$5)',
          [g.ts, g.tradeId ?? null, g.counterpartId ?? null, JSON.stringify(g.gave), JSON.stringify(g.received)]
        );
      }
      await client.query(`DELETE FROM trade_events WHERE id NOT IN (SELECT id FROM trade_events ORDER BY ts DESC, id DESC LIMIT ${config.tradeEventMax})`);

      // Museum exchange rewards
      await client.query('DELETE FROM museum_swaps');
      for (const e of state.museum.swaps) {
        await client.query(
          'INSERT INTO museum_swaps (ts, log_id, set_name, quantity, points_received) VALUES ($1,$2,$3,$4,$5)',
          [e.ts, e.logId ?? null, e.set, e.quantity, e.pointsReceived]
        );
      }
      await client.query(`DELETE FROM museum_swaps WHERE id NOT IN (SELECT id FROM museum_swaps ORDER BY ts DESC, id DESC LIMIT ${config.museumSwapMax})`);
      await client.query(
        `INSERT INTO museum_meta (id, points_received, updated_at)
         VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET points_received = $1, updated_at = now()`,
        [state.museum.pointsReceived]
      );

      // Location-ledger events (per-scope per-item history for the Bazaar/Display/Market popups)
      await client.query('DELETE FROM location_events');
      for (const [scope, list] of Object.entries(state.locationEvents)) {
        for (const e of list) {
          await client.query(
            'INSERT INTO location_events (ts, scope, kind, item_id, qty, log_id) VALUES ($1,$2,$3,$4,$5,$6)',
            [e.ts, scope, e.kind, e.itemId, e.qty, e.logId ?? null]
          );
        }
      }

      // FIFO lots — append-only: INSERT new lots, UPDATE dirty (remaining_qty changed) lots
      for (const lot of state.fifo.newLots) {
        const r = await client.query(
          `INSERT INTO fifo_lots (ts, log_id, item_id, item_name, item_category, total_qty, remaining_qty, unit_cost, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT DO NOTHING RETURNING id`,
          [lot.ts, lot.logId, lot.itemId, lot.itemName, lot.category || null,
           lot.totalQty, lot.remaining, lot.unitCost, lot.source]
        );
        if (r.rows[0]) lot.id = Number(r.rows[0].id);
      }
      state.fifo.newLots = [];

      for (const id of state.fifo.dirtyIds) {
        // Find the current remaining value for this lot id
        let remaining = 0;
        outer: for (const lots of state.fifo.lots.values()) {
          for (const lot of lots) {
            if (lot.id === id) { remaining = lot.remaining; break outer; }
          }
        }
        await client.query('UPDATE fifo_lots SET remaining_qty = $1 WHERE id = $2', [remaining, id]);
      }
      state.fifo.dirtyIds.clear();

      // Transactions — INSERT, skip on duplicate log_id (idempotent)
      for (const tx of state.transactions) {
        await client.query(
          `INSERT INTO transactions (ts, log_id, log_type, channel, side, item_id, item_name, item_category, qty, unit_price, total_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (log_id) WHERE log_id IS NOT NULL DO NOTHING`,
          [tx.ts, tx.logId ?? null, tx.logType, tx.channel, tx.side,
           tx.itemId, tx.itemName, tx.category || null, tx.qty, tx.unitPrice ?? null, tx.totalPrice ?? null]
        );
      }
      state.transactions = [];
    }

    if (newProcessed.length) {
      await client.query('INSERT INTO processed_logs (log_id) SELECT * FROM unnest($1::text[]) ON CONFLICT (log_id) DO NOTHING', [newProcessed]);
      await client.query(`DELETE FROM processed_logs WHERE log_id IN (SELECT log_id FROM processed_logs ORDER BY processed_at DESC OFFSET ${config.processedMax})`);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { persistState };
