CREATE TABLE IF NOT EXISTS monitored_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  torn_item_id    INTEGER NOT NULL UNIQUE,
  name            TEXT,
  api_key         TEXT NOT NULL,
  is_active       INTEGER DEFAULT 1,
  retry_count     INTEGER DEFAULT 0,
  last_sync       TEXT,
  last_error      TEXT,
  last_error_date TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS item_market (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL,
  name          TEXT,
  type          TEXT,
  price         REAL,
  average_price REAL,
  quantity      INTEGER,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_item_market_item_id ON item_market(item_id);
CREATE INDEX IF NOT EXISTS idx_item_market_created  ON item_market(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS torn_items (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT
);

CREATE INDEX IF NOT EXISTS idx_torn_items_name ON torn_items(name);
