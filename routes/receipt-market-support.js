const SUPPORT_MARGIN_PCT = 1;

function selectFrequentMarketSupport(rows, marginPct = SUPPORT_MARGIN_PCT) {
  const byItem = new Map();
  for (const row of rows) {
    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const itemRows = byItem.get(row.item_id) || [];
    itemRows.push({ ...row, numericPrice: price });
    byItem.set(row.item_id, itemRows);
  }

  const selected = new Map();
  const marginRate = Math.max(0, Number(marginPct) || 0) / 100;

  for (const [itemId, itemRows] of byItem) {
    itemRows.sort((a, b) => a.numericPrice - b.numericPrice ||
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const groups = [];
    for (const row of itemRows) {
      let group = groups[groups.length - 1];
      if (!group || row.numericPrice > group.anchorPrice * (1 + marginRate)) {
        group = { anchorPrice: row.numericPrice, rows: [] };
        groups.push(group);
      }
      group.rows.push(row);
    }

    const ranked = groups.map(group => {
      const prices = group.rows.map(row => row.numericPrice).sort((a, b) => a - b);
      const middle = Math.floor(prices.length / 2);
      const medianPrice = prices.length % 2
        ? prices[middle]
        : (prices[middle - 1] + prices[middle]) / 2;
      const lastObserved = group.rows.reduce((latest, row) => {
        const timestamp = new Date(row.created_at).getTime();
        return timestamp > latest.timestamp ? { value: row.created_at, timestamp } : latest;
      }, { value: null, timestamp: -Infinity });
      return { ...group, medianPrice, lastObservedAt: lastObserved.value };
    }).sort((a, b) => b.rows.length - a.rows.length ||
      new Date(b.lastObservedAt).getTime() - new Date(a.lastObservedAt).getTime() ||
      a.medianPrice - b.medianPrice);

    const winner = ranked[0];
    selected.set(itemId, {
      item_id: itemId,
      price: winner.medianPrice,
      tracked_date: winner.rows[0].tracked_date,
      sample_count: winner.rows.length,
      last_observed_at: winner.lastObservedAt,
    });
  }

  return selected;
}

module.exports = { SUPPORT_MARGIN_PCT, selectFrequentMarketSupport };
