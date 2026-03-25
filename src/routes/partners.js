'use strict';

/**
 * src/routes/partners.js
 *
 * Accountability partner system — all 9 endpoints.
 *
 *  1.  POST   /partners/invite            — invite a partner by email
 *  2.  GET    /partners                   — list this user's partners
 *  3.  PUT    /partners/:id               — update partner role
 *  4.  DELETE /partners/:id               — remove a partner
 *  5.  POST   /partners/requests          — submit a change request
 *  6.  GET    /partners/requests          — list change requests
 *  7.  POST   /partners/requests/:id/approve — partner approves (token-based)
 *  8.  POST   /partners/requests/:id/deny   — partner denies  (token-based)
 *
 * Approve / deny are intentionally unauthenticated: partners receive a
 * per-request, per-partner action_token via email and click the link.
 */

const crypto  = require('node:crypto');
const express = require('express');
const pool    = require('../config/database');
const { authenticate } = require('../middleware/auth');
const email   = require('../services/email');

const router = express.Router();

const VALID_ROLES  = ['primary', 'standard', 'observer'];
const VALID_TYPES  = ['remove_protection', 'change_setting', 'allowlist_site'];
const EMAIL_RE     = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function secureToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── 1. POST /partners/invite ──────────────────────────────────────────────────
router.post('/invite', authenticate, async (req, res, next) => {
  try {
    const { email: partnerEmail, name, role = 'standard' } = req.body;

    if (!partnerEmail || !name) {
      return res.status(400).json({ error: 'email and name are required.' });
    }
    if (!EMAIL_RE.test(partnerEmail)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name must be a non-empty string.' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}.` });
    }

    const normalEmail = partnerEmail.toLowerCase().trim();

    // Prevent duplicate partner invitations.
    const { rows: existing } = await pool.query(
      `SELECT id FROM accountability_partners
       WHERE  user_id = $1 AND partner_email = $2`,
      [req.user.id, normalEmail],
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'This email is already one of your accountability partners.' });
    }

    const inviteToken = secureToken();
    const tokenExpiry = new Date(Date.now() + TOKEN_TTL_MS);

    const { rows } = await pool.query(
      `INSERT INTO accountability_partners
         (user_id, partner_email, partner_name, role, status, invite_token, invite_token_expires_at)
       VALUES ($1, $2, $3, $4, 'invited', $5, $6)
       RETURNING id, partner_name, partner_email, role, status, created_at`,
      [req.user.id, normalEmail, name.trim(), role, inviteToken, tokenExpiry],
    );

    const baseUrl   = process.env.FRONTEND_URL || 'https://pornblock.app';
    const inviteUrl = `${baseUrl}/accept-invite?token=${inviteToken}`;

    // Non-blocking — don't let an email failure abort the response.
    email.partnerInvite(normalEmail, { inviteUrl, inviterName: name.trim() })
      .catch((err) => console.error('[partners] invite email failed:', err.message));

    return res.status(201).json({ partner: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── 2. GET /partners ──────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, partner_name, partner_email, role, status,
              notify_violations, notify_tamper, created_at
       FROM   accountability_partners
       WHERE  user_id = $1
       ORDER  BY created_at ASC`,
      [req.user.id],
    );
    return res.json({ partners: rows });
  } catch (err) {
    next(err);
  }
});

// ── 3. PUT /partners/:id ──────────────────────────────────────────────────────
// Only the account owner (authenticated user) can change roles on their partners.
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}.` });
    }

    const { rows } = await pool.query(
      `UPDATE accountability_partners
       SET    role = $1
       WHERE  id = $2 AND user_id = $3
       RETURNING id, partner_name, partner_email, role, status`,
      [role, id, req.user.id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Partner not found.' });
    }
    return res.json({ partner: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── 4. DELETE /partners/:id ───────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify ownership.
    const { rows: owned } = await pool.query(
      `SELECT id FROM accountability_partners WHERE id = $1 AND user_id = $2`,
      [id, req.user.id],
    );
    if (owned.length === 0) {
      return res.status(404).json({ error: 'Partner not found.' });
    }

    // Must retain at least one partner.
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM accountability_partners WHERE user_id = $1`,
      [req.user.id],
    );
    if (cnt[0].cnt <= 1) {
      return res.status(409).json({ error: 'Cannot remove your last accountability partner.' });
    }

    await pool.query(
      `DELETE FROM accountability_partners WHERE id = $1 AND user_id = $2`,
      [id, req.user.id],
    );
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── 5. POST /partners/requests ────────────────────────────────────────────────
router.post('/requests', authenticate, async (req, res, next) => {
  try {
    const { request_type, reason, payload = {} } = req.body;

    if (!request_type || !VALID_TYPES.includes(request_type)) {
      return res.status(400).json({ error: `request_type must be one of: ${VALID_TYPES.join(', ')}.` });
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return res.status(400).json({ error: 'reason must be at least 10 characters.' });
    }

    // Need at least one active partner to receive the approval request.
    const { rows: partners } = await pool.query(
      `SELECT id, partner_email, partner_name
       FROM   accountability_partners
       WHERE  user_id = $1 AND status = 'active'`,
      [req.user.id],
    );
    if (partners.length === 0) {
      return res.status(400).json({
        error: 'You have no active accountability partners. Invite and activate at least one partner first.',
      });
    }

    // Create the change request.
    const { rows: reqRows } = await pool.query(
      `INSERT INTO partner_change_requests (user_id, request_type, reason, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.user.id, request_type, reason.trim(), JSON.stringify(payload)],
    );
    const changeRequest = reqRows[0];

    // Create one partner_actions row per partner with a unique action token.
    const tokenExpiry    = new Date(Date.now() + TOKEN_TTL_MS);
    const partnerTokens  = [];
    for (const p of partners) {
      const actionToken = secureToken();
      await pool.query(
        `INSERT INTO partner_actions
           (request_id, partner_id, action_token, token_expires_at)
         VALUES ($1, $2, $3, $4)`,
        [changeRequest.id, p.id, actionToken, tokenExpiry],
      );
      partnerTokens.push({ email: p.partner_email, action_token: actionToken });
    }

    // Email all partners (non-blocking).
    const baseUrl = process.env.FRONTEND_URL || 'https://pornblock.app';
    email.requestNotification(partnerTokens, {
      user:       req.user.id,
      request:    changeRequest,
      approveUrl: (tok) => `${baseUrl}/partner-action?token=${tok}&action=approve`,
      denyUrl:    (tok) => `${baseUrl}/partner-action?token=${tok}&action=deny`,
    }).catch((err) => console.error('[partners] request notification failed:', err.message));

    return res.status(201).json({ request: changeRequest });
  } catch (err) {
    next(err);
  }
});

// ── 6. GET /partners/requests ─────────────────────────────────────────────────
// Returns this user's change requests with a summary of partner votes.
router.get('/requests', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'partner_id', a.partner_id,
                  'action',     a.action,
                  'acted_at',   a.acted_at
                ))
                 FROM partner_actions a
                 WHERE a.request_id = r.id),
               '[]'::json
              ) AS partner_votes
       FROM   partner_change_requests r
       WHERE  r.user_id = $1
       ORDER  BY r.created_at DESC`,
      [req.user.id],
    );
    return res.json({ requests: rows });
  } catch (err) {
    next(err);
  }
});

// ── 7. POST /partners/requests/:id/approve ────────────────────────────────────
// No session auth required — partner uses their emailed action_token.
router.post('/requests/:id/approve', async (req, res, next) => {
  try {
    const { id }    = req.params;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'token is required.' });
    }

    // Validate action token — must belong to this request and not be expired or used.
    const { rows: actionRows } = await pool.query(
      `SELECT pa.*, ap.user_id AS owner_user_id
       FROM   partner_actions         pa
       JOIN   accountability_partners ap ON ap.id = pa.partner_id
       WHERE  pa.action_token    = $1
         AND  pa.request_id      = $2
         AND  pa.token_expires_at > NOW()`,
      [token, id],
    );
    if (actionRows.length === 0) {
      return res.status(401).json({ error: 'Invalid, expired, or already-used token.' });
    }
    const action = actionRows[0];

    if (action.action !== 'pending') {
      return res.status(409).json({ error: 'You have already responded to this request.' });
    }

    // Verify the request is still open.
    const { rows: reqRows } = await pool.query(
      `SELECT * FROM partner_change_requests WHERE id = $1 AND status = 'pending'`,
      [id],
    );
    if (reqRows.length === 0) {
      return res.status(404).json({ error: 'Request not found or no longer pending.' });
    }
    const changeRequest = reqRows[0];

    // Record the approval.
    await pool.query(
      `UPDATE partner_actions SET action = 'approved', acted_at = NOW() WHERE id = $1`,
      [action.id],
    );

    // Check whether majority has been reached.
    const { rows: totals } = await pool.query(
      `SELECT
         COUNT(*)                              FILTER (WHERE action = 'approved') AS approvals,
         COUNT(*)                                                                  AS total
       FROM partner_actions
       WHERE request_id = $1`,
      [id],
    );
    const approvals = parseInt(totals[0].approvals, 10);
    const total     = parseInt(totals[0].total, 10);
    const majority  = approvals > total / 2;

    if (majority) {
      const delayUntil = new Date(Date.now() + 72 * 60 * 60 * 1000);
      await pool.query(
        `UPDATE partner_change_requests
         SET    status = 'approved', delay_until = $1
         WHERE  id = $2`,
        [delayUntil, id],
      );

      // Notify the user that majority was reached and the clock is running.
      const { rows: userRows } = await pool.query(
        `SELECT email FROM users WHERE id = $1`,
        [changeRequest.user_id],
      );
      if (userRows.length > 0) {
        email.approvalConfirmation(userRows[0].email, {
          changeType: changeRequest.request_type,
          delayUntil,
        }).catch((err) => console.error('[partners] approval email failed:', err.message));
      }

      return res.json({
        message:     'Approved. Majority reached — change scheduled after 72-hour delay.',
        delay_until: delayUntil,
        approvals,
        total,
      });
    }

    return res.json({
      message:  'Approval recorded.',
      approvals,
      total,
      needed:   Math.ceil(total / 2 + 0.5) - approvals,
    });
  } catch (err) {
    next(err);
  }
});

// ── 8. POST /partners/requests/:id/deny ──────────────────────────────────────
// No session auth required — partner uses their emailed action_token.
router.post('/requests/:id/deny', async (req, res, next) => {
  try {
    const { id }                         = req.params;
    const { token, reason: denialReason = '' } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'token is required.' });
    }

    const { rows: actionRows } = await pool.query(
      `SELECT pa.*, ap.user_id AS owner_user_id
       FROM   partner_actions         pa
       JOIN   accountability_partners ap ON ap.id = pa.partner_id
       WHERE  pa.action_token    = $1
         AND  pa.request_id      = $2
         AND  pa.token_expires_at > NOW()`,
      [token, id],
    );
    if (actionRows.length === 0) {
      return res.status(401).json({ error: 'Invalid, expired, or already-used token.' });
    }
    const action = actionRows[0];

    if (action.action !== 'pending') {
      return res.status(409).json({ error: 'You have already responded to this request.' });
    }

    const { rows: reqRows } = await pool.query(
      `SELECT * FROM partner_change_requests WHERE id = $1 AND status = 'pending'`,
      [id],
    );
    if (reqRows.length === 0) {
      return res.status(404).json({ error: 'Request not found or no longer pending.' });
    }
    const changeRequest = reqRows[0];

    // Record the denial and close the request immediately.
    await pool.query(
      `UPDATE partner_actions
       SET action = 'denied', denial_reason = $1, acted_at = NOW()
       WHERE id = $2`,
      [denialReason.trim(), action.id],
    );

    await pool.query(
      `UPDATE partner_change_requests SET status = 'denied' WHERE id = $1`,
      [id],
    );

    // Notify the user immediately.
    const { rows: userRows } = await pool.query(
      `SELECT email FROM users WHERE id = $1`,
      [changeRequest.user_id],
    );
    if (userRows.length > 0) {
      email.denialNotification(userRows[0].email, {
        changeType: changeRequest.request_type,
        reason:     denialReason.trim(),
      }).catch((err) => console.error('[partners] denial email failed:', err.message));
    }

    return res.json({ message: 'Request denied. The user has been notified.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
