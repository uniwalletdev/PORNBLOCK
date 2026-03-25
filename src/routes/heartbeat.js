'use strict';

const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

// ── POST /heartbeat ───────────────────────────────────────────────────────────
// Device agents call this endpoint periodically to confirm protection is active.
router.post('/', async (req, res, next) => {
  try {
    const { device_id, protection_status } = req.body;

    if (!device_id) {
      return res.status(400).json({ error: 'device_id is required.' });
    }

    const VALID_STATUSES = ['active', 'inactive', 'tampered'];
    if (protection_status !== undefined && !VALID_STATUSES.includes(protection_status)) {
      return res.status(400).json({
        error: `protection_status must be one of: ${VALID_STATUSES.join(', ')}.`,
      });
    }

    // Ensure the device belongs to the authenticated user
    const { rows } = await pool.query(
      `UPDATE devices
       SET last_heartbeat    = NOW(),
           protection_status = COALESCE($1, protection_status)
       WHERE id = $2 AND user_id = $3
       RETURNING id, device_name, platform, protection_status, last_heartbeat`,
      [protection_status ?? null, device_id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Device not found or does not belong to this account.' });
    }

    return res.json({ device: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
