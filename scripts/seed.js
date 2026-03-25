#!/usr/bin/env node
/**
 * scripts/seed.js
 *
 * Master seed script — runs in order:
 *   1. Creates admin + test user accounts
 *   2. Imports Hagezi porn blocklist into dns_blocklist
 *
 * Usage:
 *   npm run seed               # full seed
 *   node scripts/seed.js --users-only
 *   node scripts/seed.js --hagezi-only
 */

"use strict";

require("dotenv").config();
const { Pool }   = require("pg");
const bcrypt     = require("bcrypt");
const https      = require("https");

// ── Config ────────────────────────────────────────────────────────────────────

const HAGEZI_URL     = "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/porn.txt";
const BATCH_SIZE     = 500;
const BCRYPT_ROUNDS  = 12;

const ADMIN_EMAIL    = process.env.SEED_ADMIN_EMAIL    || "admin@pornblock.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "AdminPass123!";
const TEST_EMAIL     = process.env.SEED_TEST_EMAIL     || "testuser@pornblock.local";
const TEST_PASSWORD  = process.env.SEED_TEST_PASSWORD  || "TestPass123!";

const args = process.argv.slice(2);
const usersOnly  = args.includes("--users-only");
const hageziOnly = args.includes("--hagezi-only");

// ── Database pool ─────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// ── Seed users ────────────────────────────────────────────────────────────────

async function seedUsers() {
  console.log("\n── Seeding users ──────────────────────────────────────────");

  const pairs = [
    { email: ADMIN_EMAIL,  password: ADMIN_PASSWORD,  role: "admin" },
    { email: TEST_EMAIL,   password: TEST_PASSWORD,   role: "standard_user" },
  ];

  for (const { email, password, role } of pairs) {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      console.log(`  ↓ ${email} already exists — skipping`);
      continue;
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await pool.query(
      "INSERT INTO users (email, password_hash, role, subscription_tier) VALUES ($1, $2, $3, $4)",
      [email, hash, role, "free"],
    );
    console.log(`  ✔ Created ${role}: ${email}`);
  }
}

// ── Import Hagezi ─────────────────────────────────────────────────────────────

async function importHagezi() {
  console.log("\n── Importing Hagezi porn blocklist ────────────────────────");
  console.log(`   Source: ${HAGEZI_URL}`);

  const raw = await fetchText(HAGEZI_URL);
  const domains = raw
    .split("\n")
    .map(line => line.trim().toLowerCase())
    .filter(line => line && !line.startsWith("#") && !line.startsWith("!") && isValidDomain(line));

  console.log(`   Parsed ${domains.length.toLocaleString()} domains`);

  // Clear old hagezi entries so re-running the seed doesn't duplicate
  const { rowCount: deleted } = await pool.query(
    "DELETE FROM dns_blocklist WHERE source = 'hagezi'"
  );
  if (deleted > 0) console.log(`   Cleared ${deleted.toLocaleString()} stale hagezi entries`);

  let inserted = 0;
  for (let i = 0; i < domains.length; i += BATCH_SIZE) {
    const batch = domains.slice(i, i + BATCH_SIZE);
    const values = batch.map((_, j) => `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3})`).join(",");
    const params = batch.flatMap(d => [d, "porn", "hagezi"]);
    await pool.query(
      `INSERT INTO dns_blocklist (domain, category, source)
       VALUES ${values}
       ON CONFLICT (domain) DO NOTHING`,
      params,
    );
    inserted += batch.length;
    process.stdout.write(`\r   Inserted ${inserted.toLocaleString()} / ${domains.length.toLocaleString()}`);
  }

  console.log(`\n   ✔ Done — ${inserted.toLocaleString()} rows upserted`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end",  () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function isValidDomain(d) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d);
}

// ── Entry point ───────────────────────────────────────────────────────────────

(async () => {
  try {
    await pool.query("SELECT 1");   // connectivity check
    console.log("✔ Database connected");

    if (!hageziOnly) await seedUsers();
    if (!usersOnly)  await importHagezi();

    console.log("\n✔ Seed complete\n");
  } catch (err) {
    console.error("\n✖ Seed failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
