'use strict';

/**
 * State factory — the in-memory working copy of the ledger, persisted to PostgreSQL.
 * A fresh state is created per process; modules receive it by injection and only
 * touch the fields they own (ISP).
 */

function createState(startTs) {
  return {
    startTs,
    lastTs: null,          // highest processed log timestamp (seconds)
    processedIds: [],      // log ids already applied (dedupe buffer)
    items: {},             // itemId(string) → { id, name, value, in, out, net, lastTs, sourcesIn{}, sourcesOut{} }
    activity: [],          // newest first, capped at activityMax
    poll: { lastTs: 0, lastOk: null, lastMsg: '', processed: 0 },

    bazaar: {              // separate bazaar stock ledger
      items: {},           // itemId → { id, name, value, in, sold, removed, out, net, lastTs, sources{} }
      revenue: 0,          // total $ received from bazaar sells
      unitsSold: 0,
    },
    display: {             // separate display-case stock ledger
      items: {},           // itemId → { id, name, value, in, removed, net, lastTs }
    },
    market: {              // separate item-market listing ledger
      items: {},           // itemId → { id, name, value, in, sold, removed, out, net, lastTs, sources{} }
      revenue: 0,          // total $ from market sales (net of market tax)
      unitsSold: 0,
    },
    trades: {              // completed trades, grouped by parsed_trade_id
      byId: new Map(),     // tradeId → group (runtime index)
      trades: [],          // groups, newest first: { tradeId, ts, counterpartId, gave, received }
    },
    museum: {              // museum exchange rewards (7000)
      pointsReceived: 0,   // total museum points earned
      swaps: [],           // { ts, logId, set, quantity, pointsReceived }, newest first
    },
    transfers: [],         // location→location moves, newest first, capped at transferMax
    locationEvents: {      // per-scope per-item event history for the location popups
      bazaar: [],          // { ts, itemId, kind, qty }, newest first, capped at locationEventMax
      display: [],
      market: [],
    },
    adjustments: [],       // manual reconciliation records (separate layer, see manual_adjustments table)
  };
}

module.exports = { createState };
