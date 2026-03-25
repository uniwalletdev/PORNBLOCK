'use strict';

const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  // Reconnect on failure — will keep retrying every 2 s up to 10 times
  retryStrategy: (times) => (times > 10 ? null : Math.min(times * 200, 2000)),
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connected');
});

redis.on('reconnecting', () => {
  console.warn('[Redis] Reconnecting...');
});

module.exports = redis;
