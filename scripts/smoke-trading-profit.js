'use strict';

require('dotenv').config();

async function main() {
  const base = `http://127.0.0.1:${process.env.PORT || 3001}`;
  const login = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: process.env.ADMIN_USER || 'admin',
      password: process.env.ADMIN_PASS || 'changeme',
    }),
    redirect: 'manual',
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error(`Login failed with HTTP ${login.status}`);

  const headers = { Cookie: cookie, Accept: 'application/json' };
  const overviewResponse = await fetch(`${base}/admin/api/trading-profit/overview?limit=2&offset=0&sort=date&direction=desc`, { headers });
  const overview = await overviewResponse.json();
  if (!overviewResponse.ok || !Array.isArray(overview.items)) {
    throw new Error(`Overview failed: ${JSON.stringify(overview)}`);
  }

  const itemId = overview.items[0]?.item_id;
  if (!itemId) throw new Error('Overview returned no items');
  const lotsResponse = await fetch(`${base}/admin/api/trading-profit/items/${itemId}?lot_limit=2&lot_offset=0&lot_sort=date&lot_direction=desc&lot_status=open`, { headers });
  const lots = await lotsResponse.json();
  if (!lotsResponse.ok || !Array.isArray(lots.lots)) {
    throw new Error(`Lots failed: ${JSON.stringify(lots)}`);
  }

  console.log(`Trading Profit smoke passed: ${overview.items.length}/${overview.total} items, ${lots.lots.length}/${lots.lotTotal} open lots`);
}

main().catch(error => {
  console.error('[trading-profit-smoke]', error.message);
  process.exitCode = 1;
});
