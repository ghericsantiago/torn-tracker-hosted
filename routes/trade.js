const express     = require('express');
const path        = require('path');
const router      = express.Router();
const db          = require('../db');
const requireAuth = require('../middleware/auth');

// ── Helpers ────────────────────────────────────────────────────────────────

const LISTINGS_SELECT = `
  SELECT
    tl.id, tl.torn_item_id, tl.item_name, tl.item_type,
    tl.price_mode, tl.fixed_price, tl.market_pct, tl.notes,
    tl.is_active, tl.sort_order, tl.created_at, tl.updated_at,
    ti.market_price,
    CASE
      WHEN tl.price_mode = 'market_pct' AND ti.market_price IS NOT NULL
        THEN ROUND(ti.market_price * tl.market_pct)
      WHEN tl.price_mode = 'fixed'
        THEN tl.fixed_price
      ELSE NULL
    END AS effective_price
  FROM trade_listings tl
  LEFT JOIN torn_items ti ON ti.id = tl.torn_item_id
`;

// ── Public routes ──────────────────────────────────────────────────────────

router.get('/trade', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/trade/index.html'));
});

router.get('/api/trade/profile', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT display_name, discord_handle, bio, torn_profile_url FROM trade_profiles WHERE id = 1'
    );
    res.json(rows[0] || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/trade/listings', async (req, res) => {
  try {
    const [listingsRes, profileRes] = await Promise.all([
      db.query(LISTINGS_SELECT + `WHERE tl.is_active = true AND tl.profile_id = 1
        ORDER BY tl.item_type, tl.sort_order, tl.item_name`),
      db.query(
        'SELECT display_name, discord_handle, bio, torn_profile_url, updated_at FROM trade_profiles WHERE id = 1'
      ),
    ]);

    const categories = {};
    for (const row of listingsRes.rows) {
      const cat = row.item_type || 'Other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(row);
    }

    res.json({
      profile:    profileRes.rows[0] || {},
      categories: Object.entries(categories).map(([name, items]) => ({ name, items })),
      total:      listingsRes.rows.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Search all torn_items (legacy autocomplete endpoint)
router.get('/admin/api/trade/search-items', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  try {
    const { rows } = await db.query(
      `SELECT id, name, type FROM torn_items
       WHERE ($1 = '' OR name ILIKE $2 OR type ILIKE $2)
       ORDER BY name LIMIT 50`,
      [q, `%${q}%`]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Full item catalog grouped by type, with listing status merged in
router.get('/admin/api/trade/all-items', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        ti.id, ti.name, ti.type, ti.market_price,
        tl.id          AS listing_id,
        tl.price_mode,
        tl.fixed_price,
        tl.market_pct,
        tl.notes,
        tl.is_active,
        CASE
          WHEN tl.price_mode = 'market_pct' AND ti.market_price IS NOT NULL
            THEN ROUND(ti.market_price * tl.market_pct)
          WHEN tl.price_mode = 'fixed' THEN tl.fixed_price
          ELSE NULL
        END AS effective_price
      FROM torn_items ti
      LEFT JOIN trade_listings tl
        ON tl.torn_item_id = ti.id AND tl.profile_id = 1
      WHERE ti.type IS NOT NULL AND ti.type <> 'Special' AND ti.id > 0
      ORDER BY ti.type, ti.name
    `);

    // Group by type
    const map = {};
    for (const r of rows) {
      if (!map[r.type]) map[r.type] = [];
      map[r.type].push(r);
    }
    const categories = Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, items]) => ({ type, items }));

    res.json(categories);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Batch save — receives the complete desired listing state, upserts all, removes the rest
router.post('/admin/api/trade/bulk-save', requireAuth, async (req, res) => {
  const { listings } = req.body; // array of items to include
  if (!Array.isArray(listings)) return res.status(400).json({ error: 'listings must be an array' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    if (listings.length === 0) {
      await client.query('DELETE FROM trade_listings WHERE profile_id = 1');
    } else {
      const ids = listings.map(l => l.torn_item_id);
      // Remove items no longer in the list
      await client.query(
        'DELETE FROM trade_listings WHERE profile_id = 1 AND torn_item_id <> ALL($1)',
        [ids]
      );
      // Upsert each included item
      for (const l of listings) {
        const fp = l.price_mode === 'fixed'      ? (parseInt(l.fixed_price) || null)  : null;
        const mp = l.price_mode === 'market_pct' ? (parseFloat(l.market_pct) || null) : null;
        await client.query(`
          INSERT INTO trade_listings
            (profile_id, torn_item_id, item_name, item_type, price_mode, fixed_price, market_pct, notes, is_active)
          VALUES (1, $1, $2, $3, $4, $5, $6, $7, true)
          ON CONFLICT (profile_id, torn_item_id) DO UPDATE SET
            item_name=$2, item_type=$3, price_mode=$4, fixed_price=$5,
            market_pct=$6, notes=$7, is_active=true, updated_at=NOW()
        `, [l.torn_item_id, l.item_name, l.item_type, l.price_mode, fp, mp, l.notes || null]);
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, count: listings.length });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── Admin: profile ─────────────────────────────────────────────────────────

router.get('/admin/trade', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/trade.html'));
});

router.get('/admin/api/trade/profile', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM trade_profiles WHERE id = 1');
    res.json(rows[0] || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin/api/trade/profile', requireAuth, async (req, res) => {
  const { display_name, discord_handle, bio, torn_profile_url } = req.body;
  try {
    await db.query(
      `UPDATE trade_profiles
       SET display_name=$1, discord_handle=$2, bio=$3, torn_profile_url=$4, updated_at=NOW()
       WHERE id = 1`,
      [display_name || 'Torn Trader', discord_handle || null, bio || null, torn_profile_url || null]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin: listings CRUD ───────────────────────────────────────────────────

router.get('/admin/api/trade/listings', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      LISTINGS_SELECT + `WHERE tl.profile_id = 1 ORDER BY tl.item_type, tl.sort_order, tl.item_name`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/api/trade/listings', requireAuth, async (req, res) => {
  const { torn_item_id, item_name, item_type, price_mode, fixed_price, market_pct, notes } = req.body;
  if (!torn_item_id || !item_name) {
    return res.status(400).json({ error: 'torn_item_id and item_name are required' });
  }
  if (!['fixed', 'market_pct'].includes(price_mode)) {
    return res.status(400).json({ error: 'price_mode must be fixed or market_pct' });
  }

  const fp  = price_mode === 'fixed'      ? (parseInt(fixed_price) || null)        : null;
  const mp  = price_mode === 'market_pct' ? (parseFloat(market_pct) || null)       : null;

  try {
    const { rows } = await db.query(
      `INSERT INTO trade_listings
         (profile_id, torn_item_id, item_name, item_type, price_mode, fixed_price, market_pct, notes)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (profile_id, torn_item_id) DO UPDATE SET
         item_name=$2, item_type=$3, price_mode=$4, fixed_price=$5, market_pct=$6,
         notes=$7, is_active=true, updated_at=NOW()
       RETURNING *`,
      [torn_item_id, item_name, item_type || 'Other', price_mode, fp, mp, notes || null]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin/api/trade/listings/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { price_mode, fixed_price, market_pct, notes, is_active } = req.body;

  const fp = price_mode === 'fixed'      ? (parseInt(fixed_price) || null)  : null;
  const mp = price_mode === 'market_pct' ? (parseFloat(market_pct) || null) : null;

  try {
    const { rows } = await db.query(
      `UPDATE trade_listings
       SET price_mode=$2, fixed_price=$3, market_pct=$4, notes=$5,
           is_active=$6, updated_at=NOW()
       WHERE id=$1 AND profile_id=1
       RETURNING *`,
      [id, price_mode, fp, mp, notes || null, is_active !== undefined ? is_active : true]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/admin/api/trade/listings/:id/toggle', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE trade_listings SET is_active = NOT is_active, updated_at=NOW()
       WHERE id=$1 AND profile_id=1 RETURNING is_active`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, is_active: rows[0].is_active });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/admin/api/trade/listings/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM trade_listings WHERE id=$1 AND profile_id=1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
