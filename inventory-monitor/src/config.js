'use strict';

/**
 * Configuration — everything the app needs is resolved here from env vars
 * and returned as one frozen, injectable object (DIP: consumers never read env
 * directly; they receive `config`).
 *
 * Env vars: LOGS_SERVER (portfolio log endpoint, defaults to localhost),
 * MONITOR_START, POLL_INTERVAL, API_RATE_INTERVAL,
 * DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASS.
 *
 * When integrated into torn-tracker-hosted, dotenv is already loaded by
 * server.js before this module is required.
 */

const path = require('path');

function loadConfig() {
  // Torn City runs on New York time — all displayed times use this zone.
  const TORN_TIME_ZONE = 'America/New_York';

  // Default monitor start, expressed in Torn time. (Same instant as the original
  // "02:00 AM Manila, 13 Aug 2026" = 14:00 ET, 12 Aug 2026.) Overridden by .env.
  const startIso = process.env.MONITOR_START || '2026-08-12T14:00:00-04:00';

  const port = parseInt(process.env.PORT || '3001', 10);

  const config = {
    port,
    pollInterval: parseInt(process.env.POLL_INTERVAL || '60000', 10),
    tornTimeZone: TORN_TIME_ZONE,

    // Log source — defaults to this same server (torn-tracker-hosted serves /api/portfolio/logs).
    logsServer: (process.env.LOGS_SERVER || `http://localhost:${port}`).replace(/\/+$/, ''),
    startIso,
    defaultStart: Math.floor(Date.parse(startIso) / 1000),

    // Retention caps (memory + DB)
    activityMax: 20000,
    locationEventMax: 50000,
    transferMax: 1000,
    tradeEventMax: 1000,
    museumSwapMax: 1000,
    processedMax: 5000,

    // Log server fetching
    fetchChunk: 6 * 3600,
    requestIntervalMs: parseInt(process.env.API_RATE_INTERVAL || '0', 10),
    requestRetries: 4,
    logFetchLimit: 5000,

    // PostgreSQL (required — the monitor's durable store; logs stay the source of truth)
    db: {
      host: (process.env.DB_HOST || '').trim(),
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: (process.env.DB_NAME || '').trim(),
      user: (process.env.DB_USER || '').trim(),
      password: process.env.DB_PASS || '',
    },

    // Paths — relative to torn-tracker-hosted project root
    schemaFile: path.join(__dirname, '..', 'schema.sql'),
    publicDir:  path.join(__dirname, '..', '..', 'public', 'inventory-monitor'),
    itemsFile:  path.join(__dirname, '..', '..', 'torn_items.json'),
    museumFile: path.join(__dirname, '..', '..', 'museum-exchange.json'),
  };

  return Object.freeze(config);
}

module.exports = { loadConfig };
