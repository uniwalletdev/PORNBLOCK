'use strict';

/**
 * Central environment configuration with startup validation.
 * Imported before any other module in src/app.js so the process
 * fails fast with a clear message instead of a cryptic runtime error.
 */

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'NODE_ENV', 'PORT', 'CLERK_SECRET_KEY'];
const OPTIONAL  = ['FRONTEND_URL', 'DNS_PORT', 'REDIS_URL', 'STRIPE_SECRET', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PERSONAL', 'STRIPE_PRICE_FAMILY', 'RESEND_API_KEY', 'EMAIL_FROM'];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error('\n[env] Missing required environment variables:');
  missing.forEach((k) => console.error(`      • ${k}`));
  console.error('\nSet these in Railway → Variables (or your local .env file).\n');
  // Use process.exit so the error appears clearly in Railway deploy logs.
  process.exit(1);
}

const optionalMissing = OPTIONAL.filter((k) => !process.env[k]);
if (optionalMissing.length) {
  console.warn('[env] Optional vars not set (defaults apply):', optionalMissing.join(', '));
}

console.log('[env] Environment OK ✓');

module.exports = {
  // Required — guaranteed to be set after this module is loaded.
  DATABASE_URL:  process.env.DATABASE_URL,
  JWT_SECRET:    process.env.JWT_SECRET,
  NODE_ENV:      process.env.NODE_ENV,
  PORT:          parseInt(process.env.PORT, 10),

  // Clerk
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,

  // Optional — always has a usable value.
  REDIS_URL:     process.env.REDIS_URL     || null,
  FRONTEND_URL:  process.env.FRONTEND_URL  || '',
  DNS_PORT:      parseInt(process.env.DNS_PORT, 10) || 53,
  STRIPE_SECRET:           process.env.STRIPE_SECRET           || null,
  STRIPE_WEBHOOK_SECRET:   process.env.STRIPE_WEBHOOK_SECRET   || null,
  STRIPE_PRICE_PERSONAL:   process.env.STRIPE_PRICE_PERSONAL   || null,
  STRIPE_PRICE_FAMILY:     process.env.STRIPE_PRICE_FAMILY     || null,
  RESEND_API_KEY:          process.env.RESEND_API_KEY          || null,
  EMAIL_FROM:              process.env.EMAIL_FROM              || 'PORNBLOCK <noreply@pornblock.app>',
};
