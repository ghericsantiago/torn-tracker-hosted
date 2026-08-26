require('dotenv').config();
const cron = require('node-cron');
const { runSync, runLogSync } = require('./services/portfolio-sync');

// Logs + lot processor every minute (cheap: 1-2 API calls)
setTimeout(runLogSync, 30_000);
cron.schedule('* * * * *', runLogSync);

// Full sync (catalog + logs + lots + inventory snapshot) every 15 minutes
cron.schedule('*/15 * * * *', runSync);

console.log('[portfolio-worker] Started — logs every 1 min, full sync every 15 min');
