'use strict';

const Redis = require('ioredis');

let _available = false;

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
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
