require('dotenv').config();
const { fetchUserLogPage } = require('../services/torn');
const TORN_BASE = 'https://api.torn.com';

(async () => {
  const apiKey = process.env.TORN_API_KEY;

  // Try sort=asc from epoch to get oldest logs first
  const url = `${TORN_BASE}/v2/user/log?log=0&limit=100&sort=asc&from=0&key=${apiKey}`;
  console.log('Fetching:', url.replace(apiKey, '***'));

  const { entries, prevUrl } = await fetchUserLogPage(url, apiKey);
  console.log('entries returned:', entries.length);
  if (entries.length > 0) {
    console.log('first (oldest asc):', new Date(entries[0].timestamp * 1000).toISOString());
    console.log('last  (newest asc):', new Date(entries.at(-1).timestamp * 1000).toISOString());
  }
  console.log('nextUrl present:', !!prevUrl);

  // Also try with to= of our oldest known entry minus 1 second
  const oldest = 1754313223; // Aug 4 00:33:43 UTC
  const url2 = `${TORN_BASE}/v2/user/log?log=0&limit=100&sort=desc&from=0&to=${oldest - 1}&key=${apiKey}`;
  console.log('\nFetching with to=oldest-1...');
  const { entries: entries2, prevUrl: p2 } = await fetchUserLogPage(url2, apiKey);
  console.log('entries returned:', entries2.length);
  if (entries2.length > 0) {
    console.log('newest:', new Date(entries2[0].timestamp * 1000).toISOString());
    console.log('oldest:', new Date(entries2.at(-1).timestamp * 1000).toISOString());
  }
})().catch(e => console.error('Error:', e.message));
