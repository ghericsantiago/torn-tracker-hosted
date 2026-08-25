'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { reconcileReceiptStatuses } = require('../services/receipt-reconciliation');

test('reconciliation enforces cancelled without a trade and completed with a trade regardless of current status', async () => {
  const originalQuery = db.query;
  const queries = [];
  db.query = async sql => {
    queries.push(sql);
    return queries.length === 1
      ? { rows: [{ id: 'cancelled-id', trade_id: '100' }] }
      : { rows: [{ id: 'completed-id', trade_id: '200' }] };
  };
  try {
    const result = await reconcileReceiptStatuses();
    assert.deepEqual(result.cancelled.map(row => row.trade_id), ['100']);
    assert.deepEqual(result.completed.map(row => row.trade_id), ['200']);
    assert.match(queries[0], /status<>'cancelled'/);
    assert.match(queries[0], /INTERVAL '10 minutes'/);
    assert.match(queries[0], /NOT EXISTS/);
    assert.match(queries[1], /status<>'completed'/);
    assert.match(queries[1], /EXISTS/);
  } finally {
    db.query = originalQuery;
  }
});
