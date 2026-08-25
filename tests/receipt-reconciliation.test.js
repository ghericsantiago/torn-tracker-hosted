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
    if (queries.length === 1) return { rows: [{ id: 'pending-id', trade_id: '50' }] };
    return queries.length === 2
      ? { rows: [{ id: 'cancelled-id', trade_id: '100' }] }
      : { rows: [{ id: 'completed-id', trade_id: '200' }] };
  };
  try {
    const result = await reconcileReceiptStatuses();
    assert.deepEqual(result.pending.map(row => row.trade_id), ['50']);
    assert.deepEqual(result.cancelled.map(row => row.trade_id), ['100']);
    assert.deepEqual(result.completed.map(row => row.trade_id), ['200']);
    assert.match(queries[0], /status<>'pending'/);
    assert.match(queries[0], /created_at >= NOW\(\) - INTERVAL '10 minutes'/);
    assert.match(queries[1], /status<>'cancelled'/);
    assert.match(queries[1], /INTERVAL '10 minutes'/);
    assert.match(queries[1], /NOT EXISTS/);
    assert.match(queries[2], /status<>'completed'/);
    assert.match(queries[2], /EXISTS/);
  } finally {
    db.query = originalQuery;
  }
});
