'use strict';

/**
 * Trade event extraction + grouping helpers (ITEM_TRACKING.md §5).
 */

const C = require('../constants');

function createTrade({ catalog }) {
  // Trade sub-log (4430 anchor / 4440-4441 money / 4445-4446 items / 4450-4451 property)
  // → contribution to a completed trade group. Returns null for non-trade logs.
  function logTradeEvent(log) {
    const d       = log.data || {};
    const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
    if (!C.TRADE_SUB_LOG_TYPES.has(logType)) return null;
    const tradeId = d.parsed_trade_id != null ? String(d.parsed_trade_id) : (log.id != null ? String(log.id) : null);
    if (!tradeId) return null;
    const ev = {
      tradeId,
      ts: (log.timestamp || 0) * 1000,
      counterpartId: d.user != null ? Number(d.user) : (d.id != null ? Number(d.id) : null),
    };
    if (logType === 4440)      { ev.dir = 'out'; ev.money = Number(d.money) || 0; }
    else if (logType === 4441) { ev.dir = 'in';  ev.money = Number(d.money) || 0; }
    else if (logType === 4445) { ev.dir = 'out'; ev.items = (d.items || []).filter(i => i && i.id != null).map(i => ({ itemId: String(i.id), name: catalog.itemName(i.id), value: catalog.itemValue(i.id), qty: i.qty || 1 })); }
    else if (logType === 4446) { ev.dir = 'in';  ev.items = (d.items || []).filter(i => i && i.id != null).map(i => ({ itemId: String(i.id), name: catalog.itemName(i.id), value: catalog.itemValue(i.id), qty: i.qty || 1 })); }
    else if (logType === 4450) { ev.dir = 'out'; ev.properties = 1; }
    else if (logType === 4451) { ev.dir = 'in';  ev.properties = 1; }
    return ev;   // 4430 anchor: group creation only
  }

  // Merge new trade items into a side's item list (sum qty per itemId).
  function mergeTradeItems(list, items) {
    items.forEach(i => {
      const ex = list.find(x => x.itemId === i.itemId);
      if (ex) { ex.qty += i.qty; if (i.value && !ex.value) ex.value = i.value; }
      else list.push({ itemId: i.itemId, name: i.name, value: i.value, qty: i.qty });
    });
  }

  return { logTradeEvent, mergeTradeItems };
}

module.exports = { createTrade };
