'use strict';

/**
 * Inventory-monitor integration adapter for torn-tracker-hosted.
 *
 * Call mount(app) after Express middleware is set up. It will:
 *   - Apply the inventory-monitor DB schema
 *   - Load persisted state from PostgreSQL
 *   - Mount API routes at /inventory/api/*
 *   - Serve the frontend at /inventory
 *   - Start the background poll loop
 */

const express = require('express');

const { loadConfig }   = require('./src/config');
const { createCatalog }= require('./src/catalog');
const { createState }  = require('./src/state');
const { createPool, applySchema } = require('./src/db');
const { loadState }    = require('./src/db/load');
const { persistState } = require('./src/db/persist');
const { clearState }   = require('./src/db/clear');
const { createLogClient } = require('./src/logserver');
const { createLedger } = require('./src/ledger');
const { createPoller } = require('./src/poller');
const { createSummary }= require('./src/summary');
const { createRoutes } = require('./src/routes');

async function mount(app) {
  const config = loadConfig();

  if (!config.db.host || !config.db.database || !config.db.user) {
    console.error('[inventory] PostgreSQL not configured — set DB_HOST / DB_NAME / DB_USER in .env');
    return;
  }

  const catalog = createCatalog(config);
  catalog.load();

  const state = createState(config.defaultStart);
  const pool  = createPool(config);

  const db = {
    pool,
    persist: (newProcessed, applied) => persistState(pool, state, config, newProcessed, applied),
    clear:   () => clearState(pool, state),
  };

  await applySchema(pool, config);
  await loadState(pool, state, config);

  const logClient = createLogClient(config);
  const ledger    = createLedger({ catalog, config });
  const poller    = createPoller({ config, state, db, logClient, applyLog: ledger.applyLog });
  const summary   = createSummary({ state, catalog, config });

  // Serve static frontend files at /admin/inventory (before the API router so
  // index.html is found by the directory-index fallback).
  app.use('/admin/inventory', express.static(config.publicDir));

  // Mount API routes at /admin/inventory/api/*
  app.use('/admin/inventory', createRoutes({ state, catalog, summary, poller, db }));

  // Start background poll loop
  const r = await poller.poll();
  if (r && r.skipped && !config.logsServer) console.log('[inventory] waiting for LOGS_SERVER…');
  setInterval(() => { poller.poll().catch(e => console.error('[inventory poll]', e.message)); }, config.pollInterval);

  console.log(`[inventory] Torn Inventory Monitor mounted at /admin/inventory`);
  console.log(`[inventory] tracking since ${new Date(state.startTs * 1000).toISOString()} (configured ${config.startIso})`);
  if (Math.floor(Date.parse(config.startIso) / 1000) !== state.startTs) {
    console.warn('[inventory] NOTE: MONITOR_START differs from stored DB start — DB value wins.');
    console.warn('[inventory] To apply new date: run reset via /inventory/api/reset, then restart.');
  }
  console.log(`[inventory] poll interval ${config.pollInterval}ms · log source ${config.logsServer}`);
}

module.exports = { mount };
