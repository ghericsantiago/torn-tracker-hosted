'use strict';

/**
 * Composition root — wires every module together (the only place that knows how
 * they fit) and starts the HTTP server + poll loop.
 *
 *   config ──► catalog, pool, state
 *   pool    ──► db (load / persist / clear)
 *   catalog ──► ledger
 *   ledger + logClient + db ──► poller
 *   state + catalog ──► summary
 *   everything ──► routes → express app
 */

const express = require('express');

const { loadConfig } = require('./config');
const { createCatalog } = require('./catalog');
const { createState } = require('./state');
const { createPool, applySchema } = require('./db');
const { loadState } = require('./db/load');
const { persistState } = require('./db/persist');
const { clearState } = require('./db/clear');
const { createLogClient } = require('./logserver');
const { createLedger } = require('./ledger');
const { createPoller } = require('./poller');
const { createSummary } = require('./summary');
const { createRoutes } = require('./routes');

(async () => {
  const config = loadConfig();

  // PostgreSQL is required (the monitor's durable store; logs stay the source of truth).
  if (!config.db.host || !config.db.database || !config.db.user) {
    console.error('[init] PostgreSQL not configured — set DB_HOST / DB_NAME / DB_USER (and DB_PASS) in .env');
    process.exit(1);
  }

  const catalog = createCatalog(config);
  catalog.load();                      // sync — prints catalog/museum set counts

  const state = createState(config.defaultStart);
  const pool  = createPool(config);

  const db = {
    pool,
    persist: (newProcessed, applied) => persistState(pool, state, config, newProcessed, applied),
    clear: () => clearState(pool, state),
  };

  await applySchema(pool, config);     // schema + idempotent migrations
  await loadState(pool, state, config, catalog);

  const logClient = createLogClient(config);
  const ledger    = createLedger({ catalog, config });
  const poller    = createPoller({ config, state, db, logClient, applyLog: ledger.applyLog });
  const summary   = createSummary({ state, catalog, config });

  const app = express();
  app.use(express.json());
  app.use(express.static(config.publicDir));
  app.use(createRoutes({ state, catalog, summary, poller, db }));

  app.listen(config.port, () => {
    console.log(`[init] Torn Inventory Monitor → http://localhost:${config.port}`);
    console.log(`[init] tracking since ${new Date(state.startTs * 1000).toISOString()} (configured ${config.startIso})`);
    if (Math.floor(Date.parse(config.startIso) / 1000) !== state.startTs) {
      console.warn('[init] NOTE: .env MONITOR_START differs from the stored DB start — the DB start wins on restarts.');
      console.warn('[init] To apply the new date: stop the server, run "npm run reset-db", then start again (logs are re-fetched from the log server).');
    }
    console.log(`[init] poll interval ${config.pollInterval}ms · log source ${config.logsServer}`);
    console.log(`[init] PostgreSQL ${config.db.host}:${config.db.port}/${config.db.database}`);
  });

  const r = await poller.poll();
  if (r && r.skipped && !config.logsServer) console.log('[init] waiting for LOGS_SERVER…');
  setInterval(() => { poller.poll().catch(e => console.error('[poll]', e.message)); }, config.pollInterval);
})().catch(e => {
  console.error('[init] startup failed:', e.message);
  process.exit(1);
});
