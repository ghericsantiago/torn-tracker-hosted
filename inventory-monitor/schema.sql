-- ═══════════════════════════════════════════════════════════════
-- Torn Inventory Monitor — PostgreSQL schema (v1)
--
-- Logs from api.torn.com remain the source of truth; this database
-- stores the DERIVED monitor state (aggregated flows, ledger,
-- dedupe buffer, recent activity).
--
-- Applied automatically by server.js at startup (idempotent), and
-- documented in INVENTORY_MONITOR.md §3/§8.
-- ═══════════════════════════════════════════════════════════════

-- 1. Monitor metadata — single row (id = 1)
CREATE TABLE IF NOT EXISTS monitor_meta (
  id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  start_ts       bigint  NOT NULL,            -- monitor start (unix seconds)
  last_ts        bigint,                      -- highest processed log timestamp (unix seconds)
  poll_last_ts   bigint,                      -- last poll wall-clock (unix ms)
  poll_ok        boolean,
  poll_msg       text,
  poll_processed integer,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- 2. Dedupe buffer — log ids already applied (pruned to newest 5000)
CREATE TABLE IF NOT EXISTS processed_logs (
  log_id       text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Per-item aggregates — current = baseline (zero) + IN − OUT
CREATE TABLE IF NOT EXISTS item_totals (
  item_id    text PRIMARY KEY,
  name       text   NOT NULL,
  value      bigint NOT NULL DEFAULT 0,       -- market price at last resolve
  in_qty     bigint NOT NULL DEFAULT 0,
  out_qty    bigint NOT NULL DEFAULT 0,
  last_ts    bigint NOT NULL DEFAULT 0,       -- ms of last flow
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Per-source breakdown per item (split by direction so the IN/OUT tables
--    only show the sources that actually contributed to each side)
CREATE TABLE IF NOT EXISTS item_sources (
  item_id text   NOT NULL REFERENCES item_totals(item_id) ON DELETE CASCADE,
  source  text   NOT NULL,
  dir     text   NOT NULL CHECK (dir IN ('in', 'out')),
  qty     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, source, dir)
);

-- NOTE: databases created before the `dir` column existed are migrated in
-- server.js at startup (item_sources is derived data, safe to rebuild).

-- 5. Recent activity feed (pruned to newest 500)
CREATE TABLE IF NOT EXISTS activity (
  id         bigserial PRIMARY KEY,
  ts         bigint  NOT NULL,                -- unix ms
  log_id     text,
  log_type   integer,
  title      text,
  category   text    NOT NULL DEFAULT '',     -- Torn log category (e.g. Trades, Item Market)
  dir        text    NOT NULL CHECK (dir IN ('in', 'out')),
  item_id    text    NOT NULL,
  item_name  text,
  qty        bigint  NOT NULL,
  source     text    NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity (ts DESC, id DESC);

-- Location-ledger events — per-item history for the Bazaar/Display/Market tab popups.
-- Kept separately from the shared activity feed (which is capped at activityMax) so old
-- bazaar/display/market events are never trimmed away by unrelated activity.
CREATE TABLE IF NOT EXISTS location_events (
  id         bigserial PRIMARY KEY,
  ts         bigint  NOT NULL,                -- unix ms
  scope      text    NOT NULL CHECK (scope IN ('bazaar', 'display', 'market')),
  kind       text    NOT NULL CHECK (kind IN ('Added', 'Sold', 'Removed')),
  item_id    text    NOT NULL,
  qty        bigint  NOT NULL,
  log_id     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_location_events_lookup ON location_events (scope, item_id, kind, ts DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_location_events_ts ON location_events (ts DESC, id DESC);

-- 6. Bazaar stock ledger — separate from the player inventory.
--    IN = Bazaar add (1210/1222) · OUT = Bazaar sell (1221/1226) + remove (1211/1223)
CREATE TABLE IF NOT EXISTS bazaar_totals (
  item_id     text PRIMARY KEY,
  name        text   NOT NULL,
  value       bigint NOT NULL DEFAULT 0,
  in_qty      bigint NOT NULL DEFAULT 0,      -- added to bazaar
  sold_qty    bigint NOT NULL DEFAULT 0,      -- sold from bazaar
  removed_qty bigint NOT NULL DEFAULT 0,      -- removed from bazaar
  last_ts     bigint NOT NULL DEFAULT 0,      -- ms of last flow
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 7. Bazaar aggregate — single row (id = 1)
CREATE TABLE IF NOT EXISTS bazaar_meta (
  id         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  revenue    bigint NOT NULL DEFAULT 0,       -- total $ received from bazaar sells
  units_sold bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 8. Display Case stock ledger — separate from inventory & bazaar.
--    IN = Display add (1300/1302) · OUT = Display remove (1301/1303)
CREATE TABLE IF NOT EXISTS display_totals (
  item_id     text PRIMARY KEY,
  name        text   NOT NULL,
  value       bigint NOT NULL DEFAULT 0,
  in_qty      bigint NOT NULL DEFAULT 0,      -- placed on display
  removed_qty bigint NOT NULL DEFAULT 0,      -- taken off display
  last_ts     bigint NOT NULL DEFAULT 0,      -- ms of last flow
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 9. Item transfers between locations (Inventory ↔ Bazaar ↔ Display, Bazaar → Sold)
CREATE TABLE IF NOT EXISTS transfers (
  id         bigserial PRIMARY KEY,
  ts         bigint  NOT NULL,                -- unix ms
  log_id     text,
  log_type   integer,
  title      text,
  item_id    text    NOT NULL,
  item_name  text,
  qty        bigint  NOT NULL,
  from_loc   text    NOT NULL,
  to_loc     text    NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transfers_ts ON transfers (ts DESC, id DESC);

-- 10. Item Market listing ledger — separate from inventory, bazaar & display.
--     IN = Item market add (1100/1110) · OUT = sell (1104/1113) + remove (1101/1111)
CREATE TABLE IF NOT EXISTS market_totals (
  item_id     text PRIMARY KEY,
  name        text   NOT NULL,
  value       bigint NOT NULL DEFAULT 0,
  in_qty      bigint NOT NULL DEFAULT 0,      -- listed on the item market
  sold_qty    bigint NOT NULL DEFAULT 0,      -- sold from a listing
  removed_qty bigint NOT NULL DEFAULT 0,      -- listing removed back to inventory
  last_ts     bigint NOT NULL DEFAULT 0,      -- ms of last flow
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 11. Item Market aggregate — single row (id = 1)
CREATE TABLE IF NOT EXISTS market_meta (
  id         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  revenue    bigint NOT NULL DEFAULT 0,       -- total $ from market sales (net of market tax)
  units_sold bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 12. Trade events — one row per completed trade, grouped by parsed_trade_id.
--     Sides: gave = money (4440) + items (4445) + properties (4450);
--            received = money (4441) + items (4446) + properties (4451)
CREATE TABLE IF NOT EXISTS trade_events (
  id             bigserial PRIMARY KEY,
  ts             bigint  NOT NULL,                -- unix ms (latest sub-log)
  trade_id       text,
  counterpart_id bigint,                          -- other player
  gave_json      text    NOT NULL,                -- {money, items:[{itemId,name,qty,value}], properties}
  received_json  text    NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trade_events_ts ON trade_events (ts DESC, id DESC);

-- 13. Museum exchange rewards (7000) — museum points earned per swap
CREATE TABLE IF NOT EXISTS museum_swaps (
  id              bigserial PRIMARY KEY,
  ts              bigint  NOT NULL,             -- unix ms
  log_id          text,
  set_name        text    NOT NULL,
  quantity        bigint  NOT NULL DEFAULT 1,   -- sets converted
  points_received bigint  NOT NULL DEFAULT 0,   -- museum points earned
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_museum_swaps_ts ON museum_swaps (ts DESC, id DESC);

-- 14. Museum aggregate — single row (id = 1)
CREATE TABLE IF NOT EXISTS museum_meta (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  points_received bigint NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 15. Manual adjustments (reconciliation layer) — separate from log-derived flows.
--     Applied on top of the ledger in summary() + the item-events popups; never
--     written into item_totals/item_sources (so restarts can't double-count them).
CREATE TABLE IF NOT EXISTS manual_adjustments (
  id         serial  PRIMARY KEY,
  ts         bigint  NOT NULL,             -- unix ms
  item_id    text    NOT NULL,
  scope      text    NOT NULL DEFAULT 'inventory' CHECK (scope IN ('inventory','bazaar','display','market')),
  dir        text    NOT NULL CHECK (dir IN ('in', 'out')),
  qty        bigint  NOT NULL CHECK (qty > 0),
  label      text    NOT NULL DEFAULT 'Manual',
  note       text    NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manual_adj_ts ON manual_adjustments (ts DESC, id DESC);
