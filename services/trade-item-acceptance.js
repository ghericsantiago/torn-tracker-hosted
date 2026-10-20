'use strict';

function resolveAcceptancePricing(unitPrice, quantity, isAccepted) {
  const effectivePrice = isAccepted === false ? 0 : (unitPrice ?? null);
  return {
    not_accepted: isAccepted === false,
    effective_price: effectivePrice,
    effective_total: effectivePrice == null ? null : effectivePrice * quantity,
  };
}

module.exports = { resolveAcceptancePricing };