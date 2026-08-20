-- Trade receipt token on profile
ALTER TABLE trade_profiles
  ADD COLUMN IF NOT EXISTS receipt_token UUID DEFAULT gen_random_uuid();

-- Trade receipts table
CREATE TABLE IF NOT EXISTS trade_receipts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id     BIGINT NOT NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'pending',
  buyer_id     INTEGER,
  buyer_name   VARCHAR(128),
  seller_id    INTEGER,
  seller_name  VARCHAR(128),
  items        JSONB NOT NULL DEFAULT '[]',
  total_value  BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS trade_receipts_trade_id_idx ON trade_receipts (trade_id);
