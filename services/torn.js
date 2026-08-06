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

// Torn API errors that are transient and should NOT count as item failures
const RATE_LIMIT_CODES = new Set([5, 8, 14]);

class TornApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TornApiError';
    this.code = code;
    this.isRateLimit = RATE_LIMIT_CODES.has(code);
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
    .map(([id, item]) => ({ id: Number(id), name: item.name, type: item.type }))
    .sort((a, b) => a.name.localeCompare(b.name));

  list.unshift({ id: POINT_MARKET_ID, name: 'Point Market', type: 'Special' });
  return list;
}

module.exports = { fetchItemMarket, fetchPointsMarket, fetchAllTornItems, POINT_MARKET_ID, TornApiError };
