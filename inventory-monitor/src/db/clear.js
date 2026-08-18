'use strict';

/**
 * Reset — wipe all tracked data (used by the Reset button / reset endpoint).
 */

async function clearState(pool, state) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM item_totals');
    await client.query('DELETE FROM activity');
    await client.query('DELETE FROM processed_logs');
    await client.query('DELETE FROM bazaar_totals');
    await client.query('UPDATE bazaar_meta SET revenue = 0, units_sold = 0, updated_at = now() WHERE id = 1');
    await client.query('DELETE FROM display_totals');
    await client.query('DELETE FROM transfers');
    await client.query('DELETE FROM location_events');
    await client.query('DELETE FROM market_totals');
    await client.query('UPDATE market_meta SET revenue = 0, units_sold = 0, updated_at = now() WHERE id = 1');
    await client.query('DELETE FROM trade_events');
    await client.query('DELETE FROM museum_swaps');
    await client.query('UPDATE museum_meta SET points_received = 0, updated_at = now() WHERE id = 1');
    await client.query('DELETE FROM manual_adjustments');
    await client.query('DELETE FROM fifo_lots');
    await client.query('DELETE FROM transactions');
    await client.query(
      `INSERT INTO monitor_meta (id, start_ts, last_ts, poll_last_ts, poll_ok, poll_msg, poll_processed, updated_at)
       VALUES (1, $1, NULL, $2, true, 'State reset — next poll refetches from start', 0, now())
       ON CONFLICT (id) DO UPDATE SET last_ts = NULL, poll_last_ts = $2, poll_ok = true,
         poll_msg = 'State reset — next poll refetches from start', poll_processed = 0, updated_at = now()`,
      [state.startTs, Date.now()]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { clearState };
