const express = require('express');
const cors    = require('cors');
const https   = require('https');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const db      = require('../db');

function shortId() {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

const APP_URL = 'https://torn-imarket-tracker.gvsantiago.com';
const FIXTURE_MODE = process.env.RECEIPT_FIXTURE_MODE === 'true' && process.env.NODE_ENV !== 'production';
const FIXTURE_TRADE_ID = String(process.env.RECEIPT_FIXTURE_TRADE_ID || '99999999');
const FIXTURE_FILE = path.resolve(
  process.env.RECEIPT_FIXTURE_FILE || path.join(__dirname, '../tests/fixtures/receipt-trade.json')
);
let fixtureTradeOverride = null;

if (process.env.RECEIPT_FIXTURE_MODE === 'true' && process.env.NODE_ENV === 'production') {
  console.warn('[receipt] fixture mode ignored because NODE_ENV=production');
} else if (FIXTURE_MODE) {
  console.warn(`[receipt] LOCAL FIXTURE MODE enabled for trade ${FIXTURE_TRADE_ID}: ${FIXTURE_FILE}`);
}

const CORS_TORN = {
  origin: 'https://www.torn.com',
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Receipt-Token'],
};

async function verifyToken(req, res) {
  const token = req.headers['x-receipt-token'];
  if (!token) { res.status(401).json({ error: 'Missing X-Receipt-Token' }); return false; }
  const { rows } = await db.query('SELECT receipt_token FROM trade_profiles WHERE id = 1');
  if (!rows.length || String(rows[0].receipt_token) !== String(token)) {
    res.status(403).json({ error: 'Invalid token' }); return false;
  }
  return true;
}

async function fetchTornTrade(tradeId) {
  if (FIXTURE_MODE && String(tradeId) === FIXTURE_TRADE_ID) {
    const raw = fixtureTradeOverride || JSON.parse(await fs.promises.readFile(FIXTURE_FILE, 'utf8'));
    const fixture = JSON.parse(JSON.stringify(raw));
    if (!fixture?.trade || !Array.isArray(fixture.trade.items)) {
      throw new Error('Receipt fixture must contain trade.items[]');
    }
    return fixture;
  }
  return new Promise((resolve, reject) => {
    const url = `https://api.torn.com/v2/user/${tradeId}/trade?key=${process.env.TORN_API_KEY}`;
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from Torn API')); }
      });
    }).on('error', reject);
  });
}

// ── Price lookup using 3-level cascade SQL ─────────────────────────────────────
const PRICE_LOOKUP = `
  SELECT
    tl.torn_item_id,
    COALESCE(tl.item_name, ti.name) AS item_name,
    tl.item_type,
    tl.price_mode, tl.fixed_price,
    ti.market_price,
    COALESCE(tl.market_pct, tcc.market_pct, tp.default_market_pct) AS resolved_pct,
    CASE
      WHEN tl.price_mode = 'fixed' THEN tl.fixed_price
      WHEN ti.market_price IS NOT NULL
        THEN ROUND(ti.market_price *
               COALESCE(tl.market_pct, tcc.market_pct, tp.default_market_pct))
      ELSE NULL
    END AS effective_price
  FROM trade_listings tl
  LEFT JOIN torn_items ti  ON ti.id = tl.torn_item_id
  LEFT JOIN trade_category_configs tcc ON tcc.profile_id = tl.profile_id AND tcc.item_type = tl.item_type
  LEFT JOIN trade_profiles tp ON tp.id = tl.profile_id
  WHERE tl.profile_id = 1 AND tl.torn_item_id = ANY($1::int[])
`;

async function buildPricedItems(tornData, itemsOverride) {
  const trade  = tornData?.trade || {};
  const buyer  = trade.user   || {};
  const seller = trade.trader || {};

  // Price items offered by the other party (trade.user)
  const rawItems = (trade.items || []).filter(
    i => i.type === 'Item' && i.user_id === buyer.id
  );
  const itemIds = rawItems.map(i => i.details?.id).filter(Boolean);

  // Catalog price lookup + name/market fallback for uncatalogued items + global pct
  const priceMap = {}, itemMap = {};
  let globalPct = null;
  if (itemIds.length) {
    const [priceRes, itemRes, latestMarketRes, frequentMarketRes, profileRes] = await Promise.all([
      db.query(PRICE_LOOKUP, [itemIds]),
      db.query('SELECT id, name, market_price FROM torn_items WHERE id = ANY($1::int[])', [itemIds]),
      db.query(
        `SELECT DISTINCT ON (item_id) item_id, price, created_at
         FROM item_market
         WHERE item_id = ANY($1::int[])
         ORDER BY item_id, created_at DESC`,
        [itemIds]
      ),
      db.query(
        `WITH observations AS (
           SELECT item_id, price, created_at,
                  (created_at AT TIME ZONE 'Asia/Manila')::date AS tracked_date
           FROM item_market
           WHERE item_id = ANY($1::int[]) AND price IS NOT NULL
         ), selected_days AS (
           SELECT item_id, MAX(tracked_date) AS tracked_date
           FROM observations
           GROUP BY item_id
         ), frequencies AS (
           SELECT o.item_id, o.price, o.tracked_date,
                  COUNT(*)::int AS sample_count,
                  MAX(o.created_at) AS last_observed_at,
                  ROW_NUMBER() OVER (
                    PARTITION BY o.item_id
                    ORDER BY COUNT(*) DESC, MAX(o.created_at) DESC, o.price ASC
                  ) AS rank
           FROM observations o
           JOIN selected_days d USING (item_id, tracked_date)
           GROUP BY o.item_id, o.price, o.tracked_date
         )
         SELECT item_id, price, tracked_date, sample_count, last_observed_at
         FROM frequencies
         WHERE rank = 1`,
        [itemIds]
      ),
      db.query('SELECT default_market_pct FROM trade_profiles WHERE id = 1'),
    ]);
    for (const r of priceRes.rows) priceMap[r.torn_item_id] = r;
    for (const r of itemRes.rows)  itemMap[r.id] = r;
    const latestMarketMap = Object.fromEntries(latestMarketRes.rows.map(r => [r.item_id, r]));
    const frequentMarketMap = Object.fromEntries(frequentMarketRes.rows.map(r => [r.item_id, r]));
    globalPct = profileRes.rows[0]?.default_market_pct ?? null;

    for (const id of itemIds) {
      if (itemMap[id]) {
        itemMap[id].latest_market = latestMarketMap[id] || null;
        itemMap[id].frequent_market = frequentMarketMap[id] || null;
      }
    }
  }

  // Override map: { torn_item_id → unit_price }
  const overrideMap = {};
  if (Array.isArray(itemsOverride)) {
    for (const ov of itemsOverride) {
      overrideMap[ov.torn_item_id] = {
        unitPrice: Number(ov.unit_price),
        marketProtectionApplied: ov.market_protection_applied === true,
        marketDropPct: Number(ov.market_drop_pct) || null,
        marketProtectionThresholdPct: Number(ov.market_protection_threshold_pct) || null,
        unprotectedPrice: Number(ov.unprotected_price) || null,
        protectionLowestPrice: Number(ov.protection_lowest_price) || null,
        protectionMarketValue: Number(ov.protection_market_value) || null,
        priceMode: ['fixed', 'market_pct'].includes(ov.override_price_mode) ? ov.override_price_mode : null,
        marketPct: Number(ov.override_market_pct) || null,
      };
    }
  }

  let totalValue = 0;
  const items = rawItems.map(ti => {
    const id      = ti.details?.id;
    const qty     = ti.details?.amount || 1;
    const listing = priceMap[id];
    const baseItem = itemMap[id];
    const latestMarket = baseItem?.latest_market || null;
    const frequentMarket = baseItem?.frequent_market || null;

    let catalogPrice = listing ? (Number(listing.effective_price) || null) : null;
    if (!listing && baseItem?.market_price && globalPct) {
      catalogPrice = Math.round(Number(baseItem.market_price) * Number(globalPct));
    }

    const override = overrideMap[id];
    let effectiveUnit = catalogPrice;
    if (override && Number.isFinite(override.unitPrice)) effectiveUnit = override.unitPrice;

    const marketPrice = listing ? Number(listing.market_price) : (baseItem?.market_price ? Number(baseItem.market_price) : null);
    const effectiveTotal = effectiveUnit != null ? effectiveUnit * qty : null;
    if (effectiveTotal != null) totalValue += effectiveTotal;

    return {
      torn_item_id:    id,
      item_name:       listing?.item_name || baseItem?.name || `Item #${id}`,
      item_type:       listing?.item_type || null,
      quantity:        qty,
      market_price:    marketPrice,
      latest_lowest_price: latestMarket?.price != null ? Number(latestMarket.price) : null,
      latest_lowest_at: latestMarket?.created_at || null,
      market_reference_price: frequentMarket?.price != null ? Number(frequentMarket.price) : null,
      market_reference_date: frequentMarket?.tracked_date || null,
      market_reference_samples: frequentMarket?.sample_count != null ? Number(frequentMarket.sample_count) : null,
      market_reference_last_observed_at: frequentMarket?.last_observed_at || null,
      price_mode:      override?.priceMode || listing?.price_mode || (catalogPrice != null && !listing ? 'market_pct' : null),
      resolved_pct:    override?.priceMode === 'market_pct'
        ? override.marketPct
        : override?.priceMode === 'fixed'
          ? null
          : listing ? Number(listing.resolved_pct) : (!listing && globalPct ? Number(globalPct) : null),
      catalog_price:   catalogPrice,
      effective_price: effectiveUnit,
      effective_total: effectiveTotal,
      in_catalog:      !!listing,
      market_protection_applied: override?.marketProtectionApplied || false,
      market_drop_pct: override?.marketProtectionApplied ? override.marketDropPct : null,
      market_protection_threshold_pct: override?.marketProtectionApplied ? override.marketProtectionThresholdPct : null,
      unprotected_price: override?.marketProtectionApplied ? override.unprotectedPrice : null,
      protection_lowest_price: override?.marketProtectionApplied ? override.protectionLowestPrice : null,
      protection_market_value: override?.marketProtectionApplied ? override.protectionMarketValue : null,
    };
  });

  return { buyer, seller, items, totalValue: totalValue || null };
}

function applyMarketDropProtection(items) {
  return items.map(item => {
    const marketValue = Number(item.market_price) || 0;
    const lowestOffer = Number(item.market_reference_price) || 0;
    const buyRate = Number(item.resolved_pct) || 0;
    const currentOffer = Number(item.effective_price) || 0;
    if (item.price_mode !== 'market_pct' || marketValue <= 0 || lowestOffer <= 0 || buyRate <= 0) return item;
    const dropPct = ((marketValue - lowestOffer) / marketValue) * 100;
    if (dropPct <= 0) return item;
    const protectedOffer = Math.round(lowestOffer * buyRate);
    if (protectedOffer >= currentOffer) return item;
    return {
      ...item,
      effective_price: protectedOffer,
      effective_total: protectedOffer * item.quantity,
      market_protection_applied: true,
      market_drop_pct: dropPct,
      market_protection_threshold_pct: null,
      unprotected_price: currentOffer,
      protection_lowest_price: lowestOffer,
      protection_market_value: marketValue,
    };
  });
}

// ── GET /api/receipt/token (admin) — MUST be before /:id ─────────────────────
router.get('/api/receipt/token', require('../middleware/auth'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT receipt_token FROM trade_profiles WHERE id = 1');
    const receiptToken = rows[0]?.receipt_token || null;
    res.json({ token: receiptToken, receipt_token: receiptToken });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/receipt/token/regenerate', require('../middleware/auth'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE trade_profiles
       SET receipt_token = gen_random_uuid(), updated_at = NOW()
       WHERE id = 1
       RETURNING receipt_token`
    );
    if (!rows.length) return res.status(404).json({ error: 'Trade profile not found' });
    res.json({ token: rows[0].receipt_token, receipt_token: rows[0].receipt_token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Local-only fixture UI and helpers. These are unreachable unless fixture mode
// is explicitly enabled outside production.
router.get('/receipt-test', (req, res) => {
  if (!FIXTURE_MODE) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, '../public/receipt-test/index.html'));
});

router.get('/trade-simulator', (req, res) => {
  if (!FIXTURE_MODE) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, '../public/trade-simulator/index.html'));
});

router.get('/api/receipt/fixture/trade', async (req, res) => {
  if (!FIXTURE_MODE) return res.status(404).json({ error: 'Not found' });
  try {
    if (!await verifyToken(req, res)) return;
    res.json(await fetchTornTrade(FIXTURE_TRADE_ID));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/receipt/fixture/trade', async (req, res) => {
  if (!FIXTURE_MODE) return res.status(404).json({ error: 'Not found' });
  try {
    if (!await verifyToken(req, res)) return;
    const requested = Array.isArray(req.body.items) ? req.body.items : [];
    if (!requested.length || requested.length > 50) {
      return res.status(400).json({ error: 'items must contain 1 to 50 rows' });
    }
    const normalized = requested.map(item => ({
      id: Number(item.torn_item_id),
      amount: Math.min(1000000, Math.max(1, Math.round(Number(item.quantity) || 1))),
    }));
    if (normalized.some(item => !Number.isInteger(item.id) || item.id <= 0)) {
      return res.status(400).json({ error: 'Every item requires a valid torn_item_id' });
    }
    const base = JSON.parse(await fs.promises.readFile(FIXTURE_FILE, 'utf8'));
    const seller = base.trade.user;
    base.trade.items = normalized.map(item => ({
      type: 'Item',
      user_id: seller.id,
      details: { id: item.id, amount: item.amount },
    }));
    fixtureTradeOverride = base;
    res.json({ ok: true, trade_id: Number(FIXTURE_TRADE_ID), items: normalized });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/receipt/fixture/trade', async (req, res) => {
  if (!FIXTURE_MODE) return res.status(404).json({ error: 'Not found' });
  try {
    if (!await verifyToken(req, res)) return;
    fixtureTradeOverride = null;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/receipt/fixture/market', async (req, res) => {
  if (!FIXTURE_MODE) return res.status(404).json({ error: 'Not found' });
  try {
    if (!await verifyToken(req, res)) return;
    const itemId = Number(req.body.item_id);
    const dropPct = Math.min(99.9, Math.max(0.1, Number(req.body.drop_pct) || 40));
    if (!Number.isInteger(itemId) || itemId <= 0) return res.status(400).json({ error: 'Valid item_id required' });
    const { rows } = await db.query(
      `INSERT INTO item_market (item_id, name, type, price, average_price, quantity, created_at)
       SELECT id, name, type,
              ROUND(market_price * (1 - $2 / 100.0)), market_price, 1,
              NOW() + INTERVAL '5 minutes'
       FROM torn_items
       WHERE id = $1 AND market_price > 0
       RETURNING id, item_id, name, price, average_price, created_at`,
      [itemId, dropPct]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found or has no market value' });
    res.json({ ...rows[0], simulated_drop_pct: dropPct });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/receipt/fixture/market/:id', async (req, res) => {
  if (!FIXTURE_MODE) return res.status(404).json({ error: 'Not found' });
  try {
    if (!await verifyToken(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Valid row id required' });
    const result = await db.query('DELETE FROM item_market WHERE id = $1', [id]);
    res.json({ ok: true, deleted: result.rowCount || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/receipt/fixture/trade/:tradeId', async (req, res) => {
  if (!FIXTURE_MODE) return res.status(404).json({ error: 'Not found' });
  try {
    if (!await verifyToken(req, res)) return;
    if (String(req.params.tradeId) !== FIXTURE_TRADE_ID) {
      return res.status(400).json({ error: `Only fixture trade ${FIXTURE_TRADE_ID} can be deleted here` });
    }
    const result = await db.query('DELETE FROM trade_receipts WHERE trade_id = $1', [FIXTURE_TRADE_ID]);
    res.json({ ok: true, deleted: result.rowCount || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/receipt/preview — price without creating receipt ────────────────
router.options('/api/receipt/preview', cors(CORS_TORN));
router.post('/api/receipt/preview', cors(CORS_TORN), async (req, res) => {
  try {
    if (!await verifyToken(req, res)) return;
    const { trade_id } = req.body;
    if (!trade_id) return res.status(400).json({ error: 'trade_id required' });

    const tornData = await fetchTornTrade(trade_id);
    if (tornData.error) return res.status(400).json({ error: `Torn API: ${JSON.stringify(tornData.error)}` });

    const priced = await buildPricedItems(tornData, null);
    const items = applyMarketDropProtection(priced.items);
    const total = items.reduce(
      (sum, item) => sum + (Number(item.effective_price) || 0) * (Number(item.quantity) || 0),
      0
    ) || null;
    res.json({ trade_id, buyer: priced.buyer, seller: priced.seller, items, total });
  } catch (e) {
    console.error('[receipt] preview error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/receipt/create ──────────────────────────────────────────────────
router.options('/api/receipt/create', cors(CORS_TORN));
router.post('/api/receipt/create', cors(CORS_TORN), async (req, res) => {
  try {
    if (!await verifyToken(req, res)) return;
    const { trade_id, items_override } = req.body;
    if (!trade_id) return res.status(400).json({ error: 'trade_id required' });

    const tornData = await fetchTornTrade(trade_id);
    if (tornData.error) return res.status(400).json({ error: `Torn API: ${JSON.stringify(tornData.error)}` });

    const { buyer, seller, items, totalValue } = await buildPricedItems(tornData, items_override);

    const sid = shortId();
    const { rows: [row] } = await db.query(
      `INSERT INTO trade_receipts (trade_id, short_id, buyer_id, buyer_name, seller_id, seller_name, items, total_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (trade_id) DO UPDATE
         SET items = EXCLUDED.items,
             total_value = EXCLUDED.total_value,
             buyer_id = EXCLUDED.buyer_id,
             buyer_name = EXCLUDED.buyer_name,
             seller_id = EXCLUDED.seller_id,
             seller_name = EXCLUDED.seller_name,
             status = 'pending',
             completed_at = NULL
       RETURNING id, short_id`,
      [trade_id, sid, buyer.id || null, buyer.name || null,
       seller.id || null, seller.name || null,
       JSON.stringify(items), totalValue]
    );

    const publicId = row.short_id || row.id;
    res.json({ id: row.id, short_id: row.short_id, url: `/receipt/${publicId}`, total: totalValue });
  } catch (e) {
    console.error('[receipt] create error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/receipt/:id/complete ────────────────────────────────────────────
router.options('/api/receipt/:id/complete', cors(CORS_TORN));
router.post('/api/receipt/:id/complete', cors(CORS_TORN), async (req, res) => {
  try {
    if (!await verifyToken(req, res)) return;
    await db.query(
      `UPDATE trade_receipts SET status='completed', completed_at=NOW()
       WHERE (short_id=$1 OR id::text=$1) AND status='pending'`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/receipt/:id (public) ─────────────────────────────────────────────
router.get('/api/receipt/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM trade_receipts WHERE short_id=$1 OR id::text=$1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
