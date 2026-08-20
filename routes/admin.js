const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { syncItem } = require('../services/sync');
const { fetchAllTornItems } = require('../services/torn');
const { cleanupOldRecords } = require('../scheduler');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';

const requireAuth = require('../middleware/auth');

// Login page
router.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    const next = req.session.returnTo || '/admin/dashboard';
    delete req.session.returnTo;
    return res.redirect(next);
  }
  res.sendFile('index.html', { root: 'public/admin' });
});

// Authenticate
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const userMatch = username === ADMIN_USER;
  const passMatch = await bcrypt.compare(password, req.app.locals.adminHash);
  if (userMatch && passMatch) {
    req.session.authenticated = true;
    const next = req.session.returnTo || '/admin/dashboard';
    delete req.session.returnTo;
    return res.json({ ok: true, next });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Dashboard
router.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile('dashboard.html', { root: 'public/admin' });
});

router.get('/receipts', requireAuth, (req, res) => {
  res.sendFile('receipts.html', { root: 'public/admin' });
});

// --- Admin API (all require auth) ---

router.get('/api/receipts', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, trade_id, status, buyer_name, buyer_id, seller_name, seller_id,
              total_value, created_at, completed_at
       FROM trade_receipts ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List all items (including inactive)
router.get('/api/items', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        mi.*,
        (SELECT price FROM item_market WHERE item_id = mi.torn_item_id
         ORDER BY created_at DESC LIMIT 1) AS latest_price,
        (SELECT created_at FROM item_market WHERE item_id = mi.torn_item_id
         ORDER BY created_at DESC LIMIT 1) AS price_at,
        (SELECT COUNT(*) FROM item_market WHERE item_id = mi.torn_item_id) AS record_count
      FROM monitored_items mi
      ORDER BY mi.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add item
router.post('/api/items', requireAuth, async (req, res) => {
  const { torn_item_id, name, api_key } = req.body;
  if (!torn_item_id || !api_key) return res.status(400).json({ error: 'torn_item_id and api_key are required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO monitored_items (torn_item_id, name, api_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (torn_item_id) DO UPDATE SET name = COALESCE(EXCLUDED.name, monitored_items.name), api_key = EXCLUDED.api_key, is_active = TRUE
       RETURNING *`,
      [parseInt(torn_item_id), name ? name.trim() : null, api_key.trim()]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update item (toggle active, change api_key)
router.put('/api/items/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { is_active, api_key } = req.body;
  try {
    const updates = [];
    const params = [];
    if (is_active !== undefined) { params.push(is_active); updates.push(`is_active = $${params.length}`); }
    if (api_key)                 { params.push(api_key.trim()); updates.push(`api_key = $${params.length}`); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(id);
    const { rows } = await db.query(
      `UPDATE monitored_items SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete item
router.delete('/api/items/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM monitored_items WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual sync — always resets error state so deactivated items can retry
router.post('/api/items/:id/sync', requireAuth, async (req, res) => {
  try {
    await db.query(
      `UPDATE monitored_items SET is_active = TRUE, retry_count = 0,
       last_error = NULL, last_error_date = NULL WHERE id = $1`,
      [req.params.id]
    );
    const { rows } = await db.query('SELECT * FROM monitored_items WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    const result = await syncItem(rows[0]);
    if (result.error) return res.status(502).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settings — GET (includes item count + last sync time)
router.get('/api/settings', requireAuth, async (req, res) => {
  try {
    const [settingsRes, countRes] = await Promise.all([
      db.query('SELECT key, value FROM settings'),
      db.query('SELECT COUNT(*) AS count FROM torn_items'),
    ]);
    const out = Object.fromEntries(settingsRes.rows.map(r => [r.key, r.value]));
    out.items_count = Number(countRes.rows[0].count);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settings — PUT (upsert one or more keys)
router.put('/api/settings', requireAuth, async (req, res) => {
  const allowed = ['torn_api_key', 'retention_days'];
  const entries = allowed.filter(k => req.body[k] !== undefined).map(k => [k, String(req.body[k]).trim()]);
  if (!entries.length) return res.status(400).json({ error: 'No valid settings provided.' });
  try {
    for (const [key, value] of entries) {
      await db.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual cleanup
router.post('/api/cleanup', requireAuth, async (req, res) => {
  try {
    const deleted = await cleanupOldRecords();
    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      ['last_cleanup_at', now]
    );
    res.json({ ok: true, deleted, cleaned_at: now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync all Torn items into DB
router.post('/api/sync-items', requireAuth, async (req, res) => {
  try {
    const { rows: sRows } = await db.query(
      'SELECT value FROM settings WHERE key = $1', ['torn_api_key']
    );
    if (!sRows.length || !sRows[0].value) {
      return res.status(400).json({ error: 'No API key configured.' });
    }
    const apiKey = sRows[0].value;
    const items  = await fetchAllTornItems(apiKey);

    // Bulk upsert in batches of 200 (keeps param count manageable)
    const BATCH = 200;
    for (let i = 0; i < items.length; i += BATCH) {
      const batch  = items.slice(i, i + BATCH);
      const vals   = batch.map((_, j) => `($${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, $${j * 4 + 4})`).join(', ');
      const params = batch.flatMap(item => [item.id, item.name, item.type, item.market_price ?? null]);
      await db.query(
        `INSERT INTO torn_items (id, name, type, market_price) VALUES ${vals}
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, type = EXCLUDED.type,
           market_price = EXCLUDED.market_price, updated_at = NOW()`,
        params
      );
    }

    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      ['items_synced_at', now]
    );

    res.json({ ok: true, count: items.length, synced_at: now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Distinct item types for category filter
router.get('/api/torn-item-types', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT type FROM torn_items WHERE type IS NOT NULL ORDER BY type ASC`
    );
    res.json(rows.map(r => r.type));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Torn item search — matches name OR type, excludes already-monitored items
router.get('/api/torn-items', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const { rows } = await db.query(
      `SELECT ti.id, ti.name, ti.type FROM torn_items ti
       WHERE (LOWER(ti.name) LIKE LOWER($1) OR LOWER(ti.type) LIKE LOWER($2))
         AND NOT EXISTS (
           SELECT 1 FROM monitored_items mi WHERE mi.torn_item_id = ti.id
         )
       ORDER BY ti.name ASC LIMIT 50`,
      [`%${q}%`, `%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats
router.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const [totals, records] = await Promise.all([
      db.query(`SELECT
        SUM(CASE WHEN is_active = TRUE     THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN is_active IS NOT TRUE THEN 1 ELSE 0 END) AS inactive,
        SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) AS errors,
        MAX(last_sync) AS last_sync
        FROM monitored_items`),
      db.query('SELECT COUNT(*) AS total FROM item_market'),
    ]);
    res.json({ ...totals.rows[0], total_records: records.rows[0].total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
