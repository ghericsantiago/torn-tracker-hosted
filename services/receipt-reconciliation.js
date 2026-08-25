'use strict';

const db = require('../db');

const DEFAULT_GRACE_HOURS = 24;

function graceHours() {
  const configured = Number(process.env.RECEIPT_ORPHAN_GRACE_HOURS);
  return Number.isFinite(configured) && configured >= 1 ? configured : DEFAULT_GRACE_HOURS;
}

async function cancelUnmatchedPendingReceipts() {
  const { rows } = await db.query(
    `UPDATE trade_receipts receipt
     SET status='cancelled', completed_at=NULL
     WHERE receipt.status='pending'
       AND receipt.created_at < NOW() - ($1::text || ' hours')::interval
       AND NOT EXISTS (
         SELECT 1 FROM trade_events completed_trade
         WHERE completed_trade.trade_id=receipt.trade_id::text
       )
     RETURNING receipt.id, receipt.trade_id`,
    [String(graceHours())]
  );
  return rows;
}

module.exports = { cancelUnmatchedPendingReceipts, graceHours };
