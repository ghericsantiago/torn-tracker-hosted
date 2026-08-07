require('dotenv').config();
const cron       = require('node-cron');
const { runSync } = require('./services/portfolio-sync');

// Run once immediately on startup, then every 15 minutes
runSync();
cron.schedule('*/15 * * * *', runSync);

console.log('[portfolio-worker] Started — syncing every 15 minutes');
