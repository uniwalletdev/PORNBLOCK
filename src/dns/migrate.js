'use strict';

require('dotenv').config();
const pool = require('../config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── DNS blocklist ────────────────────────────────────────────────────────
    // Stores all blocked domains (Hagezi seed + custom additions).
    await client.query(`
      CREATE TABLE IF NOT EXISTS dns_blocklist (
        id        BIGSERIAL    PRIMARY KEY,
        domain    TEXT         NOT NULL,
        source    TEXT         NOT NULL DEFAULT 'hagezi-porn',
        is_active BOOLEAN      NOT NULL DEFAULT TRUE,
        added_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT dns_blocklist_domain_unique UNIQUE (domain)
      );
    `);

    // ── DNS allowlist ────────────────────────────────────────────────────────
    // Global per-domain override — always forward, never block.
    await client.query(`
      CREATE TABLE IF NOT EXISTS dns_allowlist (
        id        BIGSERIAL    PRIMARY KEY,
        domain    TEXT         NOT NULL,
        note      TEXT,
        added_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT dns_allowlist_domain_unique UNIQUE (domain)
      );
    `);

    // ── Device IP map ────────────────────────────────────────────────────────
    // Maps source IPs to device records so blocked queries can be attributed.
    // Device agents update this table via the /heartbeat endpoint.
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_ip_map (
        ip_address  INET         NOT NULL,
        device_id   UUID         NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        PRIMARY KEY (ip_address)
      );
    `);

    // ── Blocked query log ────────────────────────────────────────────────────
    // Every blocked DNS query is appended here for reporting.
    await client.query(`
      CREATE TABLE IF NOT EXISTS dns_blocked_log (
        id           BIGSERIAL    PRIMARY KEY,
        domain       TEXT         NOT NULL,
        source_ip    INET         NOT NULL,
        device_id    UUID         REFERENCES devices(id) ON DELETE SET NULL,
        device_token TEXT,
        detected_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // ── Unknown domain log ───────────────────────────────────────────────────
    // Domains forwarded to upstream that haven't been classified yet.
    // The AI classifier (Phase 3) reads from this table.
    await client.query(`
      CREATE TABLE IF NOT EXISTS dns_unknown_log (
        domain       TEXT         NOT NULL,
        source_ip    INET         NOT NULL,
        first_seen   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        last_seen    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        query_count  INT          NOT NULL DEFAULT 1,
        PRIMARY KEY (domain, source_ip)
      );
    `);

    // ── Indexes ──────────────────────────────────────────────────────────────
    // Partial index: only active blocklist entries need fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dns_blocklist_active_domain
        ON dns_blocklist (domain) WHERE is_active = TRUE;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dns_allowlist_domain
        ON dns_allowlist (domain);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_device_ip_map_device_id
        ON device_ip_map (device_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dns_blocked_log_domain
        ON dns_blocked_log (domain);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dns_blocked_log_device_id
        ON dns_blocked_log (device_id) WHERE device_id IS NOT NULL;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dns_blocked_log_detected_at
        ON dns_blocked_log (detected_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dns_unknown_log_last_seen
        ON dns_unknown_log (last_seen DESC);
    `);

    await client.query('COMMIT');
    console.log('[DNS Migrate] DNS tables created successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DNS Migrate] Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
