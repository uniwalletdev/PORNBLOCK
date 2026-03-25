'use strict';

const express = require('express');
const pool = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

const VALID_TYPES = ['dns_block', 'vision_classifier', 'app_filter', 'url_block'];

// ── POST /violation ───────────────────────────────────────────────────────────
// Called by device agents when a violation is detected.
router.post('/', async (req, res, next) => {
  try {
    const { device_id, violation_type, url, details } = req.body;

    if (!device_id || !violation_type) {
      return res.status(400).json({ error: 'device_id and violation_type are required.' });
    }

    if (!VALID_TYPES.includes(violation_type)) {
      return res.status(400).json({
        error: `violation_type must be one of: ${VALID_TYPES.join(', ')}.`,
      });
    }

    // Confirm device belongs to the authenticated user before logging
    const deviceCheck = await pool.query(
      `SELECT id FROM devices WHERE id = $1 AND user_id = $2`,
      [device_id, req.user.id]
    );

    if (deviceCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found or does not belong to this account.' });
    }

    // details must be a plain object if provided
    if (details !== undefined && (typeof details !== 'object' || Array.isArray(details))) {
      return res.status(400).json({ error: 'details must be a JSON object.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO violations (user_id, device_id, violation_type, url, details)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, violation_type, url, details, detected_at`,
      [req.user.id, device_id, violation_type, url ?? null, details ? JSON.stringify(details) : null]
    );

    return res.status(201).json({ violation: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── GET /violations ────────────────────────────────────────────────────────────
// Admins see all violations; standard users see only their own.
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    // Optional filters
    const { user_id, device_id, violation_type } = req.query;

    const conditions = [];
    const params = [];

    if (user_id) {
      params.push(user_id);
      conditions.push(`v.user_id = $${params.length}`);
    }
    if (device_id) {
      params.push(device_id);
      conditions.push(`v.device_id = $${params.length}`);
    }
    if (violation_type) {
      if (!VALID_TYPES.includes(violation_type)) {
        return res.status(400).json({
          error: `violation_type must be one of: ${VALID_TYPES.join(', ')}.`,
        });
      }
      params.push(violation_type);
      conditions.push(`v.violation_type = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT v.id,
              v.user_id,
              a.email       AS user_email,
              v.device_id,
              d.device_name,
              d.platform,
              v.violation_type,
              v.url,
              v.details,
              v.detected_at
       FROM violations v
       JOIN accounts a ON a.id = v.user_id
       JOIN devices  d ON d.id = v.device_id
       ${whereClause}
       ORDER BY v.detected_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    // Total count for pagination
    const countParams = params.slice(0, params.length - 2);
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS total FROM violations v ${whereClause}`,
      countParams
    );

    return res.json({
      violations: rows,
      pagination: {
        total: parseInt(countRows[0].total),
        page,
        limit,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
