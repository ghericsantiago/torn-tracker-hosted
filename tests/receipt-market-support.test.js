const test = require('node:test');
const assert = require('node:assert/strict');
const { selectFrequentMarketSupport } = require('../routes/receipt-market-support');

function observation(price, hour, itemId = 1) {
  return {
    item_id: itemId,
    price,
    tracked_date: '2026-08-25',
    created_at: `2026-08-25T${String(hour).padStart(2, '0')}:00:00Z`,
  };
}

test('groups prices within one percent and uses the winning group median', () => {
  const rows = [
    observation(99.4, 1), observation(99.8, 2), observation(100, 3),
    observation(100.3, 4), observation(104, 5), observation(104, 6),
  ];
  const support = selectFrequentMarketSupport(rows).get(1);
  assert.equal(support.sample_count, 4);
  assert.equal(support.price, 99.9);
});

test('uses fixed anchors so nearby steps cannot chain into one wide group', () => {
  const rows = [observation(100, 1), observation(100.9, 2), observation(101.8, 3)];
  const support = selectFrequentMarketSupport(rows).get(1);
  assert.equal(support.sample_count, 2);
  assert.equal(support.price, 100.45);
});

test('breaks equal-count ties by most recent observation then lower median', () => {
  const recentWinner = selectFrequentMarketSupport([
    observation(100, 1), observation(100.5, 2),
    observation(110, 3), observation(110.5, 4),
  ]).get(1);
  assert.equal(recentWinner.price, 110.25);

  const lowerWinner = selectFrequentMarketSupport([
    observation(100, 1), observation(100.5, 4),
    observation(110, 2), observation(110.5, 4),
  ]).get(1);
  assert.equal(lowerWinner.price, 100.25);
});
