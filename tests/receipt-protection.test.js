const test = require('node:test');
const assert = require('node:assert/strict');
const { applyMarketDropProtection } = require('../routes/receipt-protection');

function percentageItem(protectionEnabled) {
  return {
    torn_item_id: 274,
    quantity: 2,
    price_mode: 'market_pct',
    market_price: 100,
    market_reference_price: 70,
    resolved_pct: 0.8,
    effective_price: 80,
    effective_total: 160,
    market_protection_enabled: protectionEnabled,
    market_protection_applied: false,
  };
}

test('enabled protection reduces a percentage offer from the resale ceiling', () => {
  const [item] = applyMarketDropProtection([percentageItem(true)]);
  assert.equal(item.market_protection_applied, true);
  assert.equal(item.effective_price, 56);
  assert.equal(item.effective_total, 112);
});

test('disabled protection leaves normal percentage pricing unchanged', () => {
  const original = percentageItem(false);
  const [item] = applyMarketDropProtection([original]);
  assert.equal(item, original);
  assert.equal(item.market_protection_applied, false);
  assert.equal(item.effective_price, 80);
});
