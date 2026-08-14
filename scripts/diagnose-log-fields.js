require('dotenv').config();
const { fetchUserLogPage, buildUserLogUrl } = require('../services/torn');

async function diagnose() {
  const apiKey = process.env.TORN_API_KEY;
  const url = buildUserLogUrl(apiKey);
  const { entries } = await fetchUserLogPage(url, apiKey);

  let withDetailsId = 0, withEntryLog = 0, withBoth = 0, withNeither = 0;

  console.log('\n--- Sample of first 3 entries (raw structure) ---');
  entries.slice(0, 3).forEach((e, i) => {
    console.log(`\nEntry ${i + 1}:`, JSON.stringify(e, null, 2));
  });

  console.log('\n--- Field presence across all entries on this page ---');
  for (const e of entries) {
    const hasDetailsId = e.details?.id != null;
    const hasEntryLog  = e.log != null;
    if (hasDetailsId && hasEntryLog) withBoth++;
    else if (hasDetailsId)           withDetailsId++;
    else if (hasEntryLog)            withEntryLog++;
    else                             withNeither++;
  }

  console.log(`Total entries on page : ${entries.length}`);
  console.log(`details.id only       : ${withDetailsId}`);
  console.log(`entry.log only        : ${withEntryLog}`);
  console.log(`both present          : ${withBoth}`);
  console.log(`neither present       : ${withNeither}`);
  console.log(`\nCurrent code captures : ${withDetailsId + withBoth} / ${entries.length}`);
  console.log(`Fixed code would get  : ${entries.length - withNeither} / ${entries.length}`);
}

diagnose().catch(err => { console.error(err.message); process.exit(1); });
