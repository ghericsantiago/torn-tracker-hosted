// Fetch Torn user logs (types 1222 & 1210) using the nanostamp cursor,
// then write the unique item ids + names (resolved from torn_items.json)
// + summed qty to log-items.json. Results are persisted after every page.
//
// Usage: node scripts/fetch-log-items.js

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const API_KEY = process.env.TORN_API_KEY;
if (!API_KEY) { console.error('TORN_API_KEY not set in .env'); process.exit(1); }

const TORN_BASE  = 'https://api.torn.com/v2/user/log';
const LOG_TYPES  = '1222,1210';
const ITEMS_PATH = path.join(__dirname, '..', 'torn_items.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'log-items.json');

// Sleep between pages to stay under Torn's ~100 req/min limit.
const SLEEP_MS = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// No limit/sort/to/from — pass the nanostamp cursor and let the API decide
// how many records to return (each response includes the next nanostamp).
function buildLogUrl(nano) {
  let url = `${TORN_BASE}?key=${API_KEY}&log=${LOG_TYPES}`;
  if (nano) url += `&nanostamp=${nano}`;
  return url;
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function saveResults(found) {
  const result = [...found.entries()]
    .map(([id, v]) => ({ id, name: v.name, qty: v.qty }))
    .sort((a, b) => a.id - b.id);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  return result;
}

// nanostamp looks like "<unix-seconds><9-digit-nanos>"; first 10 chars = seconds.
function nanoDate(nano) {
  if (!nano || nano === '0') return '';
  const seconds = Number(nano.slice(0, 10));
  if (!seconds) return '';
  return new Date(seconds * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
}

async function main() {
  // Build item id -> name lookup.
  const itemNames = new Map();
  for (const item of require(ITEMS_PATH).items) {
    itemNames.set(item.id, item.name);
  }

  const found = new Map(); // item id -> { name, qty } (qty summed across logs)
  let nano = null; // nanostamp cursor from the previous page
  let page = 0;

  while (true) {
    page++;
    let data;
    try {
      data = await fetchPage(buildLogUrl(nano));
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn(`[page ${page}] request timed out — retrying`);
        continue;
      }
      throw err;
    }

    if (data.error) {
      // Torn error code 5 = "Too many requests".
      if (data.error.code === 5) {
        console.warn(`[page ${page}] rate limited — waiting 60s`);
        await sleep(60_000);
        continue;
      }
      throw new Error(`Torn API [${data.error.code}]: ${data.error.error}`);
    }

    const entries = Array.isArray(data.log) ? data.log : [];
    for (const entry of entries) {
      const items = entry?.data?.items;
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        if (it?.id == null) continue;
        const qty = Number(it.qty) || 0;
        if (!found.has(it.id)) {
          found.set(it.id, { name: itemNames.get(it.id) ?? null, qty: 0 });
        }
        found.get(it.id).qty += qty;
      }
    }

    // Persist after each page so partial progress is never lost.
    saveResults(found);

    const nextNano = data?._metadata?.nanostamp ?? null;
    const isLast = entries.length === 0 || !nextNano || nextNano === '0';
    const cursor = nanoDate(nextNano);
    console.log(
      `page ${page}: ${entries.length} entries | ${found.size} unique items` +
      (cursor ? ` | cursor ${cursor}` : '') +
      (isLast ? ' — end of history' : '')
    );

    if (isLast) break;
    nano = nextNano;
    await sleep(SLEEP_MS);
  }

  console.log(`\nDone — ${found.size} unique items saved to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
