-- Reset all log-derived data and sync state so the next worker start
-- triggers a full re-sync from the Torn API.
--
-- Run on the server:
--   PGPASSWORD=<pass> psql -h localhost -U torn_user -d torn_tracker -f scripts/reset-logs.sql

BEGIN;

-- Clear derived tables first (lot_events references lots)
TRUNCATE torn_lot_events RESTART IDENTITY;
TRUNCATE torn_lots       RESTART IDENTITY;
TRUNCATE torn_logs;

-- Clear all sync cursors so the next run starts a fresh backfill
DELETE FROM torn_sync_state
WHERE key IN (
  'last_log_ts',
  'last_lot_ts',
  'backfill_cursor',
  'backfill_max_ts',
  'backfill_completed',
  'backfill_running',
  'backfill_to_cursor',
  'backfill_pages',
  'backfill_oldest_ts'
);

COMMIT;

-- Confirm
SELECT 'torn_logs'       AS "table", COUNT(*) AS rows FROM torn_logs
UNION ALL
SELECT 'torn_lots',       COUNT(*) FROM torn_lots
UNION ALL
SELECT 'torn_lot_events', COUNT(*) FROM torn_lot_events
UNION ALL
SELECT 'torn_sync_state', COUNT(*) FROM torn_sync_state;
