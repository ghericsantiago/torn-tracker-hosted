-- Run once to set up the database
-- psql -U torn_user -d torn_tracker -f schema.sql

CREATE TABLE IF NOT EXISTS monitored_items (
  id              SERIAL PRIMARY KEY,
  torn_item_id    INTEGER NOT NULL UNIQUE,
  name            VARCHAR(255),
  api_key         TEXT NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  priority        INTEGER DEFAULT 4,
  retry_count     INTEGER DEFAULT 0,
  record_count    INTEGER DEFAULT 0,
  last_sync       TIMESTAMPTZ,
  last_error      TEXT,
  last_error_date TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Upgrade databases created before per-item sync priorities were introduced.
ALTER TABLE monitored_items ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 4;

CREATE TABLE IF NOT EXISTS item_market (
  id            SERIAL PRIMARY KEY,
  item_id       INTEGER NOT NULL,
  name          VARCHAR(255),
  type          VARCHAR(100),
  price         NUMERIC(15,2),
  average_price NUMERIC(15,2),
  quantity      INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_market_item_id      ON item_market(item_id);
CREATE INDEX IF NOT EXISTS idx_item_market_created       ON item_market(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_market_item_created  ON item_market(item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS torn_items (
  id   INTEGER PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_torn_items_name ON torn_items(name);
