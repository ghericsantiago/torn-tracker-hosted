'use strict';

/**
 * Database bootstrap — connection pool + idempotent schema/migrations.
 * The tables are derived data: item_totals/item_sources/activity/bazaar/display/
 * market/transfers/trade_events/museum_swaps are fully rewritten on each applied
 * poll, so migrations can safely drop+recreate them once.
 */

const fs   = require('fs');
const { Pool } = require('pg');

function createPool(config) {
  return new Pool(config.db);
}

async function applySchema(pool, config) {
  const schema = fs.readFileSync(config.schemaFile, 'utf8');
  await pool.query(schema);

  // Migration: databases created before activity had a `category` column (added for the
  // click-popup breakdown). Idempotent — ADD COLUMN IF NOT EXISTS.
  try { await pool.query("ALTER TABLE activity ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT ''"); }
  catch { /* table missing → schema.sql creates it with the column */ }

  // Migration: databases created before item_sources had a `dir` column.
  // The check uses a probe query rather than information_schema (not available on all setups).
  let hasDir = false;
  try {
    await pool.query('SELECT dir FROM item_sources LIMIT 0');
    hasDir = true;
  } catch { /* table missing or no dir column → migrate */ }
  if (!hasDir) {
    console.warn('[init] migrating item_sources → adding dir column (drop + recreate)');
    await pool.query('DROP TABLE IF EXISTS item_sources');
    await pool.query(`CREATE TABLE item_sources (
      item_id text   NOT NULL REFERENCES item_totals(item_id) ON DELETE CASCADE,
      source  text   NOT NULL,
      dir     text   NOT NULL CHECK (dir IN ('in', 'out')),
      qty     bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (item_id, source, dir)
    )`);
  }

  // Migration: trade_events used to be one row per trade log; now one row per
  // completed trade (grouped by parsed_trade_id) with gave/received sides.
  let tradeTableOk = false;
  try {
    await pool.query('SELECT gave_json FROM trade_events LIMIT 0');
    tradeTableOk = true;
  } catch { /* old shape or missing → migrate */ }
  if (!tradeTableOk) {
    console.warn('[init] migrating trade_events → grouped trade rows (drop + recreate)');
    await pool.query('DROP TABLE IF EXISTS trade_events');
    await pool.query(`CREATE TABLE trade_events (
      id             bigserial PRIMARY KEY,
      ts             bigint  NOT NULL,
      trade_id       text,
      counterpart_id bigint,
      gave_json      text    NOT NULL,
      received_json  text    NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_trade_events_ts ON trade_events (ts DESC, id DESC)');
  }

  // Backfill (once): seed location_events from the activity rows that survived the
  // activity cap, so the Bazaar/Display/Market popups work immediately after upgrade
  // (without a full reset). The table only starts empty on first run of this version.
  const locCnt = await pool.query('SELECT count(*)::int AS n FROM location_events');
  if (locCnt.rows[0].n === 0) {
    await pool.query(`INSERT INTO location_events (ts, scope, kind, item_id, qty)
      SELECT ts,
             CASE WHEN source LIKE 'Bazaar %' THEN 'bazaar'
                  WHEN source LIKE 'Display %' THEN 'display'
                  ELSE 'market' END,
             split_part(source, ' ', 2), item_id, qty
      FROM activity
      WHERE source LIKE 'Market %' OR source LIKE 'Bazaar %' OR source LIKE 'Display %'`);
    await pool.query(`DELETE FROM location_events WHERE id NOT IN
      (SELECT id FROM location_events ORDER BY ts DESC, id DESC LIMIT 150000)`);
    console.log('[init] seeded location_events from existing activity');
  }
}

module.exports = { createPool, applySchema };
