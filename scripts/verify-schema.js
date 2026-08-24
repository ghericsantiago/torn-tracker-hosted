'use strict';

require('dotenv').config();
const { Client } = require('pg');

const REQUIRED_COLUMNS = {
  monitored_items: ['priority', 'last_sync', 'last_error_date'],
  torn_items: ['market_price', 'updated_at'],
  trade_profiles: ['default_market_pct', 'category_order', 'receipt_token'],
  trade_listings: ['torn_item_id', 'price_mode', 'market_pct', 'fixed_price'],
  trade_category_configs: ['item_type', 'market_pct'],
  trade_receipts: ['short_id', 'items', 'total_value', 'completed_at'],
  activity: ['category'],
  manual_adjustments: ['scope'],
  item_sources: ['dir'],
  trade_events: ['gave_json', 'received_json'],
};

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'torn_tracker',
    user: process.env.DB_USER || 'torn_user',
    password: process.env.DB_PASS || '',
  });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT cls.relname AS table_name, attr.attname AS column_name
      FROM pg_catalog.pg_class cls
      JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
      JOIN pg_catalog.pg_attribute attr ON attr.attrelid = cls.oid
      WHERE ns.nspname = 'public'
        AND cls.relkind IN ('r', 'p')
        AND attr.attnum > 0
        AND NOT attr.attisdropped
    `);
    const columns = {};
    for (const row of rows) (columns[row.table_name] ||= new Set()).add(row.column_name);

    let failures = 0;
    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
      const missing = required.filter(column => !columns[table]?.has(column));
      console.log(missing.length ? 'MISSING' : 'ok', table, missing.join(', '));
      if (missing.length) failures++;
    }
    if (failures) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('[verify-schema]', error.message);
  process.exitCode = 1;
});
