const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'torn_tracker.db');
const db     = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Auto-run schema on first use
const schemaPath = path.join(__dirname, '..', 'schema.sqlite.sql');
if (fs.existsSync(schemaPath)) {
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
}

// Convert PostgreSQL $1/$2/... params → ? and normalize NOW() → CURRENT_TIMESTAMP
function toSqlite(sql) {
  return sql
    .replace(/\$\d+/g, '?')
    .replace(/\bNOW\(\)/gi, "datetime('now')")
    .replace(/INTERVAL\s+'(\d+)\s+days?'/gi, "'-$1 days'");
}

// Sanitize params: SQLite rejects booleans and undefined
function sanitize(params) {
  return params.map(v => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

// Thin async-compatible wrapper matching pg's { rows } interface
function query(sql, params = []) {
  const converted = toSqlite(sql);
  params = sanitize(params);
  try {
    const stmt   = db.prepare(converted);
    const isRead = /^\s*(select|pragma|with)/i.test(converted.trim());
    if (isRead) {
      const rows = stmt.all(...params);
      return Promise.resolve({ rows });
    }
    const info = stmt.run(...params);
    // RETURNING: better-sqlite3 on SQLite 3.35+ returns rows from run() on RETURNING queries
    // Re-query by lastInsertRowid for INSERTs; for UPDATEs grab by WHERE if possible
    const hasReturning = /\breturning\b/i.test(converted);
    if (hasReturning && info.lastInsertRowid) {
      const table = converted.match(/(?:into|update)\s+([\w"]+)/i)?.[1];
      if (table) {
        const row = db.prepare(`SELECT * FROM ${table} WHERE rowid = ?`).get(info.lastInsertRowid);
        return Promise.resolve({ rows: row ? [row] : [] });
      }
    }
    return Promise.resolve({ rows: [], rowCount: info.changes });
  } catch (err) {
    return Promise.reject(err);
  }
}

module.exports = { query };
