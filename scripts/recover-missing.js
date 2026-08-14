// Fetches a specific time window from the Torn API and inserts any missing entries.
// Usage: node scripts/recover-missing.js <from_ts> <to_ts> [log_types]
// Example: node scripts/recover-missing.js 1766124000 1766138400 1210,1222

require('dotenv').config();
const fetch = require('node-fetch');
const db    = require('../db');

const TORN_BASE = 'https://api.torn.com';

async function run() {
  const apiKey  = process.env.TORN_API_KEY;
  const from    = process.argv[2];
  const to      = process.argv[3];
  const logArg  = process.argv[4] ?? '0';

  if (!from || !to) {
    console.error('Usage: node scripts/recover-missing.js <from_ts> <to_ts> [log_types]');
    process.exit(1);
  }

  const url  = `${TORN_BASE}/v2/user/log?log=${logArg}&limit=10000&from=${from}&to=${to}&key=${apiKey}`;
  console.log(`Fetching: ${url.replace(apiKey, '***')}`);

  const res  = await fetch(url);
  const data = await res.json();

  if (data.error) {
    console.error('API error:', data.error);
    process.exit(1);
  }

  const entries = Array.isArray(data.log) ? data.log : [];
  console.log(`Got ${entries.length} entries from API`);

  let inserted = 0, skipped = 0;
  for (const entry of entries) {
    const logType = entry.details?.id;
    if (!logType) { skipped++; continue; }

    const logId = entry.id ?? `${entry.timestamp}_${logType}`;
    const result = await db.query(
      `INSERT INTO torn_logs (id, log_type, happened_at, data)
       VALUES ($1, $2, to_timestamp($3), $4)
       ON CONFLICT (id) DO NOTHING`,
      [logId, logType, entry.timestamp, JSON.stringify(entry.data ?? {})]
    );
    if (result.rowCount > 0) inserted++;
  }

  console.log(`Done — ${inserted} new entries inserted, ${entries.length - inserted - skipped} already existed, ${skipped} skipped (no type)`);
  await db.end?.();
  process.exit(0);
}

run().catch(err => { console.error(err.message); process.exit(1); });
