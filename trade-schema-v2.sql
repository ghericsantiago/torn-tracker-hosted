-- Trade listing v2 migration — 3-level price cascade
-- Run: psql -U torn_user -d torn_tracker -f trade-schema-v2.sql

-- Global default price on the profile
ALTER TABLE trade_profiles ADD COLUMN IF NOT EXISTS default_market_pct DECIMAL(5,4);
ALTER TABLE trade_profiles ADD COLUMN IF NOT EXISTS category_order JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Per-category price overrides
CREATE TABLE IF NOT EXISTS trade_category_configs (
  id         SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL DEFAULT 1 REFERENCES trade_profiles(id) ON DELETE CASCADE,
  item_type  VARCHAR(128) NOT NULL,
  market_pct DECIMAL(5,4) NOT NULL,
  UNIQUE(profile_id, item_type)
);

CREATE INDEX IF NOT EXISTS idx_trade_cat_configs ON trade_category_configs(profile_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON trade_category_configs TO torn_user;
GRANT USAGE, SELECT ON SEQUENCE trade_category_configs_id_seq TO torn_user;
