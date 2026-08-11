#!/bin/bash
cd /home/ubuntu/torn-tracker

echo "[watcher] Waiting for backfill to finish..."

while true; do
  RUNNING=$(node -e "
    require('dotenv').config();
    const db = require('./db');
    db.query(\"SELECT value FROM torn_sync_state WHERE key='backfill_running'\")
      .then(r => { console.log(r.rows[0]?.value || '0'); db.end(); })
      .catch(() => { console.log('0'); });
  " 2>/dev/null)

  if [ "$RUNNING" != "1" ]; then
    echo "[watcher] Backfill done! Logs in DB:"
    node -e "
      require('dotenv').config();
      const db = require('./db');
      db.query('SELECT COUNT(*) AS n, MIN(happened_at) AS oldest FROM torn_logs')
        .then(r => { console.log('  total:', r.rows[0].n, '| oldest:', r.rows[0].oldest); db.end(); });
    " 2>/dev/null

    echo "[watcher] Resetting lot cursor..."
    node -e "
      require('dotenv').config();
      const db = require('./db');
      db.query(\"DELETE FROM torn_sync_state WHERE key='last_lot_ts'\")
        .then(() => { console.log('  Cursor cleared'); db.end(); });
    " 2>/dev/null

    echo "[watcher] Starting lot rebuild (this may take a while)..."
    node scripts/build-lots.js

    echo "[watcher] Done!"
    break
  fi

  echo "[watcher] Still running... ($(date '+%H:%M:%S'))"
  sleep 30
done
