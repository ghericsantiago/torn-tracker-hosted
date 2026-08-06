const express = require('express');
const router = express.Router();
const db = require('../db');

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

// GET /api/market/:itemId/ohlc — candlestick OHLC grouped by interval
router.get('/market/:itemId/ohlc', async (req, res) => {
  const { itemId } = req.params;
  const { interval = '1 hour', from, to } = req.query;

  const allowed = ['1 minute', '5 minutes', '15 minutes', '30 minutes', '1 hour', '1 day'];
  const safeInterval = allowed.includes(interval) ? interval : '1 hour';

  try {
    let query = `
      SELECT
        date_trunc('${safeInterval.replace(' ', '_')}', created_at) AS bucket,
        MIN(price)   AS low,
        MAX(price)   AS high,
        FIRST_VALUE(price) OVER (PARTITION BY date_trunc('${safeInterval.replace(' ', '_')}', created_at) ORDER BY created_at ASC) AS open,
        LAST_VALUE(price)  OVER (PARTITION BY date_trunc('${safeInterval.replace(' ', '_')}', created_at) ORDER BY created_at ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS close
      FROM item_market
      WHERE item_id = $1
    `;
    const params = [itemId];
    if (from) { params.push(from); query += ` AND created_at >= $${params.length}`; }
    if (to)   { params.push(to);   query += ` AND created_at <= $${params.length}`; }
    query += ` ORDER BY bucket ASC`;

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/best-items?fee=5
// Strategy: buy at the avg daily low, sell at the avg daily high over 7 days.
// Using daily averages instead of global MIN/MAX avoids one-off outliers skewing results.
//
// buy_target   = AVG(daily MIN price)  over last 7 days
// sell_target  = AVG(daily MAX price)  over last 7 days
// net_profit   = sell_target * (1 - fee%) - buy_target
// margin_pct   = net_profit / sell_target * 100
// confidence   = (days with price movement / 7) * 100
// profit_score = margin_pct * (swing_days / 7)   ← sort key
//
// Minimum: 1 day with actual price movement in the last 7 days (confidence shows data quality).
router.get('/best-items', async (req, res) => {
  const rawFee = parseFloat(req.query.fee);
  const fee = Math.min(Math.max(isNaN(rawFee) ? 5 : rawFee, 0), 99);
  const fm = (100 - fee) / 100; // fee multiplier, e.g. 0.95 for 5%
  try {
    const { rows } = await db.query(`
      WITH daily_ranges AS (
        SELECT
          item_id,
          DATE(created_at)       AS day,
          MIN(price)             AS day_low,
          MAX(price)             AS day_high,
          COUNT(*)               AS day_records
        FROM item_market
        WHERE created_at >= datetime('now', '-7 days')
        GROUP BY item_id, DATE(created_at)
      ),
      item_stats AS (
        SELECT
          item_id,
          COUNT(*)                                              AS active_days,
          SUM(CASE WHEN day_records > 1 THEN 1 ELSE 0 END)    AS swing_days,
          ROUND(AVG(day_low),  0)                              AS buy_target,
          ROUND(AVG(day_high), 0)                              AS sell_target
        FROM daily_ranges
        GROUP BY item_id
        HAVING COUNT(*) >= 1
      )
      SELECT
        s.item_id,
        mi.name,
        s.buy_target,
        s.sell_target,
        ROUND(s.sell_target * $1 - s.buy_target, 0)                         AS net_profit,
        ROUND((s.sell_target * $1 - s.buy_target) / s.sell_target * 100, 1) AS margin_pct,
        s.swing_days,
        ROUND(CAST(s.swing_days AS REAL) / 7.0 * 100, 0)                   AS confidence_pct,
        ROUND(
          ((s.sell_target * $1 - s.buy_target) / s.sell_target * 100)
          * (CAST(s.swing_days AS REAL) / 7.0),
          2
        )                                                                     AS profit_score
      FROM item_stats s
      JOIN monitored_items mi ON mi.torn_item_id = s.item_id
      WHERE s.buy_target > 0
        AND s.sell_target * $1 > s.buy_target
        AND mi.is_active = 1
        AND s.swing_days >= 1
      ORDER BY profit_score DESC
      LIMIT 20
    `, [fm, fm, fm, fm]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/search?q= — item name autocomplete
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const { rows } = await db.query(
      `SELECT torn_item_id AS item_id, name
       FROM monitored_items
       WHERE LOWER(name) LIKE LOWER($1) AND is_active = TRUE
       GROUP BY torn_item_id
       LIMIT 10`,
      [`%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
