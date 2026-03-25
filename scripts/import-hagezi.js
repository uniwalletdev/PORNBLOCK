'use strict';

/**
 * scripts/import-hagezi.js
 *
 * Downloads the Hagezi porn DNS blocklist and bulk-imports it into the
 * dns_blocklist PostgreSQL table.
 *
 * Usage:
 *   node scripts/import-hagezi.js
 *   npm run import:hagezi
 *
 * The source URL is a fixed constant — it is NOT user-supplied and therefore
 * not subject to SSRF risk.  Redirects are followed with a depth limit.
 */

require('dotenv').config();

const https    = require('node:https');
const readline = require('node:readline');
const pool     = require('../src/config/database');

// ── Configuration ─────────────────────────────────────────────────────────────
const HAGEZI_URL   = 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/porn.txt';
const SOURCE_NAME  = 'hagezi-porn';
const BATCH_SIZE   = 500;   // rows per INSERT — keeps param count well under PG's 65535 limit
const MAX_REDIRECTS = 5;

// ── Download helper ───────────────────────────────────────────────────────────

function downloadStream(url, redirectsLeft) {
  if (redirectsLeft < 0) {
    return Promise.reject(new Error('Too many redirects — aborting download.'));
  }
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'PORNBLOCK-Importer/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); // drain & discard redirect body
          // Only follow redirects to HTTPS GitHub URLs
          const target = res.headers.location;
          if (!target.startsWith('https://')) {
            reject(new Error(`Refusing non-HTTPS redirect to: ${target}`));
            return;
          }
          resolve(downloadStream(target, redirectsLeft - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Unexpected HTTP status: ${res.statusCode}`));
          return;
        }
        resolve(res);
      })
      .on('error', reject);
  });
}

// ── Domain validation ─────────────────────────────────────────────────────────

const VALID_DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

function parseDomain(line) {
  const raw = line.trim();

  // Skip empty lines and comment/directive lines
  if (!raw || raw.startsWith('#') || raw.startsWith('!') || raw.startsWith('[')) return null;

  // Some lists use "0.0.0.0 domain.tld" or "127.0.0.1 domain.tld" format
  const parts = raw.split(/\s+/);
  const domain = (parts.length > 1 ? parts[parts.length - 1] : parts[0]).toLowerCase();

  // Reject localhost entries, bare IPs, and anything that doesn't look like a domain
  if (domain === 'localhost' || domain === '0.0.0.0' || domain === '127.0.0.1') return null;
  if (!domain.includes('.')) return null;
  if (!VALID_DOMAIN_RE.test(domain)) return null;

  return domain;
}

// ── Batch insert ──────────────────────────────────────────────────────────────

async function flushBatch(batch) {
  if (batch.length === 0) return;

  // Build parameterised multi-row INSERT.
  // Each row needs 2 params (domain, source), so max params = BATCH_SIZE * 2 = 1000,
  // well below PostgreSQL's 65535 parameter limit.
  const placeholders = batch.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
  const values = batch.flatMap((d) => [d, SOURCE_NAME]);

  await pool.query(
    `INSERT INTO dns_blocklist (domain, source)
     VALUES ${placeholders}
     ON CONFLICT (domain) DO NOTHING`,
    values
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`[Import] Source: ${HAGEZI_URL}`);
  console.log('[Import] Downloading…');

  const stream = await downloadStream(HAGEZI_URL, MAX_REDIRECTS);

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const batch  = [];
  let inserted = 0;
  let skipped  = 0;

  for await (const line of rl) {
    const domain = parseDomain(line);
    if (!domain) { skipped++; continue; }

    batch.push(domain);

    if (batch.length >= BATCH_SIZE) {
      await flushBatch(batch);
      inserted += batch.length;
      batch.length = 0;
      process.stdout.write(`\r[Import] Rows inserted: ${inserted}…`);
    }
  }

  // Flush remaining
  await flushBatch(batch);
  inserted += batch.length;

  console.log(`\n[Import] Complete — ${inserted} domains imported, ${skipped} lines skipped.`);
  console.log('[Import] Run `npm run dns:migrate` then `npm run dns` to start the server.');
}

run()
  .then(() => pool.end())
  .catch((err) => {
    console.error('\n[Import] Fatal error:', err.message);
    pool.end().finally(() => process.exit(1));
  });
