CREATE TABLE IF NOT EXISTS trading_events (
  id bigserial PRIMARY KEY,
  source_key text NOT NULL UNIQUE,
  happened_at timestamptz NOT NULL,
  log_id text,
  trade_id text,
  log_type integer NOT NULL,
  channel text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy','sell','museum','use')),
  item_id integer NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  unit_price numeric NOT NULL DEFAULT 0,
  total_price numeric NOT NULL DEFAULT 0,
  unmatched_qty integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_trading_events_time ON trading_events(happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_events_item ON trading_events(item_id);

-- Upgrade ledgers created before Museum conversions were tracked.
ALTER TABLE trading_events DROP CONSTRAINT IF EXISTS trading_events_side_check;
ALTER TABLE trading_events ADD CONSTRAINT trading_events_side_check
  CHECK (side IN ('buy','sell','museum','use'));

CREATE TABLE IF NOT EXISTS trading_fifo_lots (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL UNIQUE REFERENCES trading_events(id) ON DELETE CASCADE,
  item_id integer NOT NULL,
  acquired_at timestamptz NOT NULL,
  qty_original integer NOT NULL,
  qty_remaining integer NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_trading_lots_fifo ON trading_fifo_lots(item_id, acquired_at, id);

CREATE TABLE IF NOT EXISTS trading_fifo_matches (
  id bigserial PRIMARY KEY,
  sale_event_id bigint NOT NULL REFERENCES trading_events(id) ON DELETE CASCADE,
  lot_id bigint NOT NULL REFERENCES trading_fifo_lots(id) ON DELETE CASCADE,
  qty integer NOT NULL,
  unit_cost numeric NOT NULL,
  unit_revenue numeric NOT NULL,
  realized_profit numeric NOT NULL,
  UNIQUE(sale_event_id, lot_id)
);
CREATE INDEX IF NOT EXISTS idx_trading_matches_sale ON trading_fifo_matches(sale_event_id);
CREATE INDEX IF NOT EXISTS idx_trading_matches_lot ON trading_fifo_matches(lot_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON trading_events, trading_fifo_lots, trading_fifo_matches TO torn_user;
GRANT USAGE, SELECT ON SEQUENCE trading_events_id_seq, trading_fifo_lots_id_seq, trading_fifo_matches_id_seq TO torn_user;
