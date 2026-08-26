const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/portfolio/catalog — returns items in Torn API-compatible format
// The tampermonkey script expects: { items: { "itemId": { name, market_value }, ... } }
router.get('/catalog', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, market_price FROM torn_items ORDER BY id ASC'
    );
    const items = {};
    for (const row of rows) {
      items[row.id] = {
        name: row.name,
        market_value: row.market_price != null ? Number(row.market_price) : 0,
      };
    }
    res.json({ items });
  } catch (err) {
    console.error('[portfolio/catalog]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portfolio/logs — returns log entries matching filter criteria
// Query params: logTypes (comma-separated), from (unix ts), to (unix ts),
//               limit (default 2000), offset (default 0)
// Response matches Torn v2 user/log format: { log: [ ...entries... ] }
router.get('/logs', async (req, res) => {
  try {
    const logTypesRaw = req.query.logTypes;
    const from        = parseInt(req.query.from, 10);
    const to          = parseInt(req.query.to, 10);
    const limit       = Math.min(parseInt(req.query.limit, 10) || 2000, 5000);
    const offset      = parseInt(req.query.offset, 10) || 0;

    if (!logTypesRaw) {
      return res.status(400).json({ error: 'logTypes query param required (comma-separated)' });
    }

    const logTypes = logTypesRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (!logTypes.length) {
      return res.status(400).json({ error: 'No valid log types provided' });
    }

    const params = [logTypes, limit, offset];
    let whereClause = 'WHERE log_type = ANY($1::int[])';
    let paramIdx = 3;

    if (!isNaN(from)) {
      paramIdx++;
      whereClause += ` AND happened_at >= to_timestamp($${paramIdx})`;
      params.push(from);
    }
    if (!isNaN(to)) {
      paramIdx++;
      whereClause += ` AND happened_at <= to_timestamp($${paramIdx})`;
      params.push(to);
    }

    const query = `
      SELECT id, log_type, happened_at, data
      FROM torn_logs
      ${whereClause}
      ORDER BY happened_at DESC
      LIMIT $2 OFFSET $3
    `;

    const { rows } = await db.query(query, params);

    // Transform to Torn API v2 log entry format
    const log = rows.map(row => ({
      id: row.id,
      timestamp: Math.floor(row.happened_at.getTime() / 1000),
      details: { id: row.log_type },
      data: row.data,
      log: row.log_type,
    }));

    res.json({ log });
  } catch (err) {
    console.error('[portfolio/logs]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
