const express     = require('express');
const path        = require('path');
const router      = express.Router();
const db          = require('../db');
const requireAuth = require('../middleware/auth');

// ── SQL helpers ────────────────────────────────────────────────────────────
// Resolves the 3-level cascade in SQL:
//   item.market_pct  (explicit override)
//     → trade_category_configs.market_pct  (category default)
//       → trade_profiles.default_market_pct  (global default)
const CASCADE_SELECT = `
  SELECT
    tl.id, tl.torn_item_id, tl.item_name, tl.item_type,
    tl.price_mode, tl.fixed_price, tl.market_pct, tl.notes,
    tl.is_active, tl.sort_order, tl.created_at, tl.updated_at,
    ti.market_price,
    tcc.market_pct                                          AS cat_pct,
    tp.default_market_pct                                   AS global_pct,
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/trade/listings', async (req, res) => {
  try {
    const [listingsRes, profileRes] = await Promise.all([
      db.query(CASCADE_SELECT +
        `WHERE tl.is_active = true AND tl.profile_id = 1
         ORDER BY tl.item_type, tl.sort_order, tl.item_name`),
      db.query(
        'SELECT display_name, discord_handle, bio, torn_profile_url, category_order FROM trade_profiles WHERE id = 1'
      ),
    ]);

    const profile      = profileRes.rows[0] || {};
    const catOrderArr  = Array.isArray(profile.category_order) ? profile.category_order : [];

    const categories = {};
    for (const row of listingsRes.rows) {
      const cat = row.item_type || 'Other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(row);
    }

    const sorted = Object.entries(categories)
      .sort(([a], [b]) => {
        const ai = catOrderArr.indexOf(a), bi = catOrderArr.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      })
      .map(([name, items]) => ({ name, items }));

    res.json({
      profile:    profile,
      categories: sorted,
      total:      listingsRes.rows.length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: pages ───────────────────────────────────────────────────────────

router.get('/admin/trade', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/trade.html'));
});

// ── Admin: profile ─────────────────────────────────────────────────────────

router.get('/admin/api/trade/profile', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM trade_profiles WHERE id = 1');
    res.json(rows[0] || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: price config (global + category defaults) ───────────────────────

router.get('/admin/api/trade/config', requireAuth, async (req, res) => {
  try {
    const [profileRes, catRes] = await Promise.all([
      db.query('SELECT default_market_pct FROM trade_profiles WHERE id = 1'),
      db.query('SELECT item_type, market_pct FROM trade_category_configs WHERE profile_id = 1 ORDER BY item_type'),
    ]);
    res.json({
      global_pct:  profileRes.rows[0]?.default_market_pct ?? null,
      categories:  Object.fromEntries(catRes.rows.map(r => [r.item_type, r.market_pct])),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: full catalog with listing status + cascade context ──────────────

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
        tcc.market_pct           AS cat_pct,
        tp.default_market_pct    AS global_pct,
        tp.category_order        AS category_order,
        CASE
          WHEN tl.price_mode = 'fixed' THEN tl.fixed_price
          WHEN tl.price_mode = 'market_pct' AND ti.market_price IS NOT NULL
            THEN ROUND(ti.market_price *
                   COALESCE(tl.market_pct, tcc.market_pct, tp.default_market_pct))
          ELSE NULL
        END AS effective_price
      FROM torn_items ti
      LEFT JOIN trade_listings tl
             ON tl.torn_item_id = ti.id AND tl.profile_id = 1
      LEFT JOIN trade_category_configs tcc
             ON tcc.profile_id = 1 AND tcc.item_type = ti.type
      LEFT JOIN trade_profiles tp ON tp.id = 1
      WHERE ti.type IS NOT NULL AND ti.type <> 'Special' AND ti.id > 0
      ORDER BY ti.type, ti.name
    `);

    const map = {};
    for (const r of rows) {
      if (!map[r.type]) map[r.type] = [];
      map[r.type].push(r);
    }

    const globalPct   = rows[0]?.global_pct ?? null;
    const categoryOrder = rows[0]?.category_order ?? [];
    const catPcts     = {};
    for (const r of rows) {
      if (r.cat_pct != null) catPcts[r.type] = r.cat_pct;
    }

    const categories = Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, items]) => ({ type, items }));

    res.json({ categories, global_pct: globalPct, cat_pcts: catPcts, category_order: categoryOrder });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: bulk save (listings + config in one shot) ──────────────────────

router.post('/admin/api/trade/bulk-save', requireAuth, async (req, res) => {
  const { listings = [], config = {} } = req.body;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Save global default + category order
    const gp       = config.global_pct != null ? parseFloat(config.global_pct) / 100 : null;
    const catOrd   = Array.isArray(config.category_order) ? JSON.stringify(config.category_order) : null;
    await client.query(
      'UPDATE trade_profiles SET default_market_pct=$1, category_order=$2, updated_at=NOW() WHERE id=1',
      [gp, catOrd]
    );

    // 2. Replace category configs entirely
    await client.query('DELETE FROM trade_category_configs WHERE profile_id=1');
    const cats = config.categories || {};
    for (const [type, pct] of Object.entries(cats)) {
      if (pct != null) {
        await client.query(
          `INSERT INTO trade_category_configs (profile_id, item_type, market_pct)
           VALUES (1, $1, $2)`,
          [type, parseFloat(pct) / 100]
        );
      }
    }

    // 3. Replace listings
    if (listings.length === 0) {
      await client.query('DELETE FROM trade_listings WHERE profile_id=1');
    } else {
      const ids = listings.map(l => l.torn_item_id);
      await client.query(
        'DELETE FROM trade_listings WHERE profile_id=1 AND torn_item_id <> ALL($1)',
        [ids]
      );
      for (const l of listings) {
        // market_pct=null → item inherits from category/global cascade
        // market_pct=value → explicit item-level override
        const fp = l.price_mode === 'fixed'      ? (parseInt(l.fixed_price) || null) : null;
        const mp = l.price_mode === 'market_pct' ? (l.market_pct != null ? parseFloat(l.market_pct) : null) : null;
        await client.query(
          `INSERT INTO trade_listings
             (profile_id, torn_item_id, item_name, item_type, price_mode, fixed_price, market_pct, notes, is_active)
           VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (profile_id, torn_item_id) DO UPDATE SET
             item_name=$2, item_type=$3, price_mode=$4, fixed_price=$5,
             market_pct=$6, notes=$7, is_active=$8, updated_at=NOW()`,
          [l.torn_item_id, l.item_name, l.item_type, l.price_mode, fp, mp, l.notes || null, l.is_active !== false]
        );
      }
    }

    await client.query('COMMIT');
    res.json({
      ok: true,
      count: listings.filter(l => l.is_active !== false).length,
      pricing_count: listings.length,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── Admin: individual listing CRUD (kept for compatibility) ────────────────

router.get('/admin/api/trade/listings', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      CASCADE_SELECT + `WHERE tl.profile_id = 1 ORDER BY tl.item_type, tl.sort_order, tl.item_name`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin/api/trade/listings/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM trade_listings WHERE id=$1 AND profile_id=1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
