'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');

async function main() {
  const sqlFiles = ['trade-schema-v2.sql', 'trade-schema-receipts.sql'];
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const file of sqlFiles) {
      const sql = await fs.promises.readFile(path.join(__dirname, '..', file), 'utf8');
      await client.query(sql);
    }
    await client.query('COMMIT');
    console.log('Trade and receipt schemas applied successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

main().catch(error => {
  console.error('[apply-trade-schema]', error.message);
  process.exitCode = 1;
});
