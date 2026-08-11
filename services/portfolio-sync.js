require('dotenv').config();
const db = require('../db');
const {
  fetchAllTornItems, fetchPointsMarket,
  fetchInventoryCategory, fetchBazaar, fetchDisplay,
  fetchUserLogPage, buildUserLogUrl,
  POINT_MARKET_ID, TornApiError,
} = require('./torn');
const { processLots } = require('./lot-processor');

const INVENTORY_CATEGORIES = [
  'Alcohol', 'Artifact', 'Booster', 'Candy', 'Car', 'Clothing', 'Defensive',
  'Drug', 'Enhancer', 'Energy Drink', 'Flower', 'Jewelry', 'Material',
  'Medical', 'Melee', 'Other', 'Plushie', 'Primary', 'Secondary', 'Special',
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

async function retryOnRateLimit(fn, label) {
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof TornApiError && err.isRateLimit) {
        console.warn(`[portfolio] Transient error on ${label} (code ${err.code}) — waiting 60s`);
        await sleep(60_000);
        continue;
      }
      throw err;
    }
  }
}

async function syncItemCatalog(apiKey) {
  console.log('[portfolio] Updating item catalog...');
  const items = await retryOnRateLimit(() => fetchAllTornItems(apiKey), 'item catalog');

  // Patch in live Points price
  try {
    const pts = await retryOnRateLimit(() => fetchPointsMarket(apiKey), 'points market');
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
  const lastTs     = await getSyncState('last_log_ts');
  const stopAt     = lastTs ? Number(lastTs) : 0;
  const isBackfill = !lastTs;

  let url;
  if (isBackfill) {
    const savedCursor = await getSyncState('backfill_cursor');
    if (savedCursor) {
      url = savedCursor.includes('key=') ? savedCursor : `${savedCursor}&key=${apiKey}`;
      console.log('[portfolio] Resuming backfill from checkpoint');
    } else {
      url = buildUserLogUrl(apiKey);
      console.log('[portfolio] First run — full backfill of all logs');
    }
  } else {
    url = buildUserLogUrl(apiKey);
    console.log(`[portfolio] Incremental sync from ${new Date(stopAt * 1000).toISOString()}`);
  }

  let backfillMaxTs = isBackfill ? Number(await getSyncState('backfill_max_ts') || 0) : 0;
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
        console.warn(`[portfolio] Transient error (code ${err.code}) — waiting 60s`);
        await sleep(60_000);
        continue;
      }
      throw err;
    }

    pages++;

    for (const entry of entries) {
      const ts      = entry.timestamp;
      const logType = entry.details?.id;
      if (!logType) continue;
      if (stopAt && ts <= stopAt) { done = true; break; }

      const logId = entry.id ?? `${ts}_${logType}`;
      await db.query(
        `INSERT INTO torn_logs (id, log_type, happened_at, data)
         VALUES ($1, $2, to_timestamp($3), $4)
         ON CONFLICT (id) DO NOTHING`,
        [logId, logType, ts, JSON.stringify(entry.data ?? {})]
      );
      inserted++;
      if (ts > newMaxTs) newMaxTs = ts;
      if (isBackfill && ts > backfillMaxTs) backfillMaxTs = ts;
    }

    if (!done) {
      url = prevUrl
        ? (prevUrl.includes('key=') ? prevUrl : `${prevUrl}&key=${apiKey}`)
        : null;

      if (isBackfill) {
        if (url) await setSyncState('backfill_cursor', url);
        if (backfillMaxTs > 0) await setSyncState('backfill_max_ts', backfillMaxTs);
      }

      if (url) await sleep(1500);
    }
  }

  if (isBackfill) {
    if (backfillMaxTs > 0) await setSyncState('last_log_ts', backfillMaxTs);
    await db.query("DELETE FROM torn_sync_state WHERE key IN ('backfill_cursor', 'backfill_max_ts')");
    console.log(`[portfolio] Backfill complete: ${pages} pages, ${inserted} entries stored`);
  } else {
    if (newMaxTs > 0) await setSyncState('last_log_ts', newMaxTs);
    console.log(`[portfolio] Logs: ${pages} pages, ${inserted} new entries`);
  }
}

async function snapshotInventory(apiKey) {
  console.log('[portfolio] Snapshotting inventory...');
  const now   = new Date().toISOString();
  let   total = 0;
  const failedCategories = [];

  for (const cat of INVENTORY_CATEGORIES) {
    let items;
    try {
      items = await retryOnRateLimit(() => fetchInventoryCategory(cat, apiKey), `inventory/${cat}`);
    } catch (err) {
      console.warn(`[portfolio] Inventory ${cat} failed:`, err.message);
      failedCategories.push(cat);
      await sleep(500);
      continue;
    }

    // Batch insert for performance
    if (items.length > 0) {
      const vals = items.map((_, i) =>
        `($1, $${i * 2 + 2}, 'inventory', $${i * 2 + 3}, NULL)`
      ).join(', ');
      const params = [now];
      items.forEach(item => { params.push(item.item_id, item.qty); });
      await db.query(
        `INSERT INTO torn_inventory_snapshots (taken_at, item_id, location, qty, list_price) VALUES ${vals}`,
        params
      );
      total += items.length;
    }
    await sleep(500);
  }

  // Bazaar
  try {
    const bazaar = await retryOnRateLimit(() => fetchBazaar(apiKey), 'bazaar');
    if (bazaar.length > 0) {
      const vals = bazaar.map((_, i) =>
        `($1, $${i * 3 + 2}, 'bazaar', $${i * 3 + 3}, $${i * 3 + 4})`
      ).join(', ');
      const params = [now];
      bazaar.forEach(item => { params.push(item.item_id, item.qty, item.list_price); });
      await db.query(
        `INSERT INTO torn_inventory_snapshots (taken_at, item_id, location, qty, list_price) VALUES ${vals}`,
        params
      );
      total += bazaar.length;
    }
  } catch (err) {
    console.warn('[portfolio] Bazaar snapshot failed:', err.message);
    failedCategories.push('bazaar');
  }

  await sleep(500);

  // Display
  try {
    const display = await retryOnRateLimit(() => fetchDisplay(apiKey), 'display');
    if (display.length > 0) {
      const vals = display.map((_, i) =>
        `($1, $${i * 2 + 2}, 'display', $${i * 2 + 3}, NULL)`
      ).join(', ');
      const params = [now];
      display.forEach(item => { params.push(item.item_id, item.qty); });
      await db.query(
        `INSERT INTO torn_inventory_snapshots (taken_at, item_id, location, qty, list_price) VALUES ${vals}`,
        params
      );
      total += display.length;
    }
  } catch (err) {
    console.warn('[portfolio] Display snapshot failed:', err.message);
    failedCategories.push('display');
  }

  if (failedCategories.length > 0) {
    console.warn(`[portfolio] Snapshot complete with failures: ${failedCategories.join(', ')}`);
  }
  await setSyncState('last_snapshot_ts', Math.floor(Date.now() / 1000));
  console.log(`[portfolio] Inventory snapshot: ${total} entries`);
}

let syncRunning    = false;
let logSyncRunning = false;

// Lightweight: only fetch new logs and process lots (1-2 API calls)
async function runLogSync() {
  const apiKey = process.env.TORN_API_KEY;
  if (!apiKey) { console.warn('[portfolio] TORN_API_KEY not set — skipping log sync'); return; }
  if (logSyncRunning || syncRunning) return; // full sync covers this too
  logSyncRunning = true;
  try {
    await syncLogs(apiKey);
    // await processLots();
  } catch (err) {
    console.error('[portfolio] Log sync error:', err.message);
  } finally {
    logSyncRunning = false;
  }
}

// Full sync: catalog + logs + lots + inventory snapshot
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
    await processLots();
    await snapshotInventory(apiKey);
    await setSyncState('last_sync_ts', Math.floor(Date.now() / 1000));
    console.log('[portfolio] Sync complete');
  } catch (err) {
    console.error('[portfolio] Sync error:', err.message, '\n', err.stack);
  } finally {
    syncRunning = false;
  }
}

module.exports = { runSync, runLogSync, syncItemCatalog, snapshotInventory };
