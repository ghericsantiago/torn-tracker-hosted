'use strict';

/**
 * FIFO reconciliation — ensures that the FIFO remaining total for every item
 * matches the true inventory net (log ledger + manual inventory adjustments).
 *
 * Gaps are closed automatically:
 *   gap > 0 (FIFO under-counts) → create Reconciliation lots that mirror the item's
 *                                  actual purchase history (newest first), so the avg
 *                                  cost reflects real prices rather than $0.
 *                                  Any remainder beyond tracked history falls back to
 *                                  lastKnownCost (or $0 for pre-monitoring stock).
 *   gap < 0 (FIFO over-counts)  → fifoOut to deplete the oldest lots
 *
 * Called after every poll cycle (silent) and via POST /api/fifo/reconcile (on demand).
 */

const { fifoOut } = require('./fifo');

function createFifoReconciler({ catalog, pool }) {
  return async function reconcileFifo(state) {
    // Build per-item inventory-scope manual adjustment totals
    const adjNet = {};
    for (const a of state.adjustments) {
      if (!a.scope || a.scope === 'inventory') {
        adjNet[a.itemId] = (adjNet[a.itemId] || 0) + (a.dir === 'in' ? a.qty : -a.qty);
      }
    }

    // Pre-load buy history for all items in one query (newest first per item).
    // These are all lots with a known price — active + depleted — used purely
    // for pricing reconciliation lots (not for QTY accounting).
    const histByItem = new Map(); // itemId → [{unitCost, qty}] newest-first
    if (pool) {
      try {
        const rows = await pool.query(
          `SELECT item_id, unit_cost, total_qty
           FROM fifo_lots
           WHERE unit_cost > 0
           ORDER BY item_id, ts DESC, id DESC`
        );
        for (const r of rows.rows) {
          const key = r.item_id;
          if (!histByItem.has(key)) histByItem.set(key, []);
          histByItem.get(key).push({ unitCost: Number(r.unit_cost), qty: Number(r.total_qty) });
        }
      } catch (e) {
        console.warn('[reconcile] could not load lot history:', e.message);
      }
    }

    let itemsAffected = 0, unitsCreated = 0, unitsDepleted = 0;

    for (const [itemId, item] of Object.entries(state.items)) {
      const trueNet   = Math.max(0, item.net + (adjNet[itemId] || 0));
      const lots      = state.fifo.lots.get(itemId) || [];
      const fifoTotal = lots.reduce((s, l) => s + l.remaining, 0);
      const diff      = trueNet - fifoTotal;

      if (diff === 0) continue;
      itemsAffected++;

      if (diff > 0) {
        // Walk purchase history (newest first) and create one Reconciliation lot
        // per purchase step until the gap is filled, mirroring the actual buy record.
        const history = histByItem.get(String(itemId)) || [];
        let remaining = diff;

        for (const h of history) {
          if (remaining <= 0) break;
          const qty = Math.min(remaining, h.qty);
          const lot = {
            id: null, ts: Date.now(), logId: null,
            itemId: String(itemId),
            itemName: catalog.itemName(itemId) || String(itemId),
            category: catalog.itemCategory(itemId) || '',
            totalQty: qty, remaining: qty,
            unitCost: h.unitCost,
            source: 'Reconciliation',
          };
          if (!state.fifo.lots.has(itemId)) state.fifo.lots.set(itemId, []);
          state.fifo.lots.get(itemId).push(lot);
          state.fifo.newLots.push(lot);
          unitsCreated += qty;
          remaining -= qty;
        }

        // Any units not covered by purchase history (pre-monitoring stock or
        // items never tracked as buys) fall back to lastKnownCost or $0.
        if (remaining > 0) {
          const unitCost = state.fifo.lastKnownCost.get(String(itemId)) || 0;
          const lot = {
            id: null, ts: Date.now(), logId: null,
            itemId: String(itemId),
            itemName: catalog.itemName(itemId) || String(itemId),
            category: catalog.itemCategory(itemId) || '',
            totalQty: remaining, remaining,
            unitCost,
            source: 'Reconciliation',
          };
          if (!state.fifo.lots.has(itemId)) state.fifo.lots.set(itemId, []);
          state.fifo.lots.get(itemId).push(lot);
          state.fifo.newLots.push(lot);
          unitsCreated += remaining;
        }
      } else {
        // FIFO over-counts: deplete oldest lots down to trueNet
        fifoOut(String(itemId), Math.abs(diff), state);
        unitsDepleted += Math.abs(diff);
      }
    }

    return { itemsAffected, unitsCreated, unitsDepleted };
  };
}

module.exports = { createFifoReconciler };
