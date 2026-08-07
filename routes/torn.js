const express    = require('express');
const path       = require('path');
const db         = require('../db');
const { runSync } = require('../services/portfolio-sync');

const router = express.Router();

const TAX = 0.05;

// Dashboard HTML
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/torn/index.html'));
});

// Per-item aggregates with P&L
router.get('/api/portfolio', async (req, res) => {
  try {
    const { rows } = await db.query(`
      WITH buys AS (
        SELECT item_id,
          SUM(qty)          AS total_bought,
          SUM(total_amount) AS total_cost
        FROM torn_transactions WHERE type = 'buy'
        GROUP BY item_id
      ),
      sells AS (
        SELECT item_id,
          SUM(qty)          AS total_sold,
          SUM(total_amount) AS total_revenue
        FROM torn_transactions WHERE type = 'sell'
        GROUP BY item_id
      ),
      latest_snap AS (
        SELECT DISTINCT ON (item_id, location)
          item_id, location, qty, list_price
        FROM torn_inventory_snapshots
        ORDER BY item_id, location, taken_at DESC
      )
      SELECT
        b.item_id,
        ti.name,
        ti.type,
        ti.market_price,
        b.total_bought,
        b.total_cost,
        COALESCE(s.total_sold,    0) AS total_sold,
        COALESCE(s.total_revenue, 0) AS total_revenue,
        b.total_cost::NUMERIC / NULLIF(b.total_bought, 0)        AS avg_cost,
        b.total_cost::NUMERIC / NULLIF(b.total_bought, 0) / ${1 - TAX} AS break_even,
        b.total_bought - COALESCE(s.total_sold, 0)               AS remaining,
        COALESCE(s.total_revenue, 0) * ${1 - TAX}
          - COALESCE(s.total_sold, 0)
            * (b.total_cost::NUMERIC / NULLIF(b.total_bought, 0)) AS realized_pnl,
        (b.total_bought - COALESCE(s.total_sold, 0))
          * (COALESCE(ti.market_price, 0) * ${1 - TAX}
             - b.total_cost::NUMERIC / NULLIF(b.total_bought, 0)) AS unrealized_pnl,
        COALESCE((SELECT qty FROM latest_snap
                  WHERE item_id = b.item_id AND location = 'inventory'), 0) AS inv_qty,
        COALESCE((SELECT qty FROM latest_snap
                  WHERE item_id = b.item_id AND location = 'bazaar'), 0) AS baz_qty,
        (SELECT list_price FROM latest_snap
         WHERE item_id = b.item_id AND location = 'bazaar')              AS baz_price,
        COALESCE((SELECT qty FROM latest_snap
                  WHERE item_id = b.item_id AND location = 'display'), 0) AS disp_qty
      FROM buys b
      LEFT JOIN sells s     ON s.item_id = b.item_id
      LEFT JOIN torn_items ti ON ti.id   = b.item_id
      ORDER BY unrealized_pnl DESC NULLS LAST
    `);

    const state = await db.query(
      "SELECT value FROM torn_sync_state WHERE key = 'last_sync_ts'"
    );
    const lastSyncTs = state.rows[0]?.value
      ? new Date(Number(state.rows[0].value) * 1000).toISOString()
      : null;

    const totals = rows.reduce((acc, r) => {
      const realized   = Number(r.realized_pnl)   || 0;
      const unrealized = Number(r.unrealized_pnl) || 0;
      const remaining  = Number(r.remaining)      || 0;
      acc.realized_pnl   += realized;
      acc.unrealized_pnl += unrealized;
      acc.total_pnl      += realized + unrealized;
      acc.cost_basis     += remaining * (Number(r.avg_cost) || 0);
      acc.total_value    += remaining * (Number(r.market_price) || 0) * (1 - TAX);
      return acc;
    }, { realized_pnl: 0, unrealized_pnl: 0, total_pnl: 0, cost_basis: 0, total_value: 0 });

    res.json({
      syncedAt: lastSyncTs,
      totals,
      items: rows.map(r => ({
        item_id:      r.item_id,
        name:         r.name,
        type:         r.type,
        market_price: Number(r.market_price) || null,
        total_bought: Number(r.total_bought),
        total_sold:   Number(r.total_sold),
        remaining:    Number(r.remaining),
        avg_cost:     Number(r.avg_cost)      || null,
        break_even:   Number(r.break_even)    || null,
        realized_pnl:   Number(r.realized_pnl),
        unrealized_pnl: Number(r.unrealized_pnl),
        total_pnl:      Number(r.realized_pnl) + Number(r.unrealized_pnl),
        inv_qty:   Number(r.inv_qty),
        baz_qty:   Number(r.baz_qty),
        baz_price: r.baz_price ? Number(r.baz_price) : null,
        disp_qty:  Number(r.disp_qty),
      })),
    });
  } catch (err) {
    console.error('[torn/portfolio]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Daily portfolio value from inventory snapshots
router.get('/api/history', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        date_trunc('day', s.taken_at) AS day,
        SUM(s.qty * COALESCE(ti.market_price, 0)) AS total_value,
        COUNT(DISTINCT s.item_id)                  AS distinct_items
      FROM torn_inventory_snapshots s
      JOIN torn_items ti ON ti.id = s.item_id
      GROUP BY day
      ORDER BY day
    `);
    res.json(rows.map(r => ({
      day:            r.day,
      total_value:    Number(r.total_value),
      distinct_items: Number(r.distinct_items),
    })));
  } catch (err) {
    console.error('[torn/history]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Manual sync trigger
router.post('/api/sync', (req, res) => {
  runSync(); // fire and forget
  res.json({ ok: true, message: 'Sync started' });
});

module.exports = router;
