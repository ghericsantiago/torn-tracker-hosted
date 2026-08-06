const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'torn_tracker',
  user:     process.env.DB_USER     || 'torn_user',
  password: process.env.DB_PASS     || '',
});

pool.on('error', (err) => console.error('PostgreSQL pool error:', err.message));

module.exports = pool;
