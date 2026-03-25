'use strict';

/**
 * Migration: enrolment_tokens table
 *
 * Run with:  node src/db/migrate-enrolment.js
 * (or add to your main migrate script)
 */

require('dotenv').config();
const pool = require('../config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS enrolment_tokens (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        token        UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        user_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        device_name  TEXT        NOT NULL,
        platform     TEXT
                       CHECK (platform IN ('ios','android','windows','mac')),
        used         BOOLEAN     NOT NULL DEFAULT FALSE,
        used_at      TIMESTAMPTZ,
        device_id    UUID        REFERENCES devices(id) ON DELETE SET NULL,
        expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        -- used_at must be set iff used = true
        CONSTRAINT enrolment_token_used_consistency
          CHECK (
            (used = FALSE AND used_at IS NULL  ) OR
            (used = TRUE  AND used_at IS NOT NULL)
          )
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_enrolment_tokens_user_id
        ON enrolment_tokens (user_id);
    `);

    // Partial index: only un-used, non-expired tokens need fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_enrolment_tokens_active
        ON enrolment_tokens (token)
        WHERE used = FALSE AND expires_at > NOW();
    `);

    await client.query('COMMIT');
    console.log('[Migrate] enrolment_tokens table ready.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migrate] enrolment migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
