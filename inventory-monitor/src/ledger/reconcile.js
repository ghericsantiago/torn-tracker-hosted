'use strict';

/**
 * FIFO reconciliation — ensures that the FIFO remaining total for every item
 * matches the true inventory net (log ledger + manual inventory adjustments).
 *
 * Gaps are closed automatically:
 *   gap > 0 (FIFO under-counts) → create a "Reconciliation" lot priced at the last
 *                                  known purchase price for that item (falls back to $0
 *                                  if no buy history exists in state.fifo.lastKnownCost)
 *   gap < 0 (FIFO over-counts)  → fifoOut to deplete the oldest lots
 *
 * Called after every poll cycle (silent) and via POST /api/fifo/reconcile (on demand).
 */

const { fifoOut } = require('./fifo');

function createFifoReconciler({ catalog }) {
  return function reconcileFifo(state) {
    // Build per-item inventory-scope manual adjustment totals
    const adjNet = {};
    for (const a of state.adjustments) {
      if (!a.scope || a.scope === 'inventory') {
        adjNet[a.itemId] = (adjNet[a.itemId] || 0) + (a.dir === 'in' ? a.qty : -a.qty);
      }
    }

    let itemsAffected = 0, unitsCreated = 0, unitsDepleted = 0;

    for (const [itemId, item] of Object.entries(state.items)) {
      // trueNet is the quantity we expect the FIFO system to account for
      const trueNet   = Math.max(0, item.net + (adjNet[itemId] || 0));
      const lots      = state.fifo.lots.get(itemId) || [];
      const fifoTotal = lots.reduce((s, l) => s + l.remaining, 0);
      const diff      = trueNet - fifoTotal;

      if (diff === 0) continue;
      itemsAffected++;

      if (diff > 0) {
        // FIFO under-counts: insert a Reconciliation lot priced at the last known
        // purchase price for this item so the avg cost stays accurate.
        const unitCost = state.fifo.lastKnownCost.get(String(itemId)) || 0;
        const lot = {
          id:       null,   // filled by persist after INSERT RETURNING id
          ts:       Date.now(),
          logId:    null,
          itemId:   String(itemId),
          itemName: catalog.itemName(itemId) || String(itemId),
          category: catalog.itemCategory(itemId) || '',
          totalQty: diff,
          remaining: diff,
          unitCost,
          source:   'Reconciliation',
        };
        if (!state.fifo.lots.has(itemId)) state.fifo.lots.set(itemId, []);
        state.fifo.lots.get(itemId).push(lot);
        state.fifo.newLots.push(lot);
        unitsCreated += diff;
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
