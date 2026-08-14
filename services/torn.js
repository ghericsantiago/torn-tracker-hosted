const fetch = require('node-fetch');

const TORN_BASE      = 'https://api.torn.com';
const POINT_MARKET_ID = 999999999;
const PROXY_URL      = 'https://script.google.com/macros/s/AKfycbxcrwwiq6Gw5aQpUoITlRlLWQ8YTkkArAXh-Rffb7qINGdTi0XMMkNSBFL9xI1e--1B/exec';

function resolveUrl(url) {
  if (process.env.USE_PROXY === 'true') {
    return `${PROXY_URL}?apiUrl=${Buffer.from(url).toString('base64')}`;
  }
  return url;
}

// Torn API errors that are transient and should be retried
const RETRYABLE_CODES = new Set([5, 8, 14, 17]);

class TornApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TornApiError';
    this.code = code;
    this.isRateLimit = RETRYABLE_CODES.has(code);
  }
}

async function tornFetch(url) {
  const resolved = resolveUrl(url);
  const res = await fetch(resolved, { timeout: 15000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.error) {
    const { code, error: msg } = data.error;
    throw new TornApiError(code, `Torn API [${code}]: ${msg}`);
  }
  return data;
}

async function fetchItemMarket(itemId, apiKey) {
  const url  = `${TORN_BASE}/v2/market/${itemId}/itemmarket?key=${apiKey}&comment=TornItemTracker`;
  const data = await tornFetch(url);

  const { item, listings } = data.itemmarket;
  if (!listings || listings.length === 0) throw new Error('No listings available');

  const lowestPrice = listings[0].price;
  // Sum quantity across all sellers listing at the same lowest price
  const quantity = listings
    .filter(l => l.price === lowestPrice)
    .reduce((sum, l) => sum + (l.amount || 0), 0);

  return {
    item_id:       item.id,
    name:          item.name,
    type:          item.type,
    average_price: item.average_price,
    price:         lowestPrice,
    quantity,
  };
}

async function fetchPointsMarket(apiKey) {
  const url     = `${TORN_BASE}/market/points?selections=pointsmarket&limit=1&key=${apiKey}&comment=TornItemTracker`;
  const data    = await tornFetch(url);
  const entries = Object.values(data.pointsmarket);
  if (!entries.length) throw new Error('Empty points market response');
  const pm = entries[0];

  return {
    item_id:       POINT_MARKET_ID,
    name:          'Point Market',
    type:          'point_market',
    average_price: pm.cost,
    price:         pm.cost,
    quantity:      pm.quantity,
  };
}

async function fetchAllTornItems(apiKey) {
  const url  = `${TORN_BASE}/torn/?selections=items&key=${apiKey}`;
  const data = await tornFetch(url);
  const list = Object.entries(data.items || {})
    .map(([id, item]) => ({
      id:           Number(id),
      name:         item.name,
      type:         item.type,
      market_price: item.market_value ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  list.unshift({ id: POINT_MARKET_ID, name: 'Point Market', type: 'Special', market_price: null });
  return list;
}

async function fetchInventoryCategory(category, apiKey) {
  const url  = `${TORN_BASE}/v2/user/inventory?cat=${encodeURIComponent(category)}&key=${apiKey}`;
  const data = await tornFetch(url);
  return (data.inventory?.items || []).map(item => ({
    item_id: item.id,
    qty:     item.amount,
  }));
}

async function fetchBazaar(apiKey) {
  const url  = `${TORN_BASE}/user/?selections=bazaar&key=${apiKey}`;
  const data = await tornFetch(url);
  const raw  = data.bazaar;
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map(i => ({ item_id: i.ID ?? i.id, qty: i.quantity, list_price: i.price }));
  }
  // Object keyed by item id or slot
  return Object.values(raw).map(i => ({ item_id: i.ID ?? i.id, qty: i.quantity, list_price: i.price }));
}

async function fetchDisplay(apiKey) {
  const url  = `${TORN_BASE}/user/?selections=display&key=${apiKey}`;
  const data = await tornFetch(url);
  const raw  = data.display?.items ?? data.display;
  if (!raw) return [];

  const entries = Array.isArray(raw) ? raw : Object.values(raw);
  return entries.map(i => ({ item_id: i.ID ?? i.id, qty: i.quantity ?? 1 }));
}

// Returns { entries: [...], prevUrl: string|null } for one page of user logs.
// Torn strips key= from pagination URLs — re-append before calling.
async function fetchUserLogPage(url, apiKey) {
  const fetchUrl = url.includes('key=') ? url : `${url}&key=${apiKey}`;
  const data     = await tornFetch(fetchUrl);
  const entries  = Array.isArray(data.log) ? data.log : [];
  const prevUrl  = data._metadata?.links?.prev ?? null;
  return { entries, prevUrl };
}

// log=0 returns all log types. API caps pages at 100 entries regardless of limit.
function buildUserLogUrl(apiKey) {
  return `${TORN_BASE}/v2/user/log?log=0&limit=100&sort=desc&key=${apiKey}`;
}

module.exports = {
  fetchItemMarket, fetchPointsMarket, fetchAllTornItems,
  fetchInventoryCategory, fetchBazaar, fetchDisplay,
  fetchUserLogPage, buildUserLogUrl,
  POINT_MARKET_ID, TornApiError,
};
