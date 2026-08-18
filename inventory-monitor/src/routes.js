'use strict';

/**
 * HTTP API — the dashboard's JSON endpoints. A thin adapter over the injected
 * { state, catalog, summary, poller, db } (SRP/ISP: no business logic here beyond
 * request handling; the adjust endpoint persists through the db layer).
 */

const express = require('express');
const C = require('./constants');
const { fifoOut } = require('./ledger/fifo');

function createRoutes({ state, catalog, summary, poller, db, reconcileFifo }) {
  const router = express.Router();

  router.get('/api/state', (_req, res) => res.json(summary()));

  // Per-item event breakdown for the click popups: newest N activity entries for one
  // item+direction (Date · Source · Category · Qty). Served from the in-memory feed.
  // `dir` = 'in' | 'out' | 'both' (both → chronological history for the Net column).
  // Without a `source` param it excludes the bazaar/display/market *ledger-side* entries
  // (those live in their own tabs) — only inventory-ledger flows compose the Monitor
  // IN/OUT + Inventory numbers. With `source=` it filters to exactly that source (used by
  // the Bazaar/Display/Market tabs' Added/Sold/Removed columns).
  router.get('/api/item-events', async (req, res) => {
    const itemId = String(req.query.itemId || '');
    const dir    = req.query.dir === 'both' ? 'both' : (req.query.dir === 'in' ? 'in' : 'out');
    const source = req.query.source ? String(req.query.source) : null;
    const limit  = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
    if (!itemId) return res.json({ events: [] });

    // Location-ledger popups (Bazaar/Display/Market tabs) read from the dedicated
    // per-scope event history — the shared activity feed is capped at activityMax and
    // would drop old location events (the tab totals are never trimmed).
    if (source && C.LOCATION_LEDGER_SOURCES.has(source)) {
      const scope = source.startsWith('Bazaar ') ? 'bazaar' : source.startsWith('Display ') ? 'display' : 'market';
      const kind  = source.split(' ')[1];
      const events = state.locationEvents[scope]
        .filter(e => e.itemId === itemId && e.kind === kind)
        .slice(0, limit)
        .map(e => ({ ts: e.ts, source, qty: e.qty, category: '', logType: null, dir: kind === 'Added' ? 'in' : 'out' }));
      return res.json({ events });
    }

    const events = state.activity
      .filter(a => a.itemId === itemId && (dir === 'both' || a.dir === dir)
        && (source ? a.source === source : !C.LOCATION_LEDGER_SOURCES.has(a.source)))
      .slice(0, limit)
      .map(a => ({ ts: a.ts, logId: a.logId ?? null, source: a.source, qty: a.qty, category: a.category || '', logType: a.logType, dir: a.dir, unitCost: a.unitCost ?? null }));
    // Manual adjustments for this item+direction (inventory-level, so only when no source filter)
    if (!source) {
      state.adjustments
        .filter(a => a.itemId === itemId && (dir === 'both' || a.dir === dir))
        .forEach(a => events.push({ ts: a.ts, logId: null, source: `Manual: ${a.label || 'Manual'}`, qty: a.qty, category: 'Manual', logType: null, dir: a.dir, unitCost: null }));
      events.sort(dir === 'both' ? ((x, y) => x.ts - y.ts) : ((x, y) => y.ts - x.ts));
    }
    const sliced = events.slice(0, limit);

    // Enrich events that are missing unitCost by looking up the transactions table.
    // Activity records loaded from DB don't carry unit_cost; transactions does.
    const missingLogIds = sliced
      .filter(e => e.unitCost === null && e.logId !== null && e.dir === 'in')
      .map(e => e.logId);
    if (missingLogIds.length > 0) {
      try {
        const rows = await db.pool.query(
          `SELECT log_id, unit_price FROM transactions
           WHERE item_id = $1 AND side = 'buy' AND log_id = ANY($2)`,
          [itemId, missingLogIds]
        );
        const priceByLogId = new Map(rows.rows.map(r => [r.log_id, Number(r.unit_price)]));
        for (const e of sliced) {
          if (e.unitCost === null && e.logId !== null && priceByLogId.has(e.logId)) {
            e.unitCost = priceByLogId.get(e.logId);
          }
        }
      } catch { /* non-fatal — price enrichment is best-effort */ }
    }

    // Detect when totals exist but all activity records were evicted from the rolling window.
    let truncated = false;
    if (sliced.length === 0 && !source) {
      const it = state.items[itemId];
      if (it && (dir === 'both' ? (it.in > 0 || it.out > 0) : it[dir] > 0)) truncated = true;
    }
    // Strip internal logId before sending to client
    res.json({ events: sliced.map(({ logId, ...rest }) => rest), truncated });
  });

  // Paginated activity feed — merges log activity + manual adjustments, newest first.
  // Used by the infinite-scroll Recent Activity section.
  // Query params: offset (int, default 0), limit (int, default 50 max 100), q (search filter).
  router.get('/api/activity', (req, res) => {
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const q      = (req.query.q || '').toLowerCase();

    const adjActs = state.adjustments.map(a => ({
      ts: a.ts, dir: a.dir, itemId: a.itemId, name: catalog.itemName(a.itemId),
      qty: a.qty, source: `Manual: ${a.label || 'Manual'}`, title: 'Manual adjustment',
    }));

    let all = state.activity.concat(adjActs).sort((a, b) => b.ts - a.ts);
    if (q) all = all.filter(a =>
      (a.name || '').toLowerCase().includes(q) || (a.source || '').toLowerCase().includes(q));

    const total = all.length;
    res.json({ items: all.slice(offset, offset + limit), total, hasMore: offset + limit < total });
  });

  // Manual adjustments (reconciliation layer):
  //   { item, scope?, dir: 'in'|'out', qty, label?, note? }   — add a manual in/out record
  //   { item, scope?, balance, label?, note? }                 — reconcile: adjust to a target balance
  //   scope: 'inventory' (default) | 'bazaar' | 'display' | 'market'
  router.post('/api/adjust', async (req, res) => {
    try {
      const body  = req.body || {};
      const label = String(body.label || 'Manual').trim().slice(0, 60) || 'Manual';
      const note  = String(body.note || '').trim().slice(0, 300);
      const r     = catalog.resolveItemId(body.item);
      if (r.error) return res.status(400).json({ ok: false, error: r.error });
      const itemId = String(r.id);

      const VALID_SCOPES = new Set(['inventory', 'bazaar', 'display', 'market']);
      const scope = VALID_SCOPES.has(body.scope) ? body.scope : 'inventory';

      let dir, qty;
      if (body.balance !== undefined && body.balance !== null && body.balance !== '') {
        // Reconcile mode: compute the adjustment needed to hit the target balance for the given scope.
        const target = Math.floor(Number(body.balance));
        if (!Number.isFinite(target) || target < 0)
          return res.status(400).json({ ok: false, error: 'Balance must be a non-negative number.' });
        let base;
        if (scope === 'bazaar')   base = state.bazaar.items[itemId]  ? state.bazaar.items[itemId].net  : 0;
        else if (scope === 'display') base = state.display.items[itemId] ? state.display.items[itemId].net : 0;
        else if (scope === 'market')  base = state.market.items[itemId]  ? state.market.items[itemId].net  : 0;
        else                          base = state.items[itemId]          ? state.items[itemId].net          : 0;
        for (const a of state.adjustments)
          if (a.itemId === itemId && a.scope === scope) base += a.dir === 'in' ? a.qty : -a.qty;
        const diff = target - base;
        if (diff === 0) return res.json({ ok: true, adjustment: null, noop: true });
        dir = diff > 0 ? 'in' : 'out';
        qty = Math.abs(diff);
      } else {
        dir = body.dir === 'in' ? 'in' : body.dir === 'out' ? 'out' : null;
        qty = Math.floor(Number(body.qty));
        if (!dir) return res.status(400).json({ ok: false, error: 'dir must be "in" or "out".' });
        if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ ok: false, error: 'qty must be a positive number.' });
      }

      const ts = Date.now();
      const ins = await db.pool.query(
        'INSERT INTO manual_adjustments (ts, item_id, scope, dir, qty, label, note) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [ts, itemId, scope, dir, qty, label, note]
      );
      const adj = { id: ins.rows[0].id, ts, itemId, scope, dir, qty, label, note };
      state.adjustments.unshift(adj);
      if (state.adjustments.length > 500) state.adjustments.length = 500;
      res.json({ ok: true, adjustment: { ...adj, name: catalog.itemName(itemId) } });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.delete('/api/adjust/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Invalid id.' });
      await db.pool.query('DELETE FROM manual_adjustments WHERE id = $1', [id]);
      state.adjustments = state.adjustments.filter(a => a.id !== id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/api/poll', async (_req, res) => {
    const r = await poller.poll();
    res.json({ ok: !r.error, ...r, state: summary() });
  });

  // Transaction ledger — paginated with keyset cursor, filtered by item/category/channel/side/date
  router.get('/api/transactions', async (req, res) => {
    try {
      const limit    = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
      const cursor   = req.query.cursor || null;  // '<ts>:<id>' keyset
      const itemId   = req.query.item_id   ? String(req.query.item_id)   : null;
      const category = req.query.category  ? String(req.query.category)  : null;
      const channel  = req.query.channel   ? String(req.query.channel)   : null;
      const side     = req.query.side      ? String(req.query.side)      : null;
      const fromTs   = req.query.from_ts   ? Number(req.query.from_ts)   : null;
      const toTs     = req.query.to_ts     ? Number(req.query.to_ts)     : null;
      const q        = req.query.q         ? String(req.query.q).toLowerCase() : null;

      const conditions = [];
      const params     = [];
      let p = 1;

      if (cursor) {
        const [cTs, cId] = cursor.split(':');
        conditions.push(`(ts < $${p} OR (ts = $${p} AND id < $${p+1}))`);
        params.push(Number(cTs), Number(cId)); p += 2;
      }
      if (itemId)   { conditions.push(`item_id = $${p++}`);   params.push(itemId); }
      if (category) { conditions.push(`item_category = $${p++}`); params.push(category); }
      if (channel)  { conditions.push(`channel = $${p++}`);   params.push(channel); }
      if (side)     { conditions.push(`side = $${p++}`);      params.push(side); }
      if (fromTs)   { conditions.push(`ts >= $${p++}`);       params.push(fromTs); }
      if (toTs)     { conditions.push(`ts <= $${p++}`);       params.push(toTs); }
      if (q)        { conditions.push(`LOWER(item_name) LIKE $${p++}`); params.push(`%${q}%`); }

      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

      // Build a separate WHERE without the cursor for summary totals
      const summaryConditions = conditions.filter((_, i) => {
        // Skip the cursor condition (it's always the first if present)
        return !(cursor && i === 0);
      });
      const summaryParams  = cursor ? params.slice(2) : params.slice();
      const summaryWhere   = summaryConditions.length ? 'WHERE ' + summaryConditions.join(' AND ') : '';
      // Re-parameterize summary conditions (params start at $1 since no cursor offset)
      const summaryParamsAdjusted = summaryParams;
      const summaryWhereAdj = summaryConditions.length
        ? 'WHERE ' + summaryConditions.map((c, i) => c.replace(/\$\d+/g, `$${i + 1}`)).join(' AND ')
        : '';

      const [rowsResult, summaryResult] = await Promise.all([
        db.pool.query(
          `SELECT id, ts, log_type, channel, side, item_id, item_name, item_category, qty, unit_price, total_price, note
           FROM transactions ${where} ORDER BY ts DESC, id DESC LIMIT $${p}`,
          [...params, limit + 1]
        ),
        db.pool.query(
          `SELECT
             COALESCE(SUM(CASE WHEN side = 'buy'  THEN total_price ELSE 0 END), 0) AS total_spent,
             COALESCE(SUM(CASE WHEN side = 'sell' THEN total_price ELSE 0 END), 0) AS total_revenue,
             COUNT(*) AS tx_count,
             COUNT(DISTINCT item_id) AS item_count
           FROM transactions ${summaryWhereAdj}`,
          summaryParamsAdjusted
        ),
      ]);

      const rows = rowsResult.rows;
      const hasMore = rows.length > limit;
      if (hasMore) rows.pop();

      const last = rows[rows.length - 1];
      const nextCursor = hasMore && last ? `${last.ts}:${last.id}` : null;

      const s = summaryResult.rows[0];
      res.json({
        rows: rows.map(r => ({
          id: Number(r.id), ts: Number(r.ts), logType: r.log_type,
          channel: r.channel, side: r.side,
          itemId: r.item_id, itemName: r.item_name, itemCategory: r.item_category || '',
          qty: Number(r.qty),
          unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
          totalPrice: r.total_price != null ? Number(r.total_price) : null,
          note: r.note || null,
        })),
        summary: {
          totalSpent:   Number(s.total_spent),
          totalRevenue: Number(s.total_revenue),
          txCount:      Number(s.tx_count),
          itemCount:    Number(s.item_count),
        },
        nextCursor,
        hasMore,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Manual consolidation — create an outflow transaction (use/gift/faction/museum)
  // without a corresponding log. Also depletes FIFO lots for the item.
  // Body: { item, qty, channel, note? }
  const VALID_USE_CHANNELS = new Set(['usage', 'gift', 'faction', 'museum']);
  router.post('/api/transactions/manual', async (req, res) => {
    try {
      const body = req.body || {};
      const r = catalog.resolveItemId(body.item);
      if (r.error) return res.status(400).json({ ok: false, error: r.error });
      const itemId = String(r.id);

      const channel = VALID_USE_CHANNELS.has(body.channel) ? body.channel : 'usage';
      const qty     = Math.floor(Number(body.qty));
      if (!Number.isFinite(qty) || qty <= 0)
        return res.status(400).json({ ok: false, error: 'qty must be a positive number.' });

      const note = String(body.note || '').trim().slice(0, 300) || null;
      const ts   = Date.now();
      const itemName = catalog.itemName(itemId) || itemId;
      const category = catalog.itemCategory(itemId) || null;

      // Insert transaction row (log_id = null → manual, no conflict check needed)
      const ins = await db.pool.query(
        `INSERT INTO transactions (ts, log_id, log_type, channel, side, item_id, item_name, item_category, qty, unit_price, total_price, note)
         VALUES ($1, NULL, 0, $2, 'use', $3, $4, $5, $6, NULL, NULL, $7) RETURNING id`,
        [ts, channel, itemId, itemName, category, qty, note]
      );

      // Deplete FIFO lots — track only newly-dirtied IDs so we can flush them immediately
      const prevDirty = new Set(state.fifo.dirtyIds);
      fifoOut(itemId, qty, state);
      const newlyDirty = [...state.fifo.dirtyIds].filter(id => !prevDirty.has(id));
      for (const id of newlyDirty) {
        let remaining = 0;
        outer: for (const lots of state.fifo.lots.values()) {
          for (const lot of lots) {
            if (lot.id === id) { remaining = lot.remaining; break outer; }
          }
        }
        await db.pool.query('UPDATE fifo_lots SET remaining_qty = $1 WHERE id = $2', [remaining, id]);
        state.fifo.dirtyIds.delete(id);
      }

      res.json({
        ok: true,
        transaction: {
          id: Number(ins.rows[0].id), ts, channel, side: 'use',
          itemId, itemName, itemCategory: category || '', qty,
          unitPrice: null, totalPrice: null, note,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // On-demand FIFO reconciliation. Body: { reset?: boolean }
  //   reset=true: first removes all existing Reconciliation source lots from DB and
  //   memory (clean slate), then runs the reconciler so it recreates them from buy history.
  router.post('/api/fifo/reconcile', async (req, res) => {
    if (!reconcileFifo) return res.status(503).json({ ok: false, error: 'Reconciler not available.' });
    try {
      const reset = !!(req.body && req.body.reset);
      let lotsCleared = 0;

      if (reset) {
        // Remove all in-memory Reconciliation lots and delete them from DB
        for (const [itemId, lots] of state.fifo.lots.entries()) {
          const keep = lots.filter(l => l.source !== 'Reconciliation');
          if (keep.length !== lots.length) {
            state.fifo.lots.set(itemId, keep);
            lotsCleared += lots.length - keep.length;
          }
        }
        // Also remove any pending-insert Reconciliation lots (not yet in DB)
        state.fifo.newLots = state.fifo.newLots.filter(l => l.source !== 'Reconciliation');
        await db.pool.query(`DELETE FROM fifo_lots WHERE source = 'Reconciliation'`);
      }

      const result = await reconcileFifo(state);

      // Flush new lots (INSERT) and dirty lots (UPDATE) immediately
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        for (const lot of state.fifo.newLots) {
          const r = await client.query(
            `INSERT INTO fifo_lots (ts, log_id, item_id, item_name, item_category, total_qty, remaining_qty, unit_cost, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [lot.ts, lot.logId, lot.itemId, lot.itemName, lot.category, lot.totalQty, lot.remaining, lot.unitCost, lot.source]
          );
          if (r.rows[0]) lot.id = Number(r.rows[0].id);
        }
        state.fifo.newLots = [];

        for (const id of state.fifo.dirtyIds) {
          let remaining = 0;
          outer: for (const lots of state.fifo.lots.values()) {
            for (const lot of lots) {
              if (lot.id === id) { remaining = lot.remaining; break outer; }
            }
          }
          await client.query('UPDATE fifo_lots SET remaining_qty = $1 WHERE id = $2', [remaining, id]);
        }
        state.fifo.dirtyIds.clear();
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }

      res.json({ ok: true, lotsCleared, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Edit a FIFO lot's unit cost — lets users correct $0 reconciliation lots or fix wrong costs.
  // Body: { unitCost: number }. Persists immediately; no poll needed.
  router.patch('/api/fifo/lots/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Invalid lot id.' });

      const unitCost = Math.floor(Number((req.body || {}).unitCost));
      if (!Number.isFinite(unitCost) || unitCost < 0)
        return res.status(400).json({ ok: false, error: 'unitCost must be a non-negative integer.' });

      let found = null;
      for (const lots of state.fifo.lots.values()) {
        for (const lot of lots) { if (lot.id === id) { found = lot; break; } }
        if (found) break;
      }
      if (!found) return res.status(404).json({ ok: false, error: 'Lot not found.' });

      found.unitCost = unitCost;
      await db.pool.query('UPDATE fifo_lots SET unit_cost = $1 WHERE id = $2', [unitCost, id]);

      res.json({
        ok: true,
        lot: {
          id: found.id, ts: found.ts, source: found.source,
          totalQty: found.totalQty, remaining: found.remaining,
          unitCost: found.unitCost, lotValue: found.remaining * found.unitCost,
          depleted: found.remaining === 0,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Delete a single FIFO lot (e.g. an old $0 Reconciliation lot the user wants to replace).
  // Removes from in-memory state and DB immediately.
  router.delete('/api/fifo/lots/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Invalid lot id.' });

      let found = false;
      for (const [itemId, lots] of state.fifo.lots.entries()) {
        const idx = lots.findIndex(l => l.id === id);
        if (idx !== -1) {
          lots.splice(idx, 1);
          state.fifo.dirtyIds.delete(id);
          found = true;
          break;
        }
      }
      // Also remove from newLots (lot not yet persisted — may have null id, skip)
      state.fifo.newLots = state.fifo.newLots.filter(l => l.id !== id);
      await db.pool.query('DELETE FROM fifo_lots WHERE id = $1', [id]);
      res.json({ ok: true, found });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // FIFO lot breakdown for a single item — used by the FIFO popup in the Inventory tab
  router.get('/api/fifo/lots/:itemId', (req, res) => {
    const itemId = String(req.params.itemId);
    const lots   = state.fifo.lots.get(itemId) || [];
    const active = lots.filter(l => l.remaining > 0);
    const totalRemaining = active.reduce((s, l) => s + l.remaining, 0);
    const totalCost      = active.reduce((s, l) => s + l.remaining * l.unitCost, 0);
    res.json({
      lots: lots.map(l => ({
        id: l.id, ts: l.ts, source: l.source,
        totalQty: l.totalQty, remaining: l.remaining,
        unitCost: l.unitCost, lotValue: l.remaining * l.unitCost,
        depleted: l.remaining === 0,
      })),
      summary: {
        totalRemaining,
        avgCost:   totalRemaining > 0 ? Math.round(totalCost / totalRemaining) : null,
        costBasis: totalCost,
      },
    });
  });

  router.post('/api/reset', async (_req, res) => {
    state.items = {};
    state.activity = [];
    state.processedIds = [];
    state.lastTs = null;
    poller.resetDedupe();
    state.poll = { lastTs: Date.now(), lastOk: true, lastMsg: 'State reset — next poll refetches from start', processed: 0 };
    state.bazaar = { items: {}, revenue: 0, unitsSold: 0 };
    state.display = { items: {} };
    state.market = { items: {}, revenue: 0, unitsSold: 0 };
    state.trades = { byId: new Map(), trades: [] };
    state.museum = { pointsReceived: 0, swaps: [] };
    state.adjustments = [];
    state.transfers = [];
    state.locationEvents = { bazaar: [], display: [], market: [] };
    state.fifo = { lots: new Map(), newLots: [], dirtyIds: new Set() };
    state.transactions = [];
    await db.clear();
    res.json({ ok: true, state: summary() });
  });

  return router;
}

module.exports = { createRoutes };
