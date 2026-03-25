'use strict';

const redis = require('../config/redis');
const pool  = require('../config/database');

const BLOCK_PREFIX  = 'dns:b:';
const ALLOW_PREFIX  = 'dns:a:';
const TTL_SECONDS   = 60 * 60; // 1 hour
const PIPELINE_BATCH = 1000;

/**
 * Normalise a domain for consistent, case-insensitive cache keying.
 * Strips a trailing dot (FQDN form) and lower-cases.
 */
function normalise(domain) {
  return domain.toLowerCase().replace(/\.$/, '');
}

/** Returns true if the domain is in the Redis blocklist cache. */
async function isBlocked(domain) {
  try {
    const val = await redis.get(BLOCK_PREFIX + normalise(domain));
    return val === '1';
  } catch {
    return false; // Redis unavailable — treat as cache miss, fall through to DB
  }
}

/** Returns true if the domain is in the Redis allowlist cache. */
async function isAllowed(domain) {
  try {
    const val = await redis.get(ALLOW_PREFIX + normalise(domain));
    return val === '1';
  } catch {
    return false; // Redis unavailable — treat as cache miss, fall through to DB
  }
}

/**
 * Warm the cache for a single domain (called on a DB cache-miss).
 * Fire-and-forget — errors are suppressed so they never block a DNS response.
 */
function warmBlock(domain) {
  redis.set(BLOCK_PREFIX + normalise(domain), '1', 'EX', TTL_SECONDS).catch(() => {});
}

function warmAllow(domain) {
  redis.set(ALLOW_PREFIX + normalise(domain), '1', 'EX', TTL_SECONDS).catch(() => {});
}

/**
 * Load the full blocklist and allowlist from PostgreSQL into Redis.
 *
 * Uses pipelined SET commands in batches of PIPELINE_BATCH to handle
 * lists with 100k+ entries without exhausting memory or Redis connections.
 */
async function loadBlocklist() {
  console.log('[Cache] Loading blocklist + allowlist from PostgreSQL…');
  const start = Date.now();

  const [blockResult, allowResult] = await Promise.all([
    pool.query(`SELECT domain FROM dns_blocklist WHERE is_active = TRUE`),
    pool.query(`SELECT domain FROM dns_allowlist`),
  ]);

  let pipeline = redis.pipeline();
  let blockCount = 0;

  for (const row of blockResult.rows) {
    pipeline.set(BLOCK_PREFIX + normalise(row.domain), '1', 'EX', TTL_SECONDS);
    blockCount++;
    if (blockCount % PIPELINE_BATCH === 0) {
      await pipeline.exec();
      pipeline = redis.pipeline();
    }
  }
  if (blockCount % PIPELINE_BATCH !== 0) await pipeline.exec();

  pipeline = redis.pipeline();
  let allowCount = 0;

  for (const row of allowResult.rows) {
    pipeline.set(ALLOW_PREFIX + normalise(row.domain), '1', 'EX', TTL_SECONDS);
    allowCount++;
    if (allowCount % PIPELINE_BATCH === 0) {
      await pipeline.exec();
      pipeline = redis.pipeline();
    }
  }
  if (allowCount % PIPELINE_BATCH !== 0) await pipeline.exec();

  const elapsed = Date.now() - start;
  console.log(
    `[Cache] Loaded ${blockCount} blocked + ${allowCount} allowed domains in ${elapsed}ms`
  );
}

module.exports = { normalise, isBlocked, isAllowed, warmBlock, warmAllow, loadBlocklist };
