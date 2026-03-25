'use strict';

const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// All policy routes require authentication
router.use(authenticate);

const VALID_SENSITIVITY = ['low', 'medium', 'high', 'strict'];

// ── GET /policy ───────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, sensitivity_level, custom_allowlist, custom_blocklist, updated_at
       FROM policies
       WHERE user_id = $1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      // Lazily create policy if somehow missing
      const created = await pool.query(
        `INSERT INTO policies (user_id, sensitivity_level)
         VALUES ($1, 'medium')
         RETURNING id, sensitivity_level, custom_allowlist, custom_blocklist, updated_at`,
        [req.user.id]
      );
      return res.json({ policy: created.rows[0] });
    }

    return res.json({ policy: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── PUT /policy ───────────────────────────────────────────────────────────────
router.put('/', async (req, res, next) => {
  try {
    const { sensitivity_level, custom_allowlist, custom_blocklist } = req.body;

    // Validate sensitivity_level if provided
    if (sensitivity_level !== undefined && !VALID_SENSITIVITY.includes(sensitivity_level)) {
      return res.status(400).json({
        error: `sensitivity_level must be one of: ${VALID_SENSITIVITY.join(', ')}.`,
      });
    }

    // Validate arrays if provided
    if (custom_allowlist !== undefined) {
      if (
        !Array.isArray(custom_allowlist) ||
        custom_allowlist.some((v) => typeof v !== 'string')
      ) {
        return res.status(400).json({ error: 'custom_allowlist must be an array of strings.' });
      }
    }

    if (custom_blocklist !== undefined) {
      if (
        !Array.isArray(custom_blocklist) ||
        custom_blocklist.some((v) => typeof v !== 'string')
      ) {
        return res.status(400).json({ error: 'custom_blocklist must be an array of strings.' });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO policies (user_id, sensitivity_level, custom_allowlist, custom_blocklist)
       VALUES ($1, COALESCE($2, 'medium'), COALESCE($3, '{}'), COALESCE($4, '{}'))
       ON CONFLICT (user_id) DO UPDATE
         SET sensitivity_level = COALESCE($2, policies.sensitivity_level),
             custom_allowlist  = COALESCE($3, policies.custom_allowlist),
             custom_blocklist  = COALESCE($4, policies.custom_blocklist),
             updated_at        = NOW()
       RETURNING id, sensitivity_level, custom_allowlist, custom_blocklist, updated_at`,
      [
        req.user.id,
        sensitivity_level ?? null,
        custom_allowlist ?? null,
        custom_blocklist ?? null,
      ]
    );

    return res.json({ policy: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
