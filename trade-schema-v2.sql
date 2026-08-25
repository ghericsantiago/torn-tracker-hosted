-- Trade listing v2 migration — 3-level price cascade
-- Run: psql -U torn_user -d torn_tracker -f trade-schema-v2.sql

-- Global default price on the profile
ALTER TABLE trade_profiles ADD COLUMN IF NOT EXISTS default_market_pct DECIMAL(5,4);
ALTER TABLE trade_profiles ADD COLUMN IF NOT EXISTS category_order JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE trade_profiles ADD COLUMN IF NOT EXISTS market_protection_enabled BOOLEAN NOT NULL DEFAULT true;

-- Per-category price overrides
CREATE TABLE IF NOT EXISTS trade_category_configs (
  id         SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL DEFAULT 1 REFERENCES trade_profiles(id) ON DELETE CASCADE,
  item_type  VARCHAR(128) NOT NULL,
  market_pct DECIMAL(5,4),
  market_protection_enabled BOOLEAN,
  UNIQUE(profile_id, item_type)
);

-- Upgrade category/listing tables created before protection overrides.
ALTER TABLE trade_category_configs ALTER COLUMN market_pct DROP NOT NULL;
ALTER TABLE trade_category_configs ADD COLUMN IF NOT EXISTS market_protection_enabled BOOLEAN;
ALTER TABLE trade_listings ADD COLUMN IF NOT EXISTS market_protection_enabled BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_trade_cat_configs ON trade_category_configs(profile_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON trade_category_configs TO torn_user;
GRANT USAGE, SELECT ON SEQUENCE trade_category_configs_id_seq TO torn_user;
