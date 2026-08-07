require('dotenv').config();
const db = require('../db');
const {
  fetchAllTornItems, fetchPointsMarket,
  fetchInventoryCategory, fetchBazaar, fetchDisplay,
  fetchUserLogPage, buildUserLogUrl,
  POINT_MARKET_ID, TornApiError,
} = require('./torn');

const BUY_TYPES  = [1103, 1112, 1220, 1225, 4201, 4200];
const SELL_TYPES = [1104, 1113, 1221, 1226, 4210, 4220];
const ALL_LOG_TYPES = [...BUY_TYPES, ...SELL_TYPES];

const BUY_TYPE_SET  = new Set(BUY_TYPES);
const SELL_TYPE_SET = new Set(SELL_TYPES);

const SOURCE_MAP = {
  1103: 'item_market',   1104: 'item_market',
  1112: 'npc',           1113: 'npc',
  1220: 'bazaar',        1221: 'bazaar',
  1225: 'trade',         1226: 'trade',
  4200: 'points_market', 4201: 'points_market',
  4210: 'points_market', 4220: 'points_market',
};

const INVENTORY_CATEGORIES = [
  'Alcohol', 'Artifact', 'Booster', 'Candy', 'Clothing', 'Defensive',
  'Drug', 'Enhancer', 'Energy Drink', 'Flower', 'Jewelry', 'Material',
  'Medical', 'Melee', 'Other', 'Primary', 'Secondary', 'Special',
  'Supply Pack', 'Temporary', 'Tool',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getSyncState(key) {
  const { rows } = await db.query('SELECT value FROM torn_sync_state WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

async function setSyncState(key, value) {
  await db.query(
    `INSERT INTO torn_sync_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, String(value)]
  );
}

async function syncItemCatalog(apiKey) {
  console.log('[portfolio] Updating item catalog...');
  const items = await fetchAllTornItems(apiKey);

  // Patch in live Points price
  try {
    const pts = await fetchPointsMarket(apiKey);
    const ptsItem = items.find(i => i.id === POINT_MARKET_ID);
    if (ptsItem) ptsItem.market_price = pts.price;
  } catch (err) {
    console.warn('[portfolio] Points market fetch failed:', err.message);
  }

  for (const item of items) {
    await db.query(
      `INSERT INTO torn_items (id, name, type, market_price, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET name = $2, type = $3, market_price = $4, updated_at = NOW()`,
      [item.id, item.name, item.type, item.market_price]
    );
  }
  console.log(`[portfolio] Catalog updated: ${items.length} items`);
}

async function syncLogs(apiKey) {
  const lastTs   = await getSyncState('last_log_ts');
  const stopAt   = lastTs ? Number(lastTs) : 0;
  const isBackfill = !lastTs;

  console.log(isBackfill
    ? '[portfolio] First run — full backfill of buy/sell logs'
    : `[portfolio] Incremental log sync from ${new Date(stopAt * 1000).toISOString()}`);

  let url      = buildUserLogUrl(apiKey, ALL_LOG_TYPES);
  let inserted = 0;
  let pages    = 0;
  let newMaxTs = 0;
  let done     = false;

  while (url && !done) {
    let entries, prevUrl;
    try {
      ({ entries, prevUrl } = await fetchUserLogPage(url, apiKey));
    } catch (err) {
      if (err instanceof TornApiError && err.isRateLimit) {
        console.warn(`[portfolio] Rate limited (code ${err.code}) — waiting 60s`);
        await sleep(60_000);
        continue; // retry same url
      }
      throw err;
    }

    pages++;

    for (const entry of entries) {
      const ts      = entry.timestamp;
      const logType = entry.details?.id;
      const item    = entry.data?.items?.[0];

      if (!item || !logType) continue;

      // Stop paginating once we reach already-processed entries
      if (stopAt && ts <= stopAt) { done = true; break; }

      const type = BUY_TYPE_SET.has(logType) ? 'buy'
                 : SELL_TYPE_SET.has(logType) ? 'sell'
                 : null;
      if (!type) continue;

      const qty   = item.qty;
      const total = entry.data?.cost_total;
      if (!qty || !total) continue;

      const logId  = `${ts}_${logType}_${item.id}`;
      const source = SOURCE_MAP[logType] ?? 'other';

      await db.query(
        `INSERT INTO torn_transactions
           (torn_log_id, happened_at, type, item_id, qty, unit_price, total_amount, source)
         VALUES ($1, to_timestamp($2), $3, $4, $5, $6, $7, $8)
         ON CONFLICT (torn_log_id) DO NOTHING`,
        [logId, ts, type, item.id, qty, total / qty, total, source]
      );
      inserted++;
      if (ts > newMaxTs) newMaxTs = ts;
    }

    if (!done) {
      url = prevUrl
        ? (prevUrl.includes('key=') ? prevUrl : `${prevUrl}&key=${apiKey}`)
        : null;
      if (url) await sleep(600); // ~100 req/min max
    }
  }

  if (newMaxTs > 0) await setSyncState('last_log_ts', newMaxTs);
  console.log(`[portfolio] Logs: ${pages} pages, ${inserted} new entries`);
}

async function snapshotInventory(apiKey) {
  console.log('[portfolio] Snapshotting inventory...');
  const now   = new Date().toISOString();
  let   total = 0;

  for (const cat of INVENTORY_CATEGORIES) {
    try {
      const items = await fetchInventoryCategory(cat, apiKey);
      for (const item of items) {
        await db.query(
          `INSERT INTO torn_inventory_snapshots (taken_at, item_id, location, qty, list_price)
           VALUES ($1, $2, 'inventory', $3, NULL)`,
          [now, item.item_id, item.qty]
        );
        total++;
      }
    } catch (err) {
      console.warn(`[portfolio] Inventory ${cat} failed:`, err.message);
    }
    await sleep(300);
  }

  try {
    const bazaar = await fetchBazaar(apiKey);
    for (const item of bazaar) {
      await db.query(
        `INSERT INTO torn_inventory_snapshots (taken_at, item_id, location, qty, list_price)
         VALUES ($1, $2, 'bazaar', $3, $4)`,
        [now, item.item_id, item.qty, item.list_price]
      );
      total++;
    }
  } catch (err) {
    console.warn('[portfolio] Bazaar snapshot failed:', err.message);
  }

  await sleep(300);

  try {
    const display = await fetchDisplay(apiKey);
    for (const item of display) {
      await db.query(
        `INSERT INTO torn_inventory_snapshots (taken_at, item_id, location, qty, list_price)
         VALUES ($1, $2, 'display', $3, NULL)`,
        [now, item.item_id, item.qty]
      );
      total++;
    }
  } catch (err) {
    console.warn('[portfolio] Display snapshot failed:', err.message);
  }

  await setSyncState('last_snapshot_ts', Math.floor(Date.now() / 1000));
  console.log(`[portfolio] Inventory snapshot: ${total} entries`);
}

let syncRunning = false;

async function runSync() {
  const apiKey = process.env.TORN_API_KEY;
  if (!apiKey) {
    console.error('[portfolio] TORN_API_KEY not set — skipping sync');
    return;
  }
  if (syncRunning) {
    console.warn('[portfolio] Sync already running — skipping');
    return;
  }
  syncRunning = true;
  try {
    await syncItemCatalog(apiKey);
    await syncLogs(apiKey);
    await snapshotInventory(apiKey);
    await setSyncState('last_sync_ts', Math.floor(Date.now() / 1000));
    console.log('[portfolio] Sync complete');
  } catch (err) {
    console.error('[portfolio] Sync error:', err.message, '\n', err.stack);
  } finally {
    syncRunning = false;
  }
}

module.exports = { runSync };
