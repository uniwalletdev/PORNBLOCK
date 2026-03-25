'use strict';

const { Pool } = require('pg');
const { DATABASE_URL, NODE_ENV } = require('./env');

// DATABASE_URL is guaranteed set — validated by env.js at startup.
const poolConfig = {
  connectionString: DATABASE_URL,
  // Railway Postgres requires SSL; ignore self-signed cert in production.
  ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

/**
 * Verify the database is reachable, retrying up to `maxAttempts` times
 * with `delayMs` between each attempt.
 * Never throws — logs a warning and continues if all attempts fail.
 */
async function connectWithRetry(maxAttempts = 5, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query('SELECT 1');
      console.log('[DB] PostgreSQL connection verified');
      return;
    } catch (err) {
      console.error(
        `[DB] Connection attempt ${attempt}/${maxAttempts} failed: ${err.message}`,
      );
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  console.error('[DB] Could not verify PostgreSQL connection — proceeding anyway');
}

module.exports = pool;
module.exports.connectWithRetry = connectWithRetry;
