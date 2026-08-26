'use strict';

/**
 * Reset the inventory monitor database — clears ALL tracked data (inventory, bazaar,
 * display ledgers, dedupe buffer, monitor meta) so the next poll starts fresh from
 * MONITOR_START (see .env).
 *
 * Run:   npm run reset-db
 * Note:  stop the server first — a running server will re-write its in-memory state
 *        on the next poll.
 */

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Read DB credentials from .env (real env vars take precedence).
const env = {};
try {
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch { /* no .env file */ }

const DB = {
  host: process.env.DB_HOST || env.DB_HOST,
  port: parseInt(process.env.DB_PORT || env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || env.DB_NAME,
  user: process.env.DB_USER || env.DB_USER,
  password: process.env.DB_PASS || env.DB_PASS,
};
if (!DB.host || !DB.database || !DB.user) {
  console.error('[reset-db] PostgreSQL not configured — set DB_HOST / DB_NAME / DB_USER (and DB_PASS) in .env');
  process.exit(1);
}

// All tables the monitor can create (schema.sql). Missing ones are skipped.
const ALL_TABLES = [
  'monitor_meta', 'processed_logs', 'item_totals', 'item_sources',
  'activity', 'bazaar_totals', 'bazaar_meta', 'display_totals', 'transfers',
  'location_events',
  'market_totals', 'market_meta', 'trade_events', 'museum_swaps', 'museum_meta',
  'manual_adjustments', 'fifo_lots', 'transactions',
];

(async () => {
  const pool   = new Pool(DB);
  const client = await pool.connect();
  try {
    const exist = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    const have  = new Set(exist.rows.map(r => r.tablename));
    const toClear  = ALL_TABLES.filter(t => have.has(t));
    const missing  = ALL_TABLES.filter(t => !have.has(t));

    if (missing.length) {
      console.warn('[reset-db] skipping (never created — start the server once to create them): ' + missing.join(', '));
    }
    if (!toClear.length) {
      console.log('[reset-db] nothing to clear — no monitor tables exist in ' + DB.database);
    } else {
      await client.query('BEGIN');
      await client.query('TRUNCATE ' + toClear.join(', ') + ' RESTART IDENTITY CASCADE');
      await client.query('COMMIT');
      console.log('[reset-db] cleared ' + DB.database + ': ' + toClear.join(', '));
      console.log('[reset-db] next poll starts fresh from MONITOR_START (see .env)');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[reset-db] failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
