require('dotenv').config();

if (process.env.DB_TYPE === 'sqlite') {
  module.exports = require('./db/sqlite');
} else {
  module.exports = require('./db/postgres');
}
