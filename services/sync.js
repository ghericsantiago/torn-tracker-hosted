const db = require('../db');
const { fetchItemMarket, fetchPointsMarket, POINT_MARKET_ID } = require('./torn');

const MAX_RETRIES = 5;

async function syncItem(item) {
  const { id, torn_item_id, api_key } = item;
  try {
    const data = torn_item_id === POINT_MARKET_ID
      ? await fetchPointsMarket(api_key)
      : await fetchItemMarket(torn_item_id, api_key);

    // Deduplicate: skip if price unchanged since last record
    const latest = await db.query(
      'SELECT price FROM item_market WHERE item_id = $1 ORDER BY created_at DESC LIMIT 1',
      [torn_item_id]
    );
    if (latest.rows.length && Number(latest.rows[0].price) === Number(data.price)) {
      await db.query(
        'UPDATE monitored_items SET last_sync = NOW() WHERE id = $1',
        [id]
      );
      return { skipped: true };
    }

    await db.query(
      `INSERT INTO item_market (item_id, name, type, price, average_price, quantity)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [data.item_id, data.name, data.type, data.price, data.average_price, data.quantity]
    );

    // Update item name + reset error state
    await db.query(
      `UPDATE monitored_items
       SET name = $1, last_sync = NOW(), retry_count = 0, last_error = NULL, last_error_date = NULL
       WHERE id = $2`,
      [data.name, id]
    );

    return { inserted: true };
  } catch (err) {
    const newCount = (item.retry_count || 0) + 1;
    const deactivate = newCount > MAX_RETRIES;
    await db.query(
      `UPDATE monitored_items
       SET retry_count = $1, last_error = $2, last_error_date = NOW(),
           is_active = CASE WHEN $3 = 1 THEN 0 ELSE is_active END
       WHERE id = $4`,
      [newCount, err.message, deactivate ? 1 : 0, id]
    );
    return { error: err.message, deactivated: deactivate };
  }
}

async function syncAllItems() {
  const { rows } = await db.query(
    `SELECT * FROM monitored_items
     WHERE is_active = TRUE AND retry_count <= $1
     ORDER BY last_sync ASC NULLS FIRST`,
    [MAX_RETRIES]
  );

  let inserted = 0, skipped = 0, errors = 0;
  for (const item of rows) {
    const result = await syncItem(item);
    if (result.inserted) inserted++;
    else if (result.skipped) skipped++;
    else errors++;
  }

  if (rows.length > 0) {
    console.log(`[sync] ${new Date().toISOString()} — ${rows.length} items: +${inserted} inserted, ${skipped} skipped, ${errors} errors`);
  }
}

module.exports = { syncAllItems, syncItem };
