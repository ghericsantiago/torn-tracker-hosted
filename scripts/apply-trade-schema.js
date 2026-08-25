'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');

async function main() {
  const sql = await fs.promises.readFile(path.join(__dirname, '../trade-schema-v2.sql'), 'utf8');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Trade schema applied successfully.');
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
