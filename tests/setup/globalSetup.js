/**
 * tests/setup/globalSetup.js
 *
 * Runs once before the entire Jest suite:
 *   – spins up a fresh test database schema
 *   – stores the pool on global so tests can share it
 */
"use strict";
require("dotenv").config({ path: ".env.test", override: true });

const { Pool } = require("pg");
const fs       = require("fs");
const path     = require("path");

module.exports = async () => {
  const pool = new Pool({
    host:     process.env.DB_HOST     || "localhost",
    port:     Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || "pornblock_test",
    user:     process.env.DB_USER     || "pornblock",
    password: process.env.DB_PASSWORD,
  });

  // Run schema DDL (idempotent via CREATE … IF NOT EXISTS)
  const schema = fs.readFileSync(path.join(__dirname, "../../src/db/schema.sql"), "utf8");
  await pool.query(schema);
  await pool.end();

  // Expose test DB config globally so test files can create their own pools
  global.__DB_CONFIG__ = {
    host:     process.env.DB_HOST     || "localhost",
    port:     Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || "pornblock_test",
    user:     process.env.DB_USER     || "pornblock",
    password: process.env.DB_PASSWORD,
  };
};
