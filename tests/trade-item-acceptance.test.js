'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAcceptancePricing } = require('../services/trade-item-acceptance');

test('unaccepted items are priced at zero regardless of their catalog offer', () => {
  assert.deepEqual(resolveAcceptancePricing(125000, 3, false), {
    not_accepted: true,
    effective_price: 0,
    effective_total: 0,
  });
});

test('accepted items retain the catalog price and quantity total', () => {
  assert.deepEqual(resolveAcceptancePricing(125000, 3, true), {
    not_accepted: false,
    effective_price: 125000,
    effective_total: 375000,
  });
});

test('accepted items with no price remain unpriced', () => {
  assert.deepEqual(resolveAcceptancePricing(null, 3, true), {
    not_accepted: false,
    effective_price: null,
    effective_total: null,
  });
});

test('accepted items with an undefined price normalize to unpriced', () => {
  assert.deepEqual(resolveAcceptancePricing(undefined, 1, true), {
    not_accepted: false,
    effective_price: null,
    effective_total: null,
  });
});