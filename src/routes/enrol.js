'use strict';

const express = require('express');
const QRCode  = require('qrcode');
const pool    = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const BASE_URL          = process.env.APP_BASE_URL || 'https://pornblock.app';
const TOKEN_EXPIRY_HOURS = 24;

// Platform install instructions returned to the setup page
const INSTALL_INSTRUCTIONS = {
  ios: {
    label:   'iOS',
    action:  'Download Profile',
    url:     `${BASE_URL}/downloads/pornblock.mobileconfig`,
    steps: [
      'Tap "Download Profile" below.',
      'Open Settings → General → VPN & Device Management.',
      'Tap the PORNBLOCK profile and choose Install.',
      'Restart Safari — protection is now active.',
    ],
  },
  android: {
    label:   'Android',
    action:  'Download APK',
    url:     `${BASE_URL}/downloads/pornblock.apk`,
    steps: [
      'Tap "Download APK" below.',
      'If prompted, allow installation from unknown sources.',
      'Open the downloaded file and install.',
      'Open PORNBLOCK and tap Activate.',
    ],
  },
  windows: {
    label:   'Windows',
    action:  'Download Installer',
    url:     `${BASE_URL}/downloads/pornblock-setup.exe`,
    steps: [
      'Click "Download Installer" below.',
      'Run the downloaded .exe and follow the setup wizard.',
      'PORNBLOCK will start automatically at login.',
    ],
  },
  mac: {
    label:   'macOS',
    action:  'Download Package',
    url:     `${BASE_URL}/downloads/pornblock.pkg`,
    steps: [
      'Click "Download Package" below.',
      'Open the .pkg and follow the installer.',
      'Allow the system extension in System Settings → Privacy & Security.',
    ],
  },
};

// ── POST /enrol/generate ─────────────────────────────────────────────────────
// Authenticated users create a single-use enrolment token for a new device.
router.post('/generate', authenticate, async (req, res, next) => {
  try {
    const { device_name, platform } = req.body;

    if (!device_name || typeof device_name !== 'string' || !device_name.trim()) {
      return res.status(400).json({ error: 'device_name is required.' });
    }

    const validPlatforms = Object.keys(INSTALL_INSTRUCTIONS);
    if (platform && !validPlatforms.includes(platform)) {
      return res.status(400).json({
        error: `platform must be one of: ${validPlatforms.join(', ')}.`,
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO enrolment_tokens (user_id, device_name, platform)
       VALUES ($1, $2, $3)
       RETURNING token, device_name, platform, expires_at`,
      [req.user.id, device_name.trim(), platform || null]
    );

    const { token, expires_at } = rows[0];
    const enrolment_url = `${BASE_URL}/setup?token=${token}`;

    // Generate QR as a data-URI so it can be embedded or returned directly
    const qr_data_url = await QRCode.toDataURL(enrolment_url, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 400,
    });

    return res.status(201).json({
      token,
      enrolment_url,
      qr_data_url,
      device_name: rows[0].device_name,
      platform:    rows[0].platform,
      expires_at,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /enrol/:token ────────────────────────────────────────────────────────
// Called by the setup page after the user scans the QR code.
// Returns device config + install instructions, then marks token used.
router.get('/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    // Basic UUID format guard — prevents expensive DB queries on junk input
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(token)) {
      return res.status(400).json({ error: 'Invalid token format.' });
    }

    const { rows } = await pool.query(
      `SELECT et.id, et.token, et.user_id, et.device_name, et.platform,
              et.used, et.expires_at,
              p.sensitivity_level, p.custom_allowlist, p.custom_blocklist
       FROM   enrolment_tokens et
       LEFT   JOIN policies p ON p.user_id = et.user_id
       WHERE  et.token = $1`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Enrolment token not found.' });
    }

    const row = rows[0];

    if (row.used) {
      return res.status(410).json({ error: 'This enrolment link has already been used.' });
    }

    if (new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This enrolment link has expired.' });
    }

    const instructions = row.platform
      ? INSTALL_INSTRUCTIONS[row.platform]
      : null;

    // Mark token as used in the same response path — single-use guarantee.
    // We update immediately so a race-condition double-submit gets rejected.
    await pool.query(
      `UPDATE enrolment_tokens SET used = TRUE, used_at = NOW() WHERE id = $1`,
      [row.id]
    );

    return res.json({
      device_name:  row.device_name,
      platform:     row.platform,
      policy: {
        sensitivity_level: row.sensitivity_level || 'medium',
        custom_allowlist:  row.custom_allowlist  || [],
        custom_blocklist:  row.custom_blocklist  || [],
      },
      instructions,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /enrol/:token/qr ─────────────────────────────────────────────────────
// Returns the QR code as a PNG image (for direct <img src=""> embedding
// or the "Download as PNG" button in the dashboard).
router.get('/:token/qr', authenticate, async (req, res, next) => {
  try {
    const { token } = req.params;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(token)) {
      return res.status(400).json({ error: 'Invalid token format.' });
    }

    // Confirm the token belongs to the requesting user
    const { rows } = await pool.query(
      `SELECT token, used, expires_at FROM enrolment_tokens
       WHERE token = $1 AND user_id = $2`,
      [token, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Token not found.' });
    }

    const { used, expires_at } = rows[0];
    if (used || new Date(expires_at) < new Date()) {
      return res.status(410).json({ error: 'Token is expired or already used.' });
    }

    const enrolment_url = `${BASE_URL}/setup?token=${token}`;

    // Stream a raw PNG response
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="pornblock-enrol-${token.slice(0, 8)}.png"`);
    res.setHeader('Cache-Control', 'no-store');

    await QRCode.toFileStream(res, enrolment_url, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 400,
      type: 'png',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
