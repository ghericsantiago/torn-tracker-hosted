function applyMarketDropProtection(items) {
  return items.map(item => {
    const marketValue = Number(item.market_price) || 0;
    const lowestOffer = Number(item.market_reference_price) || 0;
    const buyRate = Number(item.resolved_pct) || 0;
    const currentOffer = Number(item.effective_price) || 0;
    if (item.market_protection_enabled === false || item.price_mode !== 'market_pct' ||
        marketValue <= 0 || lowestOffer <= 0 || buyRate <= 0) return item;
    const dropPct = ((marketValue - lowestOffer) / marketValue) * 100;
    if (dropPct <= 0) return item;
    const protectedOffer = Math.round(lowestOffer * buyRate);
    if (protectedOffer >= currentOffer) return item;
    return {
      ...item,
      effective_price: protectedOffer,
      effective_total: protectedOffer * item.quantity,
      market_protection_applied: true,
      market_drop_pct: dropPct,
      market_protection_threshold_pct: null,
      unprotected_price: currentOffer,
      protection_lowest_price: lowestOffer,
      protection_market_value: marketValue,
    };
  });
}

module.exports = { applyMarketDropProtection };
