/**
 * tests/setup/globalTeardown.js
 *
 * Runs once after the entire Jest suite — truncates test tables
 * so the next run starts clean.
 */
"use strict";

const { Pool } = require("pg");

module.exports = async () => {
  if (!global.__DB_CONFIG__) return;

  const pool = new Pool(global.__DB_CONFIG__);
  try {
    await pool.query(`
      TRUNCATE
        partner_actions, partner_change_requests,
        audit_log, violations,
        partner_approvals, accountability_partners,
        policies, devices, users
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await pool.end();
  }
};
