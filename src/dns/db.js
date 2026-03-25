'use strict';

const pool = require('../config/database');

/**
 * Look up a device record by its last-known source IP.
 * Returns { device_id, device_token } or null if unmapped.
 */
async function lookupDeviceByIp(ip) {
  const { rows } = await pool.query(
    `SELECT d.id           AS device_id,
            d.device_token AS device_token
     FROM   device_ip_map m
     JOIN   devices        d ON d.id = m.device_id
     WHERE  m.ip_address = $1::inet
     LIMIT  1`,
    [ip]
  );
  return rows[0] || null;
}

/**
 * Append a blocked-query record to dns_blocked_log.
 */
async function logBlocked({ domain, source_ip, device_id, device_token }) {
  await pool.query(
    `INSERT INTO dns_blocked_log (domain, source_ip, device_id, device_token)
     VALUES ($1, $2::inet, $3, $4)`,
    [domain, source_ip, device_id || null, device_token || null]
  );
}

/**
 * Upsert an unknown domain into dns_unknown_log.
 * Uses ON CONFLICT to increment the counter rather than creating duplicate rows.
 */
async function logUnknown({ domain, source_ip }) {
  await pool.query(
    `INSERT INTO dns_unknown_log (domain, source_ip)
     VALUES ($1, $2::inet)
     ON CONFLICT (domain, source_ip) DO UPDATE
       SET query_count = dns_unknown_log.query_count + 1,
           last_seen   = NOW()`,
    [domain, source_ip]
  );
}

/**
 * Direct PostgreSQL blocklist check — used on a Redis cache miss.
 * Returns true if the domain is actively blocked.
 */
async function isInBlocklist(domain) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM   dns_blocklist
     WHERE  domain = $1 AND is_active = TRUE
     LIMIT  1`,
    [domain.toLowerCase()]
  );
  return rows.length > 0;
}

/**
 * Direct PostgreSQL allowlist check — used on a Redis cache miss.
 */
async function isInAllowlist(domain) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM   dns_allowlist
     WHERE  domain = $1
     LIMIT  1`,
    [domain.toLowerCase()]
  );
  return rows.length > 0;
}

module.exports = {
  lookupDeviceByIp,
  logBlocked,
  logUnknown,
  isInBlocklist,
  isInAllowlist,
};
