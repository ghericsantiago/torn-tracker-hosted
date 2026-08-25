const express     = require('express');
const path        = require('path');
const router      = express.Router();
const db          = require('../db');
const requireAuth = require('../middleware/auth');
const { rebuildTradingProfit } = require('../services/trading-profit');

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
    tl.market_protection_enabled                            AS item_protection_enabled,
    tcc.market_protection_enabled                           AS cat_protection_enabled,
    tp.market_protection_enabled                            AS global_protection_enabled,
    COALESCE(tl.market_protection_enabled, tcc.market_protection_enabled,
             tp.market_protection_enabled, true)            AS resolved_protection_enabled,
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
      db.query('SELECT default_market_pct, market_protection_enabled FROM trade_profiles WHERE id = 1'),
      db.query('SELECT item_type, market_pct, market_protection_enabled FROM trade_category_configs WHERE profile_id = 1 ORDER BY item_type'),
    ]);
    res.json({
      global_pct:  profileRes.rows[0]?.default_market_pct ?? null,
      categories:  Object.fromEntries(catRes.rows.map(r => [r.item_type, r.market_pct])),
      global_protection_enabled: profileRes.rows[0]?.market_protection_enabled !== false,
      category_protections: Object.fromEntries(
        catRes.rows.filter(r => r.market_protection_enabled != null)
          .map(r => [r.item_type, r.market_protection_enabled])
      ),
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
        tl.market_protection_enabled AS item_protection_enabled,
        tcc.market_protection_enabled AS cat_protection_enabled,
        tp.market_protection_enabled AS global_protection_enabled,
        COALESCE(tl.market_protection_enabled, tcc.market_protection_enabled,
                 tp.market_protection_enabled, true) AS resolved_protection_enabled,
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
    const catProtections = {};
    for (const r of rows) {
      if (r.cat_pct != null) catPcts[r.type] = r.cat_pct;
      if (r.cat_protection_enabled != null) catProtections[r.type] = r.cat_protection_enabled;
    }

    const categories = Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, items]) => ({ type, items }));

    res.json({
      categories, global_pct: globalPct, cat_pcts: catPcts, category_order: categoryOrder,
      global_protection_enabled: rows[0]?.global_protection_enabled !== false,
      cat_protections: catProtections,
    });
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
    const globalProtection = config.global_protection_enabled !== false;
    const catOrd   = Array.isArray(config.category_order) ? JSON.stringify(config.category_order) : null;
    await client.query(
      `UPDATE trade_profiles SET default_market_pct=$1, category_order=$2,
         market_protection_enabled=$3, updated_at=NOW() WHERE id=1`,
      [gp, catOrd, globalProtection]
    );

    // 2. Replace category configs entirely
    await client.query('DELETE FROM trade_category_configs WHERE profile_id=1');
    const cats = config.categories || {};
    const categoryProtections = config.category_protections || {};
    const configuredTypes = new Set([...Object.keys(cats), ...Object.keys(categoryProtections)]);
    for (const type of configuredTypes) {
      const pct = cats[type];
      const protection = Object.prototype.hasOwnProperty.call(categoryProtections, type)
        ? categoryProtections[type] === true : null;
      await client.query(
        `INSERT INTO trade_category_configs
           (profile_id, item_type, market_pct, market_protection_enabled)
         VALUES (1, $1, $2, $3)`,
        [type, pct != null ? parseFloat(pct) / 100 : null, protection]
      );
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
        const protection = l.market_protection_enabled == null ? null : l.market_protection_enabled === true;
        await client.query(
          `INSERT INTO trade_listings
             (profile_id, torn_item_id, item_name, item_type, price_mode, fixed_price,
              market_pct, notes, is_active, market_protection_enabled)
           VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (profile_id, torn_item_id) DO UPDATE SET
             item_name=$2, item_type=$3, price_mode=$4, fixed_price=$5,
             market_pct=$6, notes=$7, is_active=$8,
             market_protection_enabled=$9, updated_at=NOW()`,
          [l.torn_item_id, l.item_name, l.item_type, l.price_mode, fp, mp,
           l.notes || null, l.is_active !== false, protection]
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

router.get('/admin/trading-profit', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/trading-ledger-wireframe.html'));
});

router.post('/admin/api/trading-profit/rebuild', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await rebuildTradingProfit()) }); }
  catch (e) { console.error('[trading-profit/rebuild]', e); res.status(500).json({ error: e.message }); }
});

router.get('/admin/api/trading-profit/overview', requireAuth, async (req, res) => {
  try {
    const from=req.query.from||null, to=req.query.to||null, q=(req.query.q||'').trim();
    const limit=Math.min(100,Math.max(10,Number(req.query.limit)||50));
    const offset=Math.max(0,Number(req.query.offset)||0);
    const sortColumns={date:'last_activity',item:'name',bought:'bought',purchase_cost:'purchase_cost',sold:'sold',revenue:'revenue',fifo_cost:'fifo_cost',profit:'profit',margin:'margin',remaining:'remaining'};
    const sort=sortColumns[req.query.sort]||'last_activity';
    const direction=String(req.query.direction).toLowerCase()==='asc'?'ASC':'DESC';
    const {rows}=await db.query(`
      WITH purchases AS (
        SELECT item_id, SUM(qty) bought, SUM(total_price) purchase_cost, MAX(happened_at) last_buy
        FROM trading_events WHERE side='buy' AND channel IN ('buy','trade','ammo_buy','points_buy')
          AND ($1::date IS NULL OR happened_at >= $1::date)
          AND ($2::date IS NULL OR happened_at < $2::date + interval '1 day') GROUP BY item_id
      ), sales AS (
        SELECT e.item_id, SUM(e.qty) sold, SUM(e.total_price) revenue, MAX(e.happened_at) last_sale,
          SUM(COALESCE(m.cost,0)) fifo_cost, SUM(COALESCE(m.profit,0)) profit,
          SUM(e.unmatched_qty) unmatched
        FROM trading_events e LEFT JOIN (
          SELECT sale_event_id,SUM(qty*unit_cost) cost,SUM(realized_profit) profit
          FROM trading_fifo_matches GROUP BY sale_event_id
        ) m ON m.sale_event_id=e.id WHERE e.side='sell'
          AND ($1::date IS NULL OR e.happened_at >= $1::date)
          AND ($2::date IS NULL OR e.happened_at < $2::date + interval '1 day') GROUP BY e.item_id
      ), open AS (
        SELECT item_id,SUM(qty_remaining) remaining,SUM(qty_remaining*unit_cost) open_cost,MAX(acquired_at) last_lot
        FROM trading_fifo_lots GROUP BY item_id
      )
      SELECT ti.id item_id,ti.name,ti.type,COALESCE(p.bought,0) bought,COALESCE(p.purchase_cost,0) purchase_cost,
        COALESCE(s.sold,0) sold,COALESCE(s.revenue,0) revenue,COALESCE(s.fifo_cost,0) fifo_cost,
        COALESCE(s.profit,0) profit,COALESCE(s.unmatched,0) unmatched,COALESCE(o.remaining,0) remaining,
        COALESCE(o.open_cost,0) open_cost,
        GREATEST(p.last_buy,s.last_sale,o.last_lot) last_activity,
        CASE WHEN COALESCE(s.revenue,0)>0 THEN COALESCE(s.profit,0)/s.revenue*100 ELSE 0 END margin,
        COUNT(*) OVER() total_count,
        SUM(COALESCE(p.bought,0)) OVER() total_bought,
        SUM(COALESCE(p.purchase_cost,0)) OVER() total_purchase_cost,
        SUM(COALESCE(s.sold,0)) OVER() total_sold,
        SUM(COALESCE(s.revenue,0)) OVER() total_revenue,
        SUM(COALESCE(s.fifo_cost,0)) OVER() total_fifo_cost,
        SUM(COALESCE(s.profit,0)) OVER() total_profit,
        SUM(COALESCE(s.unmatched,0)) OVER() total_unmatched,
        SUM(COALESCE(o.remaining,0)) OVER() total_remaining,
        SUM(COALESCE(o.open_cost,0)) OVER() total_open_cost
      FROM torn_items ti LEFT JOIN purchases p ON p.item_id=ti.id LEFT JOIN sales s ON s.item_id=ti.id
      LEFT JOIN open o ON o.item_id=ti.id
      WHERE (p.item_id IS NOT NULL OR s.item_id IS NOT NULL OR o.item_id IS NOT NULL)
        AND ($3='' OR ti.name ILIKE '%'||$3||'%')
      ORDER BY ${sort} ${direction} NULLS LAST,ti.name ASC LIMIT $4 OFFSET $5`,[from,to,q,limit,offset]);
    const meta=rows[0]||{};
    const hidden=new Set(['total_count','total_bought','total_purchase_cost','total_sold','total_revenue','total_fifo_cost','total_profit','total_unmatched','total_remaining','total_open_cost']);
    const items=rows.map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>!hidden.has(k)).map(([k,v])=>[k,['item_id','name','type','last_activity'].includes(k)?v:Number(v)])));
    const totals={bought:Number(meta.total_bought)||0,purchase_cost:Number(meta.total_purchase_cost)||0,sold:Number(meta.total_sold)||0,revenue:Number(meta.total_revenue)||0,fifo_cost:Number(meta.total_fifo_cost)||0,profit:Number(meta.total_profit)||0,unmatched:Number(meta.total_unmatched)||0,remaining:Number(meta.total_remaining)||0,open_cost:Number(meta.total_open_cost)||0};
    res.json({items,totals,total:Number(meta.total_count)||0,limit,offset,sort:req.query.sort||'date',direction:direction.toLowerCase()});
  } catch(e){console.error('[trading-profit/overview]',e);res.status(500).json({error:e.message});}
});

router.get('/admin/api/trading-profit/items/:itemId', requireAuth, async (req,res)=>{
  try{
    const itemId=Number(req.params.itemId); if(!itemId)return res.status(400).json({error:'Invalid item'});
    const lotLimit=Math.min(100,Math.max(10,Number(req.query.lot_limit)||30));
    const lotOffset=Math.max(0,Number(req.query.lot_offset)||0);
    const lotSortColumns={date:'l.acquired_at',original:'l.qty_original',remaining:'l.qty_remaining',unit_cost:'l.unit_cost',remaining_cost:'l.qty_remaining*l.unit_cost'};
    const lotSort=lotSortColumns[req.query.lot_sort]||'l.acquired_at';
    const lotDirection=String(req.query.lot_direction).toLowerCase()==='asc'?'ASC':'DESC';
    const lotStatus=['open','sold','converted','all'].includes(req.query.lot_status)?req.query.lot_status:'open';
    const [itemRes,lotsRes,activityRes,lotCountsRes]=await Promise.all([
      db.query('SELECT id item_id,name,type FROM torn_items WHERE id=$1',[itemId]),
      db.query(`SELECT l.id,l.acquired_at,l.qty_original,l.qty_remaining,l.unit_cost,e.channel,e.trade_id,e.log_id,
        COUNT(*) OVER() total_count,
        COALESCE(json_agg(json_build_object('date',s.happened_at,'side',s.side,'qty',m.qty,'unit_revenue',m.unit_revenue,'profit',m.realized_profit,'channel',s.channel,'trade_id',s.trade_id,'log_id',s.log_id)) FILTER(WHERE m.id IS NOT NULL),'[]') sales
        FROM trading_fifo_lots l JOIN trading_events e ON e.id=l.event_id
        LEFT JOIN trading_fifo_matches m ON m.lot_id=l.id LEFT JOIN trading_events s ON s.id=m.sale_event_id
        WHERE l.item_id=$1 GROUP BY l.id,e.channel,e.trade_id,e.log_id
        HAVING $4='all'
          OR ($4='open' AND l.qty_remaining>0)
          OR ($4='sold' AND l.qty_remaining=0 AND COALESCE(bool_or(s.side='sell'),false))
          OR ($4='converted' AND COALESCE(bool_or(s.side='museum'),false))
        ORDER BY ${lotSort} ${lotDirection},l.id ${lotDirection} LIMIT $2 OFFSET $3`,[itemId,lotLimit,lotOffset,lotStatus]),
      db.query(`SELECT id,happened_at,side,channel,qty,unit_price,total_price,unmatched_qty,trade_id,log_id FROM trading_events WHERE item_id=$1 ORDER BY happened_at DESC,id DESC`,[itemId])
      ,db.query(`WITH x AS (
          SELECT l.id,l.qty_remaining,COALESCE(bool_or(s.side='sell'),false) has_sale,
            COALESCE(bool_or(s.side='museum'),false) has_museum
          FROM trading_fifo_lots l LEFT JOIN trading_fifo_matches m ON m.lot_id=l.id
          LEFT JOIN trading_events s ON s.id=m.sale_event_id WHERE l.item_id=$1 GROUP BY l.id
        ) SELECT COUNT(*) FILTER(WHERE qty_remaining>0) open,
          COUNT(*) FILTER(WHERE qty_remaining=0 AND has_sale) sold,
          COUNT(*) FILTER(WHERE has_museum) converted,COUNT(*) total FROM x`,[itemId])
    ]);
    const counts=lotCountsRes.rows[0]||{};
    res.json({item:itemRes.rows[0]||null,lots:lotsRes.rows.map(l=>({id:l.id,acquired_at:l.acquired_at,qty_original:Number(l.qty_original),qty_remaining:Number(l.qty_remaining),unit_cost:Number(l.unit_cost),channel:l.channel,trade_id:l.trade_id,log_id:l.log_id,sales:l.sales})),lotTotal:Number(lotsRes.rows[0]?.total_count)||0,lotCounts:{open:Number(counts.open)||0,sold:Number(counts.sold)||0,converted:Number(counts.converted)||0,all:Number(counts.total)||0},lotLimit,lotOffset,activity:activityRes.rows.map(x=>({...x,qty:Number(x.qty),unit_price:Number(x.unit_price),total_price:Number(x.total_price),unmatched_qty:Number(x.unmatched_qty)}))});
  }catch(e){console.error('[trading-profit/item]',e);res.status(500).json({error:e.message});}
});

module.exports = router;
