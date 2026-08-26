const DENSE_BAND_MARGIN_PCT = 1;
const DENSE_BAND_MIN_SHARE = 0.05;
const DENSE_BAND_MIN_SAMPLES = 3;

function selectDailyResaleCeiling(rows) {
  const byItem = new Map();
  for (const row of rows) {
    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const itemRows = byItem.get(row.item_id) || [];
    itemRows.push({ ...row, numericPrice: price });
    byItem.set(row.item_id, itemRows);
  }

  const selected = new Map();
  for (const [itemId, itemRows] of byItem) {
    itemRows.sort((a, b) => a.numericPrice - b.numericPrice ||
      new Date(a.created_at) - new Date(b.created_at));
    const groups = [];
    for (const row of itemRows) {
      let group = groups[groups.length - 1];
      if (!group || row.numericPrice > group.anchorPrice * (1 + DENSE_BAND_MARGIN_PCT / 100)) {
        group = { anchorPrice: row.numericPrice, rows: [] };
        groups.push(group);
      }
      group.rows.push(row);
    }

    const ranked = groups.map(group => {
      const prices = group.rows.map(row => row.numericPrice).sort((a, b) => a - b);
      const middle = Math.floor(prices.length / 2);
      return {
        ...group,
        medianPrice: prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2,
        lastObservedAt: group.rows.reduce((latest, row) =>
          new Date(row.created_at) > new Date(latest) ? row.created_at : latest,
        group.rows[0].created_at),
      };
    });
    const minimumSamples = Math.max(DENSE_BAND_MIN_SAMPLES,
      Math.ceil(itemRows.length * DENSE_BAND_MIN_SHARE));
    const qualifying = ranked.filter(group => group.rows.length >= minimumSamples);
    const candidates = qualifying.length ? qualifying : ranked
      .filter(group => group.rows.length === Math.max(...ranked.map(candidate => candidate.rows.length)));
    const winner = candidates.sort((a, b) => b.medianPrice - a.medianPrice ||
      new Date(b.lastObservedAt) - new Date(a.lastObservedAt))[0];

    selected.set(itemId, {
      item_id: itemId,
      price: winner.medianPrice,
      tracked_date: winner.rows[0].tracked_date,
      sample_count: winner.rows.length,
      observation_count: itemRows.length,
      minimum_dense_samples: minimumSamples,
      band_low_price: winner.anchorPrice,
      band_high_price: winner.anchorPrice * (1 + DENSE_BAND_MARGIN_PCT / 100),
      last_observed_at: winner.lastObservedAt,
    });
  }
  return selected;
}

module.exports = {
  DENSE_BAND_MARGIN_PCT,
  DENSE_BAND_MIN_SHARE,
  DENSE_BAND_MIN_SAMPLES,
  selectDailyResaleCeiling,
};
