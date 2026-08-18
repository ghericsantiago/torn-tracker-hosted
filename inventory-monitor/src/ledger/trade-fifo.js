'use strict';

/**
 * Trade FIFO + transaction finalization.
 *
 * Called once per poll batch AFTER all sub-logs have been applied to state,
 * so the complete trade group (anchor 4430 + money 4440/4441 + items 4445/4446)
 * is available before allocation math runs.
 *
 * For each trade not yet finalized:
 *  - Creates FIFO lots for received items (cost = proportional share of money paid)
 *  - Depletes FIFO lots for gave items (items left ownership)
 *  - Creates transaction rows (one per gave item as sell, one per recv item as buy)
 *
 * Proportional price allocation: each item's share = (qty × marketValue) / totalWeight × totalMoney
 * Pure item swaps (no money): all prices are $0 but rows still appear in the ledger.
 */

const { fifoOut } = require('./fifo');

function createTradeFifoFinalizer({ catalog }) {
  return function finalizeNewTrades(state, processedSet) {
    for (const [tradeId, trade] of state.trades.byId) {
      const dedupKey = `trade_fifo:${tradeId}`;
      if (processedSet.has(dedupKey)) continue;

      const moneyPaid     = trade.gave.money     || 0;
      const moneyReceived = trade.received.money || 0;
      const gaveItems     = trade.gave.items     || [];
      const recvItems     = trade.received.items || [];

      const ts = trade.ts;

      // Weight-based allocation for received items (cost = share of money paid)
      const recvTotalWeight = recvItems.reduce((s, i) => {
        return s + i.qty * (Number(catalog.itemValue(i.itemId)) || 0);
      }, 0);

      for (const item of recvItems) {
        const weight    = item.qty * (Number(catalog.itemValue(item.itemId)) || 0);
        const allocated = recvTotalWeight > 0
          ? Math.round((weight / recvTotalWeight) * moneyPaid)
          : 0;
        const unitCost  = item.qty > 0 ? Math.round(allocated / item.qty) : 0;

        const lot = {
          id: null,
          ts,
          logId: null,
          itemId: String(item.itemId),
          itemName: item.name || catalog.itemName(item.itemId) || String(item.itemId),
          category: catalog.itemCategory(item.itemId) || '',
          totalQty: item.qty,
          remaining: item.qty,
          unitCost,
          source: 'Trade',
        };

        if (!state.fifo.lots.has(String(item.itemId))) state.fifo.lots.set(String(item.itemId), []);
        state.fifo.lots.get(String(item.itemId)).push(lot);
        state.fifo.newLots.push(lot);

        state.transactions.push({
          ts,
          logId: null,
          logType: 4446,
          channel: 'trade',
          side: 'buy',
          itemId: String(item.itemId),
          itemName: lot.itemName,
          category: lot.category,
          qty: item.qty,
          unitPrice: unitCost,
          totalPrice: allocated,
        });
      }

      // FIFO depletion for gave items (items left ownership)
      const gaveTotalWeight = gaveItems.reduce((s, i) => {
        return s + i.qty * (Number(catalog.itemValue(i.itemId)) || 0);
      }, 0);

      for (const item of gaveItems) {
        fifoOut(String(item.itemId), item.qty, state);

        const weight    = item.qty * (Number(catalog.itemValue(item.itemId)) || 0);
        const allocated = gaveTotalWeight > 0
          ? Math.round((weight / gaveTotalWeight) * moneyReceived)
          : 0;
        const unitPrice = item.qty > 0 ? Math.round(allocated / item.qty) : 0;

        state.transactions.push({
          ts,
          logId: null,
          logType: 4445,
          channel: 'trade',
          side: 'sell',
          itemId: String(item.itemId),
          itemName: item.name || catalog.itemName(item.itemId) || String(item.itemId),
          category: catalog.itemCategory(item.itemId) || '',
          qty: item.qty,
          unitPrice,
          totalPrice: allocated,
        });
      }

      processedSet.add(dedupKey);
      state.processedIds.push(dedupKey);
    }
  };
}

module.exports = { createTradeFifoFinalizer };
