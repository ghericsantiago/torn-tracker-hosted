require('dotenv').config();
const fetch = require('node-fetch');

const key = process.env.TORN_API_KEY;
const ts  = 1766128570;
const id  = 'CK0uga1jAYGMk2SJjTD3';

async function fetchPage(to) {
  const url = `https://api.torn.com/v2/user/log?log=0&limit=1000&sort=desc&to=${to}&key=${key}`;
  const data = await fetch(url).then(r => r.json());
  return Array.isArray(data.log) ? data.log : [];
}

async function run() {
  // Test 1: to=ts (current code with fix applied)
  const a = await fetchPage(ts);
  console.log(`to=${ts}   → ${a.length} entries | oldest=${a.at(-1)?.timestamp} newest=${a[0]?.timestamp}`);
  console.log(`  Missing entry found: ${a.find(e=>e.id===id) ? 'YES ✓' : 'NO ✗'}`);
  console.log(`  Entries AT ts=${ts}: ${a.filter(e=>e.timestamp===ts).length}`);

  // Test 2: to=ts+1 (one second higher — should be inclusive of ts)
  const b = await fetchPage(ts + 1);
  console.log(`\nto=${ts+1} → ${b.length} entries | oldest=${b.at(-1)?.timestamp} newest=${b[0]?.timestamp}`);
  console.log(`  Missing entry found: ${b.find(e=>e.id===id) ? 'YES ✓' : 'NO ✗'}`);
  console.log(`  Entries AT ts=${ts}: ${b.filter(e=>e.timestamp===ts).length}`);
  b.filter(e=>e.timestamp===ts).forEach(e => console.log(`    ${e.id} | ${e.details?.title}`));
}

run().catch(e => { console.error(e.message); process.exit(1); });
