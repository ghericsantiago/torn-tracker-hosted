const express = require('express');
const router = express.Router();
const db = require('../db');
const museumExchange = require('../museum-exchange.json');

const plushieSet = museumExchange.museum.find(set => set.name === 'Plushie Set');
const POINT_MARKET_ID = 999999999;

router.get('/points-checker', async (req, res) => {
  try {
    const { rows: pointRows } = await db.query(
      `SELECT price, quantity, created_at FROM item_market
       WHERE item_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [POINT_MARKET_ID]
    );
    const { rows: plushies } = await db.query(
      `SELECT ids.item_id,
         COALESCE(ti.name, latest.name, 'Item ' || ids.item_id) AS name,
         COALESCE(ti.market_price, latest.average_price) AS market_price,
         today.low, today.high, latest.price AS latest_price,
         latest.created_at AS price_at
       FROM unnest($1::int[]) WITH ORDINALITY AS ids(item_id, position)
       LEFT JOIN torn_items ti ON ti.id = ids.item_id
       LEFT JOIN LATERAL (
         SELECT name, price, average_price, created_at FROM item_market
         WHERE item_id = ids.item_id ORDER BY created_at DESC LIMIT 1
       ) latest ON TRUE
       LEFT JOIN LATERAL (
         SELECT MIN(price) AS low, MAX(price) AS high FROM item_market
         WHERE item_id = ids.item_id
           AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila'
       ) today ON TRUE
       ORDER BY ids.position`,
      [plushieSet.items]
    );
    const point = pointRows[0];
    res.json({
      set: { name: plushieSet.name, points: plushieSet.points },
      point_market: point ? { price: Number(point.price), quantity: Number(point.quantity) || 0, updated_at: point.created_at } : null,
      plushies: plushies.map(row => ({
        item_id: Number(row.item_id), name: row.name,
        market_price: row.market_price == null ? null : Number(row.market_price),
        low: row.low == null ? null : Number(row.low),
        high: row.high == null ? null : Number(row.high),
        latest_price: row.latest_price == null ? null : Number(row.latest_price),
        updated_at: row.price_at,
      })),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/items — all active items with latest price
router.get('/items', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        mi.*,
        (SELECT price FROM item_market WHERE item_id = mi.torn_item_id
         ORDER BY created_at DESC LIMIT 1) AS latest_price,
        (SELECT created_at FROM item_market WHERE item_id = mi.torn_item_id
         ORDER BY created_at DESC LIMIT 1) AS price_at
      FROM monitored_items mi
      ORDER BY mi.name ASC NULLS LAST
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/market/:itemId — price history with optional filters
router.get('/market/:itemId', async (req, res) => {
  const { itemId } = req.params;
  const { from, to, limit = 500 } = req.query;

  try {
    let query = `
      SELECT id, item_id, name, type, price, average_price, quantity, created_at
      FROM item_market
      WHERE item_id = $1
    `;
    const params = [itemId];

    if (from) { params.push(from); query += ` AND created_at >= $${params.length}`; }
    if (to)   { params.push(to);   query += ` AND created_at <= $${params.length}`; }

    params.push(parseInt(limit));
    query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const { rows } = await db.query(query, params);
    res.json(rows.reverse()); // return chronological order
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/market/:itemId/ohlc — OHLC candlestick data bucketed by interval
router.get('/market/:itemId/ohlc', async (req, res) => {
  const { itemId } = req.params;
  const { interval = '1 hour', from, to } = req.query;

  const allowed = ['1 minute', '5 minutes', '15 minutes', '30 minutes', '1 hour', '1 day'];
  const binInterval = allowed.includes(interval) ? interval : '1 hour';

  try {
    // date_bin buckets arbitrary intervals cleanly (PostgreSQL 14+).
    // array_agg with ORDER BY gives open (first) and close (last) within each bucket.
    const params = [binInterval, itemId];
    let query = `
      SELECT
        date_bin($1::interval, created_at, TIMESTAMPTZ '2000-01-01') AS bucket,
        MIN(price)                                                     AS low,
        MAX(price)                                                     AS high,
        (array_agg(price ORDER BY created_at ASC))[1]                 AS open,
        (array_agg(price ORDER BY created_at DESC))[1]                AS close
      FROM item_market
      WHERE item_id = $2
    `;
    if (from) { params.push(from); query += ` AND created_at >= $${params.length}`; }
    if (to)   { params.push(to);   query += ` AND created_at <= $${params.length}`; }
    query += ` GROUP BY date_bin($1::interval, created_at, TIMESTAMPTZ '2000-01-01')`;
    query += ` ORDER BY bucket ASC`;

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/best-items?fee=5
// Strategy: buy at avg daily low, sell at avg daily high over last 7 days.
// buy_target   = AVG(daily MIN price)
// sell_target  = AVG(daily MAX price)
// net_profit   = sell_target * (1 - fee%) - buy_target
// confidence   = swing_days / 7 * 100  (days with intra-day price movement)
// profit_score = margin_pct * (swing_days / 7)  — sort key
router.get('/best-items', async (req, res) => {
  const rawFee = parseFloat(req.query.fee);
  const fee = Math.min(Math.max(isNaN(rawFee) ? 5 : rawFee, 0), 99);
  // Embed fm as a SQL literal to avoid $1-reuse incompatibility between PG and SQLite.
  // Safe: fm is computed from a validated, clamped float — not raw user input.
  const fm = ((100 - fee) / 100).toFixed(8);
  try {
    const { rows } = await db.query(`
      WITH daily_ranges AS (
        SELECT
          item_id,
          DATE(created_at)  AS day,
          MIN(price)        AS day_low,
          MAX(price)        AS day_high,
          COUNT(*)          AS day_records
        FROM item_market
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY item_id, DATE(created_at)
      ),
      item_stats AS (
        SELECT
          item_id,
          COUNT(*)                                              AS active_days,
          SUM(CASE WHEN day_records > 1 THEN 1 ELSE 0 END)    AS swing_days,
          ROUND(AVG(day_low)::numeric,  0)                     AS buy_target,
          ROUND(AVG(day_high)::numeric, 0)                     AS sell_target
        FROM daily_ranges
        GROUP BY item_id
        HAVING COUNT(*) >= 1
      )
      SELECT
        s.item_id,
        mi.name,
        s.buy_target,
        s.sell_target,
        ROUND((s.sell_target * ${fm} - s.buy_target)::numeric, 0)                          AS net_profit,
        ROUND(((s.sell_target * ${fm} - s.buy_target) / s.sell_target * 100)::numeric, 1)  AS margin_pct,
        s.swing_days,
        ROUND((s.swing_days::numeric / 7.0 * 100), 0)                                      AS confidence_pct,
        ROUND(
          ((s.sell_target * ${fm} - s.buy_target) / s.sell_target * 100)::numeric
          * (s.swing_days::numeric / 7.0),
          2
        )                                                                                    AS profit_score
      FROM item_stats s
      JOIN monitored_items mi ON mi.torn_item_id = s.item_id
      WHERE s.buy_target > 0
        AND s.sell_target * ${fm} > s.buy_target
        AND mi.is_active = TRUE
        AND s.swing_days >= 1
      ORDER BY profit_score DESC
      LIMIT 20
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/search?q= — monitored item name autocomplete
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const { rows } = await db.query(
      `SELECT torn_item_id AS item_id, name
       FROM monitored_items
       WHERE LOWER(name) LIKE LOWER($1) AND is_active = TRUE
       ORDER BY name ASC
       LIMIT 10`,
      [`%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
