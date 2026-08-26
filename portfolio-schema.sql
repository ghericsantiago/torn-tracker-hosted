-- Portfolio tracker schema
-- Run as superuser for the ALTER TABLE lines (torn_user doesn't own torn_items):
--   sudo -u postgres psql -d torn_tracker -f portfolio-schema.sql
-- All other statements can run as torn_user.

-- ─── torn_items additions ──────────────────────────────────────────────────
ALTER TABLE torn_items ADD COLUMN IF NOT EXISTS market_price BIGINT;
ALTER TABLE torn_items ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();

-- ─── Raw event log (append-only; one row per Torn API log entry) ───────────
CREATE TABLE IF NOT EXISTS torn_logs (
  id          TEXT        PRIMARY KEY,   -- Torn API entry.id (unique string)
  log_type    INT         NOT NULL,
  happened_at TIMESTAMPTZ NOT NULL,
  data        JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_torn_logs_happened ON torn_logs (happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_torn_logs_type     ON torn_logs (log_type);

-- ─── FIFO cost lots (one row per acquisition event) ───────────────────────
CREATE TABLE IF NOT EXISTS torn_lots (
  id            SERIAL      PRIMARY KEY,
  item_id       INT         NOT NULL,
  acquired_log  TEXT,                           -- torn_logs.id; NULL for synthetic pre-tracking lots
  acquired_at   TIMESTAMPTZ NOT NULL,        -- controls FIFO order
  qty_original  INT         NOT NULL,
  qty_remaining INT         NOT NULL,
  unit_cost     NUMERIC     NOT NULL DEFAULT 0, -- 0 for free items
  source        TEXT        NOT NULL,         -- 'buy' | 'received' | 'trade_in' | 'pre_tracking'
  UNIQUE (acquired_log, item_id)              -- one lot per (log, item); NULLs are distinct per row
);
CREATE INDEX IF NOT EXISTS idx_torn_lots_item    ON torn_lots (item_id, acquired_at ASC);
CREATE INDEX IF NOT EXISTS idx_torn_lots_avail   ON torn_lots (item_id) WHERE qty_remaining > 0;

-- ─── Lot consumption events (realized P&L) ────────────────────────────────
CREATE TABLE IF NOT EXISTS torn_lot_events (
  id           SERIAL      PRIMARY KEY,
  lot_id       INT         NOT NULL REFERENCES torn_lots(id),
  log_id       TEXT,                          -- torn_logs.id that triggered consumption
  happened_at  TIMESTAMPTZ NOT NULL,
  qty          INT         NOT NULL,
  unit_revenue NUMERIC     NOT NULL DEFAULT 0, -- after-tax revenue per unit; 0 for non-sell
  pnl          NUMERIC     NOT NULL,           -- (unit_revenue - unit_cost) * qty
  reason       TEXT        NOT NULL,           -- 'sell' | 'use' | 'dump' | 'send' | 'trade_out'
  UNIQUE (lot_id, log_id)                     -- idempotency: one event per (lot, log entry)
);
CREATE INDEX IF NOT EXISTS idx_torn_lot_events_lot  ON torn_lot_events (lot_id);
CREATE INDEX IF NOT EXISTS idx_torn_lot_events_time ON torn_lot_events (happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_torn_lot_events_sell ON torn_lot_events (happened_at DESC) WHERE reason = 'sell';

-- ─── Inventory snapshots (periodic; used to verify lot qty vs reality) ─────
CREATE TABLE IF NOT EXISTS torn_inventory_snapshots (
  id         SERIAL      PRIMARY KEY,
  taken_at   TIMESTAMPTZ DEFAULT NOW(),
  item_id    INT,
  location   TEXT,        -- 'inventory' | 'bazaar' | 'display'
  qty        INT,
  list_price BIGINT       -- bazaar listing price per unit, null otherwise
);
CREATE INDEX IF NOT EXISTS idx_torn_inv_taken ON torn_inventory_snapshots (taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_torn_inv_item  ON torn_inventory_snapshots (item_id);

-- ─── Sync cursor state ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS torn_sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- Keys used:
--   last_log_ts        — newest torn_logs.happened_at processed by syncLogs
--   last_lot_ts        — newest torn_logs.happened_at processed by lot processor
--   last_snapshot_ts   — unix ts of last inventory snapshot
--   last_sync_ts       — unix ts of last full runSync() completion
--   backfill_cursor    — pagination URL for in-progress log backfill
--   backfill_max_ts    — highest ts seen during current backfill run

-- ─── Permissions ──────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON torn_logs               TO torn_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON torn_lots               TO torn_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON torn_lot_events         TO torn_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON torn_inventory_snapshots TO torn_user;
GRANT SELECT, INSERT, UPDATE         ON torn_sync_state         TO torn_user;
GRANT USAGE, SELECT ON SEQUENCE torn_lots_id_seq                TO torn_user;
GRANT USAGE, SELECT ON SEQUENCE torn_lot_events_id_seq          TO torn_user;
GRANT USAGE, SELECT ON SEQUENCE torn_inventory_snapshots_id_seq TO torn_user;
