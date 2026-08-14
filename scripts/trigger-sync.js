require('dotenv').config();
const { runSync } = require('../services/portfolio-sync');

console.log('[trigger] Starting full sync...');
runSync().then(() => {
  console.log('[trigger] Done.');
  process.exit(0);
}).catch(err => {
  console.error('[trigger] Failed:', err.message);
  process.exit(1);
});
