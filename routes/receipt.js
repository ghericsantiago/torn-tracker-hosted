const express = require('express');
const cors    = require('cors');
const router  = express.Router();
const db      = require('../db');

const CORS_TORN = {
  origin: 'https://www.torn.com',
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Receipt-Token'],
};

async function verifyToken(req, res) {
  const token = req.headers['x-receipt-token'];
  if (!token) { res.status(401).json({ error: 'Missing X-Receipt-Token' }); return false; }
  const { rows } = await db.query(
    'SELECT receipt_token FROM trade_profiles WHERE id = 1'
  );
  if (!rows.length || String(rows[0].receipt_token) !== String(token)) {
    res.status(403).json({ error: 'Invalid token' }); return false;
  }
  return true;
}

// ── Price lookup using cascade SQL ────────────────────────────────────────────
const PRICE_LOOKUP = `
  SELECT
    tl.torn_item_id, tl.item_name, tl.item_type,
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
  LEFT JOIN trade_category_configs tcc
         ON tcc.profile_id = tl.profile_id AND tcc.item_type = tl.item_type
  LEFT JOIN trade_profiles tp ON tp.id = tl.profile_id
  WHERE tl.profile_id = 1 AND tl.torn_item_id = ANY($1::int[])
`;

// ── POST /api/receipt/create ──────────────────────────────────────────────────
router.options('/api/receipt/create', cors(CORS_TORN));
router.post('/api/receipt/create', cors(CORS_TORN), async (req, res) => {
  try {
    if (!await verifyToken(req, res)) return;

    const { trade_id, trade_data } = req.body;
    if (!trade_id) return res.status(400).json({ error: 'trade_id required' });

    // Idempotent: return existing receipt if already created for this trade
    const existing = await db.query(
      'SELECT id FROM trade_receipts WHERE trade_id = $1', [trade_id]
    );
    if (existing.rows.length) {
      const id = existing.rows[0].id;
      return res.json({ id, url: `/receipt/${id}` });
    }

    const trade = trade_data?.trade || {};
    const buyer  = trade.user   || {};
    const seller = trade.trader || {};
    const tornItems = Array.isArray(trade.items) ? trade.items : [];

    // Look up prices for all items in the trade that are in our catalog
    const itemIds = tornItems.map(i => i.id).filter(Boolean);
    const priceMap = {};
    if (itemIds.length) {
      const { rows } = await db.query(PRICE_LOOKUP, [itemIds]);
      for (const r of rows) priceMap[r.torn_item_id] = r;
    }

    // Build snapshot
    let totalValue = 0;
    const items = tornItems.map(ti => {
      const listing = priceMap[ti.id];
      const qty = ti.quantity || 1;
      const effectiveUnit = listing ? (Number(listing.effective_price) || null) : null;
      const effectiveTotal = effectiveUnit != null ? effectiveUnit * qty : null;
      if (effectiveTotal != null) totalValue += effectiveTotal;
      return {
        torn_item_id:   ti.id,
        item_name:      ti.name || (listing ? listing.item_name : `Item #${ti.id}`),
        item_type:      listing ? listing.item_type : null,
        quantity:       qty,
        market_price:   ti.market_price != null ? ti.market_price : (listing ? Number(listing.market_price) : null),
        price_mode:     listing ? listing.price_mode : null,
        resolved_pct:   listing ? Number(listing.resolved_pct) : null,
        effective_price: effectiveUnit,
        effective_total: effectiveTotal,
        in_catalog:     !!listing,
      };
    });

    const { rows: [row] } = await db.query(
      `INSERT INTO trade_receipts
         (trade_id, buyer_id, buyer_name, seller_id, seller_name, items, total_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [trade_id, buyer.id || null, buyer.name || null,
       seller.id || null, seller.name || null,
       JSON.stringify(items), totalValue || null]
    );

    res.json({ id: row.id, url: `/receipt/${row.id}` });
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
    const { id } = req.params;
    const { rowCount } = await db.query(
      `UPDATE trade_receipts
       SET status = 'completed', completed_at = NOW()
       WHERE id = $1 AND status = 'pending'`,
      [id]
    );
    res.json({ ok: true, updated: rowCount > 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/receipt/:id ──────────────────────────────────────────────────────
router.get('/api/receipt/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM trade_receipts WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/receipt/token (admin — get receipt token) ────────────────────────
router.get('/api/receipt/token', require('../middleware/auth'), async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT receipt_token FROM trade_profiles WHERE id = 1'
    );
    res.json({ token: rows[0]?.receipt_token || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
