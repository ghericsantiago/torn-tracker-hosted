-- Trade receipt token on profile
ALTER TABLE trade_profiles
  ADD COLUMN IF NOT EXISTS receipt_token UUID DEFAULT gen_random_uuid();

-- Existing profiles can still be NULL when the column came from an older
-- partial migration. Backfill them and keep future rows populated.
ALTER TABLE trade_profiles
  ALTER COLUMN receipt_token SET DEFAULT gen_random_uuid();
UPDATE trade_profiles SET receipt_token = gen_random_uuid() WHERE receipt_token IS NULL;
ALTER TABLE trade_profiles
  ALTER COLUMN receipt_token SET NOT NULL;

-- Trade receipts table
CREATE TABLE IF NOT EXISTS trade_receipts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id     VARCHAR(16),
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

-- Upgrade databases whose receipt table predates public short links.
ALTER TABLE trade_receipts ADD COLUMN IF NOT EXISTS short_id VARCHAR(16);
CREATE UNIQUE INDEX IF NOT EXISTS trade_receipts_short_id_idx
  ON trade_receipts (short_id) WHERE short_id IS NOT NULL;
