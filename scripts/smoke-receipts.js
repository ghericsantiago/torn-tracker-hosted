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
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error(`Login failed with HTTP ${login.status}`);
  const headers = { Cookie: cookie, Accept: 'application/json' };

  async function page(offset, extra = '') {
    const response = await fetch(`${base}/admin/api/receipts?limit=20&offset=${offset}${extra}`, { headers });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.receipts) || !data.totals) {
      throw new Error(`Receipt page failed: ${JSON.stringify(data)}`);
    }
    if (data.receipts.length > 20) throw new Error(`Page returned ${data.receipts.length} rows`);
    return data;
  }

  const first = await page(0);
  const second = first.total > 20 ? await page(20) : { receipts: [] };
  const firstIds = new Set(first.receipts.map(receipt => receipt.id));
  if (second.receipts.some(receipt => firstIds.has(receipt.id))) throw new Error('Receipt pages overlap');
  if (first.receipts[0]) {
    const filtered = await page(0, `&q=${encodeURIComponent(first.receipts[0].trade_id)}`);
    if (!filtered.receipts.some(receipt => receipt.id === first.receipts[0].id)) throw new Error('Trade ID filter missed its receipt');
  }
  console.log(`Receipt smoke passed: ${first.receipts.length}/${first.total} first-page rows, ${second.receipts.length} second-page rows`);
}

main().catch(error => {
  console.error('[receipt-smoke]', error.message);
  process.exitCode = 1;
});
