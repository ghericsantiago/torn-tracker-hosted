// Fetch Torn user logs (types 1222 & 1210), paginating backwards via
// _metadata.links.prev, then write the unique item ids + names (resolved
// from torn_items.json) + summed qty to log-items.json.
//
// Usage: node scripts/fetch-log-items.js

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const API_KEY = process.env.TORN_API_KEY;
if (!API_KEY) { console.error('TORN_API_KEY not set in .env'); process.exit(1); }
const START_URL = `https://api.torn.com/v2/user/log?key=${API_KEY}&log=1222,1210&to=1765316073&from=1765143273&sort=asc`;
const ITEMS_PATH = path.join(__dirname, '..', 'torn_items.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'log-items.json');

// Sleep between pages to stay under Torn's ~100 req/min limit.
const SLEEP_MS = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Torn strips key= from pagination URLs — re-append before fetching.
// String-append (rather than URL re-serialization) keeps the raw query intact.
function withKey(url) {
  return url.includes('key=') ? url : `${url}&key=${API_KEY}`;
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

// Extract the cursor timestamp (to=, else from=) from a pagination URL and
// format it as a human-readable UTC date.
function prevCursorDate(prevUrl) {
  if (!prevUrl) return '';
  const m = prevUrl.match(/[?&]to=(\d+)/) || prevUrl.match(/[?&]from=(\d+)/);
  if (!m) return '';
  return new Date(Number(m[1]) * 1000)
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
  let url = START_URL;
  let page = 0;

  while (url) {
    page++;
    let data;
    try {
      data = await fetchPage(withKey(url));
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

    const prevUrl = data?._metadata?.links?.prev ?? null;
    const cursor = prevCursorDate(prevUrl);
    console.log(
      `page ${page}: ${entries.length} entries | ${found.size} unique items` +
      (cursor ? ` | cursor ${cursor}` : '') +
      (prevUrl ? '' : ' — end of history')
    );

    if (!prevUrl) break;
    url = prevUrl;
    await sleep(SLEEP_MS);
  }

  console.log(`\nDone — ${found.size} unique items saved to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
