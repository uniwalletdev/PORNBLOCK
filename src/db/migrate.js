'use strict';

require('dotenv').config();
const pool = require('../config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Accounts ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'standard_user'
                        CHECK (role IN ('standard_user', 'admin')),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Devices ─────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        device_name       TEXT NOT NULL,
        platform          TEXT NOT NULL
                            CHECK (platform IN ('ios', 'android', 'windows', 'mac')),
        protection_status TEXT NOT NULL DEFAULT 'active'
                            CHECK (protection_status IN ('active', 'inactive', 'tampered')),
        last_heartbeat    TIMESTAMPTZ,
        enrolled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Policies ─────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS policies (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
        sensitivity_level TEXT NOT NULL DEFAULT 'medium'
                            CHECK (sensitivity_level IN ('low', 'medium', 'high', 'strict')),
        custom_allowlist  TEXT[] NOT NULL DEFAULT '{}',
        custom_blocklist  TEXT[] NOT NULL DEFAULT '{}',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Violations ───────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS violations (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        device_id      UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        violation_type TEXT NOT NULL
                         CHECK (violation_type IN ('dns_block', 'vision_classifier', 'app_filter', 'url_block')),
        url            TEXT,
        details        JSONB,
        detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Indexes ──────────────────────────────────────────────────────────────
    await client.query(`CREATE INDEX IF NOT EXISTS idx_devices_user_id    ON devices(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_violations_user_id ON violations(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_violations_device   ON violations(device_id);`);

    await client.query('COMMIT');
    console.log('Migration completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
