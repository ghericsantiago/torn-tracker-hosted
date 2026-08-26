'use strict';

const express    = require('express');
const path       = require('path');
const { spawn }  = require('child_process');
const db         = require('../db');
const { runSync } = require('../services/portfolio-sync');

const router = express.Router();

const TAX = 0.05;

// ── Auth ─────────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  // API callers get 401; browser gets redirected to login
  if (req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/admin');
}

router.use(requireAuth);

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/torn/index.html'));
});

// Per-item P&L aggregated from lot tables
router.get('/api/portfolio', async (req, res) => {
  try {
    const { rows } = await db.query(`
      WITH lot_summary AS (
        SELECT
          l.item_id,
          SUM(l.qty_remaining)                                   AS remaining,
          SUM(l.qty_remaining * l.unit_cost)                     AS cost_basis,
          SUM(l.qty_original)   FILTER (WHERE l.source = 'buy') AS total_bought,
          SUM(l.qty_original)   FILTER (WHERE l.source IN ('received','trade_in')) AS total_received,
          SUM(l.qty_original * l.unit_cost) FILTER (WHERE l.source = 'buy') AS total_cost
        FROM torn_lots l
        GROUP BY l.item_id
      ),
      event_summary AS (
        SELECT
          l.item_id,
          SUM(e.pnl)  FILTER (WHERE e.reason = 'sell') AS realized_pnl_sell,
          SUM(e.pnl)                                    AS realized_pnl_all,
          SUM(e.qty)  FILTER (WHERE e.reason = 'sell') AS total_sold
        FROM torn_lot_events e
        JOIN torn_lots l ON l.id = e.lot_id
        GROUP BY l.item_id
      ),
      snap_inventory AS (
        SELECT
          item_id,
          COALESCE(SUM(qty) FILTER (WHERE location = 'inventory'), 0) AS inv_qty,
          COALESCE(SUM(qty) FILTER (WHERE location = 'bazaar'),   0) AS baz_qty,
          COALESCE(SUM(qty) FILTER (WHERE location = 'display'),  0) AS disp_qty,
          MAX(list_price) FILTER (WHERE location = 'bazaar')          AS baz_price
        FROM (
          SELECT DISTINCT ON (item_id, location) item_id, location, qty, list_price
          FROM torn_inventory_snapshots
          ORDER BY item_id, location, taken_at DESC
        ) latest
        GROUP BY item_id
      )
      SELECT
        ls.item_id,
        ti.name,
        ti.type,
        ti.market_price,
        COALESCE(ls.total_bought,   0)  AS total_bought,
        COALESCE(ls.total_received, 0)  AS total_received,
        COALESCE(ls.total_cost,     0)  AS total_cost,
        COALESCE(es.total_sold,     0)  AS total_sold,
        ls.remaining,
        ls.cost_basis,
        -- avg cost of remaining units (NULL if no remaining inventory)
        CASE WHEN ls.remaining > 0
          THEN ls.cost_basis / ls.remaining
          ELSE NULL
        END AS avg_cost,
        -- break-even: avg_cost / (1 - tax), i.e. price needed to cover cost
        CASE WHEN ls.remaining > 0
          THEN ls.cost_basis / ls.remaining / ${1 - TAX}
          ELSE NULL
        END AS break_even,
        -- unrealized P&L on remaining units at current market price
        CASE WHEN ls.remaining > 0 AND ti.market_price IS NOT NULL
          THEN ls.remaining * ti.market_price * ${1 - TAX} - ls.cost_basis
          ELSE NULL
        END AS unrealized_pnl,
        COALESCE(es.realized_pnl_sell, 0) AS realized_pnl,
        -- snapshot quantities for location breakdown
        COALESCE(si.inv_qty,  0) AS inv_qty,
        COALESCE(si.baz_qty,  0) AS baz_qty,
        si.baz_price,
        COALESCE(si.disp_qty, 0) AS disp_qty
      FROM lot_summary ls
      JOIN torn_items ti         ON ti.id       = ls.item_id
      LEFT JOIN event_summary es ON es.item_id  = ls.item_id
      LEFT JOIN snap_inventory si ON si.item_id = ls.item_id
      ORDER BY unrealized_pnl DESC NULLS LAST
    `);

    const state = await db.query(
      "SELECT value FROM torn_sync_state WHERE key = 'last_sync_ts'"
    );
    const lastSyncTs = state.rows[0]?.value
      ? new Date(Number(state.rows[0].value) * 1000).toISOString()
      : null;

    const totals = rows.reduce((acc, r) => {
      acc.realized_pnl   += Number(r.realized_pnl)   || 0;
      acc.unrealized_pnl += Number(r.unrealized_pnl) || 0;
      acc.total_pnl      += (Number(r.realized_pnl) || 0) + (Number(r.unrealized_pnl) || 0);
      acc.cost_basis     += Number(r.cost_basis)     || 0;
      acc.total_value    += (Number(r.remaining) || 0) * (Number(r.market_price) || 0) * (1 - TAX);
      return acc;
    }, { realized_pnl: 0, unrealized_pnl: 0, total_pnl: 0, cost_basis: 0, total_value: 0 });

    res.json({
      syncedAt: lastSyncTs,
      totals,
      items: rows.map(r => ({
        item_id:        r.item_id,
        name:           r.name,
        type:           r.type,
        market_price:   Number(r.market_price)  || null,
        total_bought:   Number(r.total_bought),
        total_received: Number(r.total_received),
        total_sold:     Number(r.total_sold),
        remaining:      Number(r.remaining),
        cost_basis:     r.cost_basis  != null ? Number(r.cost_basis)  : null,
        avg_cost:       r.avg_cost    != null ? Number(r.avg_cost)    : null,
        break_even:     r.break_even  != null ? Number(r.break_even)  : null,
        realized_pnl:   Number(r.realized_pnl),
        unrealized_pnl: r.unrealized_pnl != null ? Number(r.unrealized_pnl) : null,
        total_pnl:      r.unrealized_pnl != null
          ? (Number(r.realized_pnl) || 0) + (Number(r.unrealized_pnl) || 0)
          : Number(r.realized_pnl) || null,
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

// Sales history — supports ?limit=50&offset=0&from=<ISO>&to=<ISO>
router.get('/api/sales', async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const from   = req.query.from || null;
    const to     = req.query.to   || null;

    const { rows } = await db.query(`
      SELECT
        ti.name                           AS item_name,
        ti.id                             AS item_id,
        e.log_id,
        e.happened_at,
        e.qty,
        e.unit_revenue,
        e.qty * e.unit_revenue            AS total_revenue,
        e.pnl,
        l.unit_cost,
        l.acquired_at                     AS lot_acquired_at,
        l.source                          AS lot_source
      FROM torn_lot_events e
      JOIN torn_lots l  ON l.id  = e.lot_id
      JOIN torn_items ti ON ti.id = l.item_id
      WHERE e.reason = 'sell'
        AND ($3::timestamptz IS NULL OR e.happened_at >= $3)
        AND ($4::timestamptz IS NULL OR e.happened_at <= $4)
      ORDER BY e.happened_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset, from, to]);

    const totals = await db.query(`
      SELECT
        COUNT(*)        AS total_rows,
        SUM(e.pnl)      AS total_pnl,
        SUM(e.qty * e.unit_revenue) AS total_revenue
      FROM torn_lot_events e
      WHERE e.reason = 'sell'
        AND ($1::timestamptz IS NULL OR e.happened_at >= $1)
        AND ($2::timestamptz IS NULL OR e.happened_at <= $2)
    `, [from, to]);

    res.json({
      total:         Number(totals.rows[0].total_rows),
      total_pnl:     Number(totals.rows[0].total_pnl)     || 0,
      total_revenue: Number(totals.rows[0].total_revenue) || 0,
      sales: rows.map(r => ({
        item_id:         r.item_id,
        item_name:       r.item_name,
        log_id:          r.log_id,
        happened_at:     r.happened_at,
        qty:             Number(r.qty),
        unit_revenue:    Number(r.unit_revenue),
        total_revenue:   Number(r.total_revenue),
        pnl:             Number(r.pnl),
        unit_cost:       Number(r.unit_cost),
        lot_acquired_at: r.lot_acquired_at,
        lot_source:      r.lot_source,
      })),
    });
  } catch (err) {
    console.error('[torn/sales]', err.message);
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
  runSync();
  res.json({ ok: true, message: 'Sync started' });
});

// Backfill status — reports progress of the historical log fetch
router.get('/api/backfill-status', async (req, res) => {
  try {
    const keys = ['backfill_running', 'backfill_pages', 'backfill_oldest_ts', 'last_lot_ts', 'backfill_completed'];
    const { rows: stateRows } = await db.query(
      'SELECT key, value FROM torn_sync_state WHERE key = ANY($1)', [keys]
    );
    const state = Object.fromEntries(stateRows.map(r => [r.key, r.value]));

    const { rows: logStats } = await db.query(
      'SELECT COUNT(*) AS total, MIN(happened_at) AS oldest, MAX(happened_at) AS newest FROM torn_logs'
    );
    const { rows: lotStats } = await db.query(
      'SELECT COUNT(*) AS lots, SUM(qty_remaining) AS remaining FROM torn_lots'
    );

    const stats = logStats[0];
    res.json({
      running:      state.backfill_running === '1',
      completed:    state.backfill_completed === '1',
      pages:        Number(state.backfill_pages)     || 0,
      oldest_ts:    state.backfill_oldest_ts
        ? new Date(Number(state.backfill_oldest_ts) * 1000).toISOString()
        : null,
      lot_cursor:   state.last_lot_ts
        ? new Date(Number(state.last_lot_ts) * 1000).toISOString()
        : null,
      total_logs:   Number(stats.total),
      oldest_log:   stats.oldest,
      newest_log:   stats.newest,
      total_lots:   Number(lotStats[0].lots),
      total_units:  Number(lotStats[0].remaining) || 0,
    });
  } catch (err) {
    console.error('[torn/backfill-status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Start a full historical log backfill (runs backfill-logs.js as a child process)
let backfillProc = null;
router.post('/api/backfill/start', async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT value FROM torn_sync_state WHERE key = 'backfill_running'"
    );
    if (rows[0]?.value === '1') {
      return res.json({ ok: false, message: 'Backfill already running' });
    }
    if (backfillProc && !backfillProc.exitCode && backfillProc.exitCode !== null) {
      return res.json({ ok: false, message: 'Backfill process still active' });
    }

    const scriptPath = require('path').join(__dirname, '../scripts/backfill-logs.js');
    backfillProc = spawn(process.execPath, [scriptPath], {
      cwd:      require('path').join(__dirname, '..'),
      env:      process.env,
      detached: false,
      stdio:    ['ignore', 'pipe', 'pipe'],
    });
    backfillProc.stdout.on('data', d => process.stdout.write('[backfill] ' + d));
    backfillProc.stderr.on('data', d => process.stderr.write('[backfill] ' + d));
    backfillProc.on('exit', code => console.log(`[backfill] Process exited: ${code}`));

    res.json({ ok: true, message: 'Backfill started' });
  } catch (err) {
    console.error('[torn/backfill/start]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
