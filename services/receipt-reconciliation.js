'use strict';

const db = require('../db');

async function reconcileReceiptStatuses() {
  const cancelled = await db.query(
    `UPDATE trade_receipts receipt
     SET status='cancelled', completed_at=NULL, auto_cancelled=TRUE
     WHERE receipt.status='pending'
       AND NOT EXISTS (
         SELECT 1 FROM trade_events completed_trade
         WHERE completed_trade.trade_id=receipt.trade_id::text
     )
     RETURNING receipt.id, receipt.trade_id`
  );
  const completed = await db.query(
    `UPDATE trade_receipts receipt
     SET status='completed', completed_at=COALESCE(receipt.completed_at,NOW()), auto_cancelled=FALSE
     WHERE (receipt.status='pending' OR (receipt.status='cancelled' AND receipt.auto_cancelled=TRUE))
       AND EXISTS (
         SELECT 1 FROM trade_events completed_trade
         WHERE completed_trade.trade_id=receipt.trade_id::text
       )
     RETURNING receipt.id, receipt.trade_id`
  );
  return { cancelled: cancelled.rows, completed: completed.rows };
}

module.exports = { reconcileReceiptStatuses };
