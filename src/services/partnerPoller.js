'use strict';

/**
 * src/services/partnerPoller.js
 *
 * Background poller that runs every 5 minutes to execute partner-approved
 * change requests once their 72-hour delay has elapsed.
 *
 * Call start() after the Express server starts.
 * Call stop() for graceful shutdown (also used in tests).
 */

const pool  = require('../config/database');
const email = require('./email');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let _intervalId = null;

/**
 * Checks for approved change requests whose delay_until has passed and
 * executes the corresponding protection change.
 * Safe to call multiple times concurrently — uses FOR UPDATE SKIP LOCKED.
 */
async function executePendingChanges() {
  let client;
  try {
    client = await pool.connect();

    // Grab all approved requests past their delay, lock them to avoid
    // duplicate execution when multiple server instances run.
    const { rows: requests } = await client.query(`
      SELECT r.*, u.email AS user_email
      FROM   partner_change_requests r
      JOIN   users u ON u.id = r.user_id
      WHERE  r.status      = 'approved'
        AND  r.delay_until <= NOW()
        AND  r.executed_at IS NULL
      FOR UPDATE OF r SKIP LOCKED
    `);

    for (const req of requests) {
      try {
        await client.query('BEGIN');

        // Mark as executing to prevent duplicate runs.
        await client.query(
          `UPDATE partner_change_requests SET status = 'executing' WHERE id = $1`,
          [req.id],
        );

        await _executeChange(client, req);

        await client.query(
          `UPDATE partner_change_requests
           SET status = 'executed', executed_at = NOW()
           WHERE id = $1`,
          [req.id],
        );

        await client.query('COMMIT');
        console.log(`[poller] Executed change request ${req.id} (${req.request_type})`);

        // Notify the user and all active partners (non-blocking).
        _notifyExecution(req).catch((err) =>
          console.error('[poller] notification error:', err.message),
        );
      } catch (innerErr) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`[poller] Failed to execute request ${req.id}:`, innerErr.message);
      }
    }
  } catch (err) {
    console.error('[poller] executePendingChanges error:', err.message);
  } finally {
    if (client) client.release();
  }
}

// ── Change execution logic ────────────────────────────────────────────────────

async function _executeChange(client, req) {
  const payload = req.payload || {};

  switch (req.request_type) {
    case 'remove_protection':
      // Set all of this user's devices to inactive.
      await client.query(
        `UPDATE devices SET protection_active = FALSE WHERE user_id = $1`,
        [req.user_id],
      );
      break;

    case 'change_setting': {
      // payload: { sensitivity_level: 1|2|3 }
      const level = Number(payload.sensitivity_level);
      if (level >= 1 && level <= 3) {
        await client.query(
          `UPDATE policies SET sensitivity_level = $1 WHERE user_id = $2`,
          [level, req.user_id],
        );
      }
      break;
    }

    case 'allowlist_site': {
      // payload: { domain: 'example.com' }
      const domain = String(payload.domain || '').toLowerCase().trim();
      if (domain) {
        await client.query(
          `UPDATE policies
           SET    allowlist = array_append(allowlist, $1)
           WHERE  user_id   = $2
             AND  NOT (allowlist @> ARRAY[$1]::text[])`,
          [domain, req.user_id],
        );
      }
      break;
    }

    default:
      console.warn(`[poller] Unknown request_type: ${req.request_type}`);
  }
}

// ── Email notifications ───────────────────────────────────────────────────────

async function _notifyExecution(req) {
  const { rows: partners } = await pool.query(
    `SELECT partner_email FROM accountability_partners
     WHERE  user_id = $1 AND status = 'active'`,
    [req.user_id],
  );

  const promises = [
    email.approvalConfirmation(req.user_email, {
      changeType: req.request_type,
      delayUntil: req.delay_until,
    }),
    ...partners.map((p) =>
      email._send({
        to: p.partner_email,
        subject: `PORNBLOCK: An approved change has been applied`,
        html: `<p>The approved request to <strong>${req.request_type.replace(/_/g, ' ')}</strong>
               for your accountability partner has been executed after the 72-hour waiting
               period.</p>`,
      }),
    ),
  ];

  return Promise.allSettled(promises);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function start() {
  if (_intervalId) return; // already running
  // Run once immediately, then on the interval.
  executePendingChanges();
  _intervalId = setInterval(executePendingChanges, POLL_INTERVAL_MS);
  // Allow the process to exit even if the interval is still registered.
  if (_intervalId.unref) _intervalId.unref();
  console.log('[poller] Partner change-request poller started (5-min interval)');
}

function stop() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

module.exports = { start, stop, executePendingChanges };
