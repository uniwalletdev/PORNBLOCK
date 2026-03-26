'use strict';

const Redis = require('ioredis');
const { REDIS_URL } = require('./env');

// If REDIS_URL is not set, export a no-op stub so the app starts without Redis.
// Redis is used only for DNS caching — the app functions fully without it.
if (!REDIS_URL) {
  console.warn('[Redis] REDIS_URL not set — cache disabled, running without Redis.');
  const stub = new Proxy({}, {
    get(_, prop) {
      if (prop === 'isAvailable') return () => false;
      if (prop === 'on') return () => stub;
      return () => Promise.resolve(null);
    },
  });
  module.exports = stub;
} else {

  let _available = false;

  const redis = new Redis(REDIS_URL, {
    // 1 retry per command so commands fail fast when Redis is down.
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    // Don't connect immediately — connect() is called below so failure
    // is caught and never blocks app startup.
    lazyConnect: true,
    // Reject queued commands immediately when offline instead of hanging.
    enableOfflineQueue: false,
    // Back off exponentially, give up after 5 reconnect attempts.
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
  });

  redis.on('ready', () => {
    _available = true;
    console.log('[Redis] Connected');
  });

  redis.on('error', (err) => {
    _available = false;
    console.error('[Redis] Connection error:', err.message);
  });

  redis.on('close', () => {
    _available = false;
  });

  redis.on('reconnecting', () => {
    console.warn('[Redis] Reconnecting...');
  });

  // Connect in the background — never blocks app startup.
  redis.connect().catch((err) => {
    console.warn('[Redis] Initial connection failed (cache disabled):', err.message);
  });

  /** Returns true when Redis is currently reachable. */
  redis.isAvailable = () => _available;

  module.exports = redis;

} // end else (REDIS_URL set)
