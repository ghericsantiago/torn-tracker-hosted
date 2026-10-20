-- Pre-aggregated daily record counts for the admin history chart.
-- Apply with scripts/apply-records-history-schema.js so writes are briefly
-- serialized during the initial backfill and no inserts are missed.

LOCK TABLE item_market IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS item_market_daily_counts (
  day          DATE PRIMARY KEY,
  record_count BIGINT NOT NULL CHECK (record_count >= 0)
);

CREATE OR REPLACE FUNCTION update_item_market_daily_counts_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO item_market_daily_counts (day, record_count)
  SELECT (inserted.created_at AT TIME ZONE 'UTC')::date, COUNT(*)
  FROM inserted_item_market_rows inserted
  GROUP BY 1
  ON CONFLICT (day) DO UPDATE
    SET record_count = item_market_daily_counts.record_count + EXCLUDED.record_count;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION update_item_market_daily_counts_after_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE item_market_daily_counts daily
  SET record_count = GREATEST(daily.record_count - removed.record_count, 0)
  FROM (
    SELECT (deleted.created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*) AS record_count
    FROM deleted_item_market_rows deleted
    GROUP BY 1
  ) removed
  WHERE daily.day = removed.day;

  DELETE FROM item_market_daily_counts WHERE record_count = 0;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS item_market_daily_counts_insert ON item_market;
CREATE TRIGGER item_market_daily_counts_insert
AFTER INSERT ON item_market
REFERENCING NEW TABLE AS inserted_item_market_rows
FOR EACH STATEMENT
EXECUTE FUNCTION update_item_market_daily_counts_after_insert();

DROP TRIGGER IF EXISTS item_market_daily_counts_delete ON item_market;
CREATE TRIGGER item_market_daily_counts_delete
AFTER DELETE ON item_market
REFERENCING OLD TABLE AS deleted_item_market_rows
FOR EACH STATEMENT
EXECUTE FUNCTION update_item_market_daily_counts_after_delete();

INSERT INTO item_market_daily_counts (day, record_count)
SELECT (created_at AT TIME ZONE 'UTC')::date, COUNT(*)
FROM item_market
GROUP BY 1
ON CONFLICT (day) DO UPDATE SET record_count = EXCLUDED.record_count;

GRANT SELECT, INSERT, UPDATE, DELETE ON item_market_daily_counts TO torn_user;
GRANT EXECUTE ON FUNCTION update_item_market_daily_counts_after_insert() TO torn_user;
GRANT EXECUTE ON FUNCTION update_item_market_daily_counts_after_delete() TO torn_user;