-- Portfolio tracker schema additions
-- Run once: psql -U torn_user -d torn_tracker -f portfolio-schema.sql

ALTER TABLE torn_items ADD COLUMN IF NOT EXISTS market_price BIGINT;
ALTER TABLE torn_items ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();

-- Every buy/sell event; torn_log_id prevents duplicates on re-sync
CREATE TABLE IF NOT EXISTS torn_transactions (
  id           SERIAL PRIMARY KEY,
  torn_log_id  TEXT UNIQUE,
  happened_at  TIMESTAMPTZ,
  type         TEXT,        -- 'buy' | 'sell'
  item_id      INT,
  qty          INT,
  unit_price   NUMERIC,
  total_amount NUMERIC,
  source       TEXT         -- 'item_market' | 'bazaar' | 'npc' | 'trade' | 'points_market' | 'other'
);

CREATE INDEX IF NOT EXISTS idx_torn_tx_item_id  ON torn_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_torn_tx_happened ON torn_transactions(happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_torn_tx_type     ON torn_transactions(type);

-- Periodic snapshot of holdings across inventory, bazaar, and display case
CREATE TABLE IF NOT EXISTS torn_inventory_snapshots (
  id         SERIAL PRIMARY KEY,
  taken_at   TIMESTAMPTZ DEFAULT NOW(),
  item_id    INT,
  location   TEXT,    -- 'inventory' | 'bazaar' | 'display'
  qty        INT,
  list_price BIGINT   -- bazaar listing price per unit, null otherwise
);

CREATE INDEX IF NOT EXISTS idx_torn_inv_taken ON torn_inventory_snapshots(taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_torn_inv_item  ON torn_inventory_snapshots(item_id);

-- Sync cursor state
CREATE TABLE IF NOT EXISTS torn_sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- Keys used: 'last_log_ts', 'last_snapshot_ts', 'last_sync_ts'
