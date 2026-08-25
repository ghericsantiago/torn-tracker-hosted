const test = require('node:test');
const assert = require('node:assert/strict');
const { selectDailyResaleCeiling } = require('../routes/receipt-resale-ceiling');

function observation(price, hour, itemId = 1) {
  return {
    item_id: itemId,
    price,
    tracked_date: '2026-08-25',
    created_at: `2026-08-25T${String(hour).padStart(2, '0')}:00:00Z`,
  };
}

test('selects the highest dense one-percent band and ignores a sparse high outlier', () => {
  const ceiling = selectDailyResaleCeiling([
    observation(45000, 1), observation(45100, 2), observation(45200, 3),
    observation(49000, 4), observation(49100, 5), observation(49200, 6),
    observation(55000, 7),
  ]).get(1);
  assert.equal(ceiling.price, 49100);
  assert.equal(ceiling.sample_count, 3);
  assert.equal(ceiling.observation_count, 7);
});

test('requires five percent of daily polls once that exceeds the three-sample floor', () => {
  const rows = [];
  for (let hour = 0; hour < 100; hour++) rows.push(observation(100, hour % 24));
  for (let hour = 0; hour < 4; hour++) rows.push(observation(200, hour));
  const ceiling = selectDailyResaleCeiling(rows).get(1);
  assert.equal(ceiling.minimum_dense_samples, 6);
  assert.equal(ceiling.price, 100);
});

test('falls back to the densest band for sparse histories', () => {
  const ceilings = selectDailyResaleCeiling([
    observation(100, 1, 1), observation(100.5, 2, 1),
    observation(110, 3, 1), observation(0, 4, 1),
  ]);
  assert.equal(ceilings.get(1).price, 100.25);
  assert.equal(ceilings.get(1).sample_count, 2);
});
