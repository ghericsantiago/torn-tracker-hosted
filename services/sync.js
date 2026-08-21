const db = require('../db');
const { fetchItemMarket, fetchPointsMarket, POINT_MARKET_ID, TornApiError } = require('./torn');

const MAX_RETRIES = 5;
const PACE_MS     = 700; // ~85 req/min max, safely under the 100/min per-user limit

let syncRunning = false; // prevent overlapping cron runs

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function syncItem(item) {
  const { id, torn_item_id, api_key } = item;
  try {
    const data = torn_item_id === POINT_MARKET_ID
      ? await fetchPointsMarket(api_key)
      : await fetchItemMarket(torn_item_id, api_key);

    // Deduplicate: skip if price unchanged since last record
    const latest = await db.query(
      'SELECT price FROM item_market WHERE item_id = $1 ORDER BY created_at DESC LIMIT 1',
      [torn_item_id]
    );
    if (latest.rows.length && Number(latest.rows[0].price) === Number(data.price)) {
      await db.query(
        `UPDATE monitored_items
         SET last_sync = NOW(), retry_count = 0, last_error = NULL, last_error_date = NULL
         WHERE id = $1`,
        [id]
      );
      return { skipped: true };
    }

    await db.query(
      `INSERT INTO item_market (item_id, name, type, price, average_price, quantity)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [data.item_id, data.name, data.type, data.price, data.average_price, data.quantity]
    );

    await db.query(
      `UPDATE monitored_items
       SET name = $1, last_sync = NOW(), retry_count = 0, last_error = NULL, last_error_date = NULL,
           is_active = TRUE
       WHERE id = $2`,
      [data.name, id]
    );

    return { inserted: true };
  } catch (err) {
    // Rate limit / IP block / daily cap — transient, do NOT penalise the item
    if (err instanceof TornApiError && err.isRateLimit) {
      console.warn(`[sync] Rate limited on item ${id} (code ${err.code}) — skipping this cycle`);
      return { rateLimited: true };
    }

    const newCount = (item.retry_count || 0) + 1;
    const deactivate = newCount > MAX_RETRIES;
    await db.query(
      `UPDATE monitored_items
       SET retry_count = $1, last_error = $2, last_error_date = NOW(),
           is_active = CASE WHEN $3 = TRUE THEN FALSE ELSE is_active END
       WHERE id = $4`,
      [newCount, err.message, deactivate, id]
    );
    return { error: err.message, deactivated: deactivate };
  }
}

async function syncGroup(items) {
  let inserted = 0, skipped = 0, errors = 0, rateLimited = 0;
  for (let i = 0; i < items.length; i++) {
    const result = await syncItem(items[i]);
    if (result.inserted)         inserted++;
    else if (result.skipped)     skipped++;
    else if (result.rateLimited) rateLimited++;
    else                         errors++;
    if (i < items.length - 1) await sleep(PACE_MS);
  }
  return { inserted, skipped, errors, rateLimited };
}

async function syncAllItems() {
  if (syncRunning) {
    console.warn('[sync] Previous run still in progress — skipping this tick');
    return;
  }
  syncRunning = true;

  try {
    const { rows } = await db.query(
      `SELECT * FROM monitored_items
       WHERE is_active = TRUE
          OR (last_error IS NOT NULL AND last_error_date < NOW() - INTERVAL '1 hour')
       ORDER BY last_sync ASC NULLS FIRST`
    );

    // Group by api_key — each key's items run sequentially (700ms paced),
    // but different keys run in parallel
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.api_key)) groups.set(row.api_key, []);
      groups.get(row.api_key).push(row);
    }

    const results = await Promise.all([...groups.values()].map(syncGroup));

    if (rows.length > 0) {
      const t = results.reduce(
        (a, r) => ({ inserted: a.inserted + r.inserted, skipped: a.skipped + r.skipped,
                     errors: a.errors + r.errors, rateLimited: a.rateLimited + r.rateLimited }),
        { inserted: 0, skipped: 0, errors: 0, rateLimited: 0 }
      );
      const parts = [`+${t.inserted} inserted`, `${t.skipped} skipped`, `${t.errors} errors`];
      if (t.rateLimited) parts.push(`${t.rateLimited} rate-limited`);
      console.log(`[sync] ${new Date().toISOString()} — ${rows.length} items / ${groups.size} key(s): ${parts.join(', ')}`);
    }
  } finally {
    syncRunning = false;
  }
}

module.exports = { syncAllItems, syncItem };
