-- Trade listing feature schema
-- Run once: psql -U torn_user -d torn_tracker -f trade-schema.sql

CREATE TABLE IF NOT EXISTS trade_profiles (
  id               SERIAL PRIMARY KEY,
  slug             VARCHAR(64) UNIQUE NOT NULL DEFAULT 'default',
  display_name     VARCHAR(128) NOT NULL DEFAULT 'Torn Trader',
  torn_profile_url VARCHAR(255),
  discord_handle   VARCHAR(128),
  bio              TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trade_listings (
  id           SERIAL PRIMARY KEY,
  profile_id   INTEGER NOT NULL DEFAULT 1 REFERENCES trade_profiles(id) ON DELETE CASCADE,
  torn_item_id INTEGER NOT NULL,
  item_name    VARCHAR(255) NOT NULL,
  item_type    VARCHAR(128) NOT NULL DEFAULT 'Other',
  price_mode   VARCHAR(16) NOT NULL DEFAULT 'fixed' CHECK (price_mode IN ('fixed', 'market_pct')),
  fixed_price  BIGINT,
  market_pct   DECIMAL(5,4),   -- e.g. 0.8500 = 85% of market price
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(profile_id, torn_item_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_listings_profile ON trade_listings(profile_id, is_active);
CREATE INDEX IF NOT EXISTS idx_trade_listings_type    ON trade_listings(item_type);

-- Default profile for the single admin user
INSERT INTO trade_profiles (slug, display_name)
VALUES ('default', 'Admin')
ON CONFLICT (slug) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON trade_profiles TO torn_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON trade_listings TO torn_user;
GRANT USAGE, SELECT ON SEQUENCE trade_profiles_id_seq TO torn_user;
GRANT USAGE, SELECT ON SEQUENCE trade_listings_id_seq TO torn_user;
