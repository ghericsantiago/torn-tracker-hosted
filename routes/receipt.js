const express = require('express');
const cors    = require('cors');
const https   = require('https');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../db');

function shortId() {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

const APP_URL = 'https://torn-imarket-tracker.gvsantiago.com';

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

function fetchTornTrade(tradeId) {
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
    const [priceRes, itemRes, latestMarketRes, profileRes] = await Promise.all([
      db.query(PRICE_LOOKUP, [itemIds]),
      db.query('SELECT id, name, market_price FROM torn_items WHERE id = ANY($1::int[])', [itemIds]),
      db.query(
        `SELECT DISTINCT ON (item_id) item_id, price, created_at
         FROM item_market
         WHERE item_id = ANY($1::int[])
         ORDER BY item_id, created_at DESC`,
        [itemIds]
      ),
      db.query('SELECT default_market_pct FROM trade_profiles WHERE id = 1'),
    ]);
    for (const r of priceRes.rows) priceMap[r.torn_item_id] = r;
    for (const r of itemRes.rows)  itemMap[r.id] = r;
    const latestMarketMap = Object.fromEntries(latestMarketRes.rows.map(r => [r.item_id, r]));
    globalPct = profileRes.rows[0]?.default_market_pct ?? null;

    for (const id of itemIds) {
      if (itemMap[id]) itemMap[id].latest_market = latestMarketMap[id] || null;
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
      price_mode:      listing?.price_mode || (catalogPrice != null && !listing ? 'market_pct' : null),
      resolved_pct:    listing ? Number(listing.resolved_pct) : (!listing && globalPct ? Number(globalPct) : null),
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

// ── GET /api/receipt/token (admin) — MUST be before /:id ─────────────────────
router.get('/api/receipt/token', require('../middleware/auth'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT receipt_token FROM trade_profiles WHERE id = 1');
    res.json({ token: rows[0]?.receipt_token || null });
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

    const { buyer, seller, items, totalValue } = await buildPricedItems(tornData, null);
    res.json({ trade_id, buyer, seller, items, total: totalValue });
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
