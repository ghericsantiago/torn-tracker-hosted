'use strict';

const db = require('../db');

async function cancelUnmatchedPendingReceipts() {
  const { rows } = await db.query(
    `UPDATE trade_receipts receipt
     SET status='cancelled', completed_at=NULL
     WHERE receipt.status='pending'
       AND NOT EXISTS (
         SELECT 1 FROM trade_events completed_trade
         WHERE completed_trade.trade_id=receipt.trade_id::text
     )
     RETURNING receipt.id, receipt.trade_id`
  );
  return rows;
}

module.exports = { cancelUnmatchedPendingReceipts };
