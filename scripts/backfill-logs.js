require('dotenv').config();
const db = require('../db');
const { fetchUserLogPage, TornApiError } = require('../services/torn');

const TORN_BASE = 'https://api.torn.com';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getState(key) {
  const { rows } = await db.query('SELECT value FROM torn_sync_state WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

async function setState(key, value) {
  await db.query(
    `INSERT INTO torn_sync_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, String(value)]
  );
}

async function delState(key) {
  await db.query('DELETE FROM torn_sync_state WHERE key = $1', [key]);
}

// Fetch a page of logs using explicit to= timestamp for backwards pagination
function buildToUrl(apiKey, toTs) {
  const to = toTs ? `&to=${toTs}` : '';
  return `${TORN_BASE}/v2/user/log?log=0&limit=1000&sort=desc${to}&key=${apiKey}`;
}

async function backfill() {
  const apiKey = process.env.TORN_API_KEY;
  if (!apiKey) { console.error('TORN_API_KEY not set'); process.exit(1); }

  // Mark as running
  await setState('backfill_running', '1');

  // Resume from checkpoint if available
  const savedToTs   = await getState('backfill_to_cursor');
  const savedPages  = await getState('backfill_pages');
  let toTs          = savedToTs ? Number(savedToTs) : null;
  let pages         = savedPages ? Number(savedPages) : 0;
  let inserted      = 0;

  // If no checkpoint, start from the oldest log we already have — don't re-fetch
  if (!savedToTs) {
    const { rows: oldest } = await db.query('SELECT MIN(happened_at) AS ts FROM torn_logs');
    if (oldest[0]?.ts) {
      toTs = Math.floor(new Date(oldest[0].ts).getTime() / 1000) - 1;
      console.log(`[backfill] DB has logs from ${oldest[0].ts.toISOString().slice(0,10)} — starting from older`);
    }
  }

  console.log(savedToTs
    ? `[backfill] Resuming from ${new Date(toTs * 1000).toISOString()}...`
    : '[backfill] Starting full history fetch (newest → oldest)...'
  );

  while (true) {
    const url = buildToUrl(apiKey, toTs);
    let entries;
    try {
      ({ entries } = await fetchUserLogPage(url, apiKey));
    } catch (err) {
      if (err instanceof TornApiError && err.isRateLimit) {
        console.warn('[backfill] Rate limited — waiting 60s');
        await sleep(60_000);
        continue;
      }
      await delState('backfill_running');
      throw err;
    }

    if (!entries.length) {
      console.log('[backfill] Empty page — reached the beginning of history');
      break;
    }

    pages++;

    let pageInserted = 0;
    for (const entry of entries) {
      const logType = entry.details?.id;
      if (!logType) continue;

      const logId = entry.id ?? `${entry.timestamp}_${logType}`;
      const result = await db.query(
        `INSERT INTO torn_logs (id, log_type, happened_at, data)
         VALUES ($1, $2, to_timestamp($3), $4)
         ON CONFLICT (id) DO NOTHING`,
        [logId, logType, entry.timestamp, JSON.stringify(entry.data ?? {})]
      );
      if (result.rowCount > 0) { inserted++; pageInserted++; }
    }

    // The Torn API `to=` parameter is EXCLUSIVE (returns ts < to, not ts ≤ to),
    // and the page size is capped at 100 entries regardless of limit=.
    // To include all entries at ts=oldestTs on the next page, use oldestTs+1.
    // If we're stuck (full page, nothing new, same cursor), force-advance past
    // this second to avoid an infinite loop (>100 events in one second).
    const oldestTs = entries.at(-1).timestamp;
    const oldest   = new Date(oldestTs * 1000).toISOString().slice(0, 10);
    const newest   = new Date(entries[0].timestamp * 1000).toISOString().slice(0, 10);
    console.log(`[backfill] Page ${pages}: ${newest} → ${oldest} | +${inserted} new total`);

    const stuck = pageInserted === 0 && entries.length >= 100 && toTs === oldestTs + 1;
    const nextToTs = stuck ? oldestTs : oldestTs + 1;

    await setState('backfill_to_cursor', nextToTs);
    await setState('backfill_pages',     pages);
    await setState('backfill_oldest_ts', oldestTs);

    toTs = nextToTs;
    await sleep(1500);
  }

  // Cleanup and finalize
  await delState('backfill_running');
  await delState('backfill_to_cursor');
  await delState('backfill_pages');
  await setState('backfill_completed', '1'); // marks that we reached the beginning of history

  // Update last_log_ts to the newest entry so incremental sync picks up from here
  const { rows: newest } = await db.query('SELECT MAX(happened_at) AS ts FROM torn_logs');
  if (newest[0].ts) {
    const unixTs = Math.floor(new Date(newest[0].ts).getTime() / 1000);
    await setState('last_log_ts', unixTs);
  }

  const { rows: stats } = await db.query(
    'SELECT COUNT(*) AS n, MIN(happened_at) AS oldest, MAX(happened_at) AS newest FROM torn_logs'
  );
  const s = stats[0];
  console.log(`\n[backfill] Complete — ${pages} pages, ${inserted} new rows`);
  console.log(`[backfill] DB total: ${s.n} logs | ${s.oldest} → ${s.newest}`);
  process.exit(0);
}

backfill().catch(async err => {
  console.error('[backfill] Fatal:', err.message);
  try { await delState('backfill_running'); } catch {}
  process.exit(1);
});
