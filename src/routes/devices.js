'use strict';

const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// All device routes require authentication
router.use(authenticate);

const VALID_PLATFORMS = ['ios', 'android', 'windows', 'mac'];

// ── GET /devices ─────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, device_name, platform, protection_status, last_heartbeat, enrolled_at
       FROM devices
       WHERE user_id = $1
       ORDER BY enrolled_at DESC`,
      [req.user.id]
    );
    return res.json({ devices: rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /devices ─────────────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { device_name, platform } = req.body;

    if (!device_name || !platform) {
      return res.status(400).json({ error: 'device_name and platform are required.' });
    }

    if (!VALID_PLATFORMS.includes(platform)) {
      return res.status(400).json({
        error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}.`,
      });
    }

    if (typeof device_name !== 'string' || device_name.trim().length === 0) {
      return res.status(400).json({ error: 'device_name must be a non-empty string.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO devices (user_id, device_name, platform)
       VALUES ($1, $2, $3)
       RETURNING id, device_name, platform, protection_status, last_heartbeat, enrolled_at`,
      [req.user.id, device_name.trim(), platform]
    );

    return res.status(201).json({ device: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
