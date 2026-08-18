'use strict';

/**
 * HTTP API — the dashboard's JSON endpoints. A thin adapter over the injected
 * { state, catalog, summary, poller, db } (SRP/ISP: no business logic here beyond
 * request handling; the adjust endpoint persists through the db layer).
 */

const express = require('express');
const C = require('./constants');

function createRoutes({ state, catalog, summary, poller, db }) {
  const router = express.Router();

  router.get('/api/state', (_req, res) => res.json(summary()));

  // Per-item event breakdown for the click popups: newest N activity entries for one
  // item+direction (Date · Source · Category · Qty). Served from the in-memory feed.
  // `dir` = 'in' | 'out' | 'both' (both → chronological history for the Net column).
  // Without a `source` param it excludes the bazaar/display/market *ledger-side* entries
  // (those live in their own tabs) — only inventory-ledger flows compose the Monitor
  // IN/OUT + Inventory numbers. With `source=` it filters to exactly that source (used by
  // the Bazaar/Display/Market tabs' Added/Sold/Removed columns).
  router.get('/api/item-events', (req, res) => {
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
      .map(a => ({ ts: a.ts, source: a.source, qty: a.qty, category: a.category || '', logType: a.logType, dir: a.dir }));
    // Manual adjustments for this item+direction (inventory-level, so only when no source filter)
    if (!source) {
      state.adjustments
        .filter(a => a.itemId === itemId && (dir === 'both' || a.dir === dir))
        .forEach(a => events.push({ ts: a.ts, source: `Manual: ${a.label || 'Manual'}`, qty: a.qty, category: 'Manual', logType: null, dir: a.dir }));
      events.sort(dir === 'both' ? ((x, y) => x.ts - y.ts) : ((x, y) => y.ts - x.ts));
    }
    const sliced = events.slice(0, limit);
    // Detect when totals exist but all activity records were evicted from the rolling window.
    let truncated = false;
    if (sliced.length === 0 && !source) {
      const it = state.items[itemId];
      if (it && (dir === 'both' ? (it.in > 0 || it.out > 0) : it[dir] > 0)) truncated = true;
    }
    res.json({ events: sliced, truncated });
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
    await db.clear();
    res.json({ ok: true, state: summary() });
  });

  return router;
}

module.exports = { createRoutes };
