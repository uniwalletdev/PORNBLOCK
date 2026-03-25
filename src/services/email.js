'use strict';

/**
 * src/services/email.js
 *
 * Thin wrapper around the Resend API.
 * All functions are fire-and-forget safe: they never throw — if the API key
 * is missing or a send fails, the error is logged and execution continues.
 *
 * Install: npm install resend
 * Env var: RESEND_API_KEY (optional — emails are skipped in dev if absent)
 *          EMAIL_FROM     (optional — defaults to 'PORNBLOCK <noreply@pornblock.app>')
 */

const { Resend } = require('resend');

const FROM = process.env.EMAIL_FROM || 'PORNBLOCK <noreply@pornblock.app>';

/** Lazy-initialised Resend client (avoids crash on startup if key absent). */
let _client = null;
function client() {
  if (!_client) {
    const key = process.env.RESEND_API_KEY;
    if (!key) return null;
    _client = new Resend(key);
  }
  return _client;
}

/**
 * Core send helper. Returns `{ skipped: true }` when no API key is configured.
 * @param {{ to: string, subject: string, html: string }} opts
 */
async function _send({ to, subject, html }) {
  const c = client();
  if (!c) {
    console.log(`[email] SKIP (no RESEND_API_KEY) → ${to}: ${subject}`);
    return { skipped: true };
  }
  try {
    return await c.emails.send({ from: FROM, to, subject, html });
  } catch (err) {
    console.error(`[email] Send failed → ${to}: ${err.message}`);
    return { error: err.message };
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Invitation email sent when a user adds an accountability partner.
 * @param {string} to  Partner's email address
 * @param {{ inviteUrl: string, inviterName: string }} opts
 */
async function partnerInvite(to, { inviteUrl, inviterName }) {
  return _send({
    to,
    subject: `You've been invited as an accountability partner on PORNBLOCK`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1e3a5f">Accountability Partner Invitation</h2>
        <p><strong>${escHtml(inviterName)}</strong> has invited you to be their accountability
           partner on <strong>PORNBLOCK</strong>.</p>
        <p>As an accountability partner you will:</p>
        <ul>
          <li>Receive notifications when a violation is detected</li>
          <li>Approve or deny requests to change protection settings</li>
          <li>Receive weekly progress reports</li>
        </ul>
        <p style="margin:24px 0">
          <a href="${escHtml(inviteUrl)}"
             style="display:inline-block;padding:12px 28px;background:#1e3a5f;color:#fff;
                    text-decoration:none;border-radius:6px;font-weight:600">
            Accept Invitation
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px">
          This link expires in 7 days. If you believe this was sent in error, you can ignore it.
        </p>
      </div>`,
  });
}

/**
 * Alert sent to all active partners when a violation is detected.
 * @param {string} partnerEmail
 * @param {{ userName: string, deviceName: string, confidence: number|null, violationType: string }} opts
 */
async function violationAlert(partnerEmail, { userName, deviceName, confidence, violationType }) {
  const confStr = confidence != null ? `${(confidence * 100).toFixed(1)}%` : 'N/A';
  return _send({
    to: partnerEmail,
    subject: `⚠️ PORNBLOCK: Violation detected on ${escHtml(deviceName)}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#dc2626">Violation Alert</h2>
        <p>A content violation was detected on <strong>${escHtml(userName)}</strong>'s device.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr style="background:#f3f4f6">
            <th style="padding:8px 12px;text-align:left;font-size:13px">Field</th>
            <th style="padding:8px 12px;text-align:left;font-size:13px">Value</th>
          </tr>
          <tr>
            <td style="padding:8px 12px;border-top:1px solid #e5e7eb">Device</td>
            <td style="padding:8px 12px;border-top:1px solid #e5e7eb">${escHtml(deviceName)}</td>
          </tr>
          <tr style="background:#f9fafb">
            <td style="padding:8px 12px;border-top:1px solid #e5e7eb">Type</td>
            <td style="padding:8px 12px;border-top:1px solid #e5e7eb">${escHtml(violationType)}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;border-top:1px solid #e5e7eb">Confidence</td>
            <td style="padding:8px 12px;border-top:1px solid #e5e7eb">${confStr}</td>
          </tr>
          <tr style="background:#f9fafb">
            <td style="padding:8px 12px;border-top:1px solid #e5e7eb">Time</td>
            <td style="padding:8px 12px;border-top:1px solid #e5e7eb">${new Date().toUTCString()}</td>
          </tr>
        </table>
        <p style="color:#6b7280;font-size:13px">
          You are receiving this because you are an accountability partner on PORNBLOCK.
        </p>
      </div>`,
  });
}

/**
 * Sent to each active partner when the user submits a change request.
 * @param {Array<{ email: string, action_token: string }>} partners
 * @param {{ user: string, request: object, approveUrl: Function, denyUrl: Function }} opts
 * approveUrl / denyUrl are called with the partner's action_token → return a string URL.
 */
async function requestNotification(partners, { user, request, approveUrl, denyUrl }) {
  return Promise.all(
    partners.map((partner) =>
      _send({
        to: partner.email,
        subject: `Action required: ${escHtml(String(user))} wants to change their PORNBLOCK settings`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:auto">
            <h2 style="color:#1e3a5f">Change Request — Your Approval Needed</h2>
            <p><strong>${escHtml(String(user))}</strong> has submitted a request and needs
               your approval before it can take effect.</p>
            <table style="border-collapse:collapse;width:100%;margin:16px 0">
              <tr><td style="padding:8px 12px;font-weight:600;width:140px">Type</td>
                  <td style="padding:8px 12px">${escHtml(request.request_type.replace(/_/g, ' '))}</td></tr>
              <tr style="background:#f9fafb">
                  <td style="padding:8px 12px;font-weight:600">Reason</td>
                  <td style="padding:8px 12px">${escHtml(request.reason)}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600">Submitted</td>
                  <td style="padding:8px 12px">${new Date(request.created_at).toUTCString()}</td></tr>
            </table>
            <p style="margin:24px 0">
              <a href="${escHtml(approveUrl(partner.action_token))}"
                 style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;
                        text-decoration:none;border-radius:6px;font-weight:600;margin-right:12px">
                ✓ Approve
              </a>
              <a href="${escHtml(denyUrl(partner.action_token))}"
                 style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;
                        text-decoration:none;border-radius:6px;font-weight:600">
                ✗ Deny
              </a>
            </p>
            <p style="color:#6b7280;font-size:13px">
              Note: If approved by a majority, the change will only take effect after a mandatory
              <strong>72-hour waiting period</strong> to prevent impulsive decisions.
              These links expire in 7 days.
            </p>
          </div>`,
      }),
    ),
  );
}

/**
 * Confirmation to the user when majority approval is reached and the 72-hour
 * clock starts.
 * @param {string} userEmail
 * @param {{ changeType: string, delayUntil: Date }} opts
 */
async function approvalConfirmation(userEmail, { changeType, delayUntil }) {
  return _send({
    to: userEmail,
    subject: `Your PORNBLOCK change request has been approved`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#16a34a">Change Request Approved</h2>
        <p>Your request to <strong>${escHtml(changeType.replace(/_/g, ' '))}</strong> has been
           approved by your accountability partners.</p>
        <p>Due to the mandatory 72-hour waiting period, the change will take effect at:</p>
        <p style="font-size:18px;font-weight:600;color:#1e3a5f">
          ${new Date(delayUntil).toUTCString()}
        </p>
        <p style="color:#6b7280;font-size:13px">
          This waiting period is in place to protect you from making impulsive decisions.
          If you change your mind, contact one of your accountability partners.
        </p>
      </div>`,
  });
}

/**
 * Notification to the user when a partner denies their change request.
 * @param {string} userEmail
 * @param {{ changeType: string, reason: string }} opts
 */
async function denialNotification(userEmail, { changeType, reason }) {
  return _send({
    to: userEmail,
    subject: `Your PORNBLOCK change request has been denied`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#dc2626">Change Request Denied</h2>
        <p>Your request to <strong>${escHtml(changeType.replace(/_/g, ' '))}</strong> has been
           denied by one of your accountability partners.</p>
        ${reason ? `<p><strong>Reason provided:</strong> ${escHtml(reason)}</p>` : ''}
        <p>If you have questions please speak directly with your accountability partner.</p>
      </div>`,
  });
}

/**
 * Weekly accountability report sent to each partner.
 * @param {string} partnerEmail
 * @param {{ userName: string, stats: { totalViolations: number, dnsBlocks: number, screenDetections: number, changeRequests: number } }} opts
 */
async function weeklyReport(partnerEmail, { userName, stats }) {
  return _send({
    to: partnerEmail,
    subject: `PORNBLOCK weekly report for ${escHtml(userName)}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1e3a5f">Weekly Accountability Report</h2>
        <p>Here is this week's activity summary for <strong>${escHtml(userName)}</strong>:</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="padding:10px 12px;text-align:left;font-size:13px">Metric</th>
              <th style="padding:10px 12px;text-align:right;font-size:13px">Count</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:10px 12px;border-top:1px solid #e5e7eb">Total violations</td>
              <td style="padding:10px 12px;border-top:1px solid #e5e7eb;text-align:right">${stats.totalViolations}</td>
            </tr>
            <tr style="background:#f9fafb">
              <td style="padding:10px 12px;border-top:1px solid #e5e7eb">DNS blocks</td>
              <td style="padding:10px 12px;border-top:1px solid #e5e7eb;text-align:right">${stats.dnsBlocks}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;border-top:1px solid #e5e7eb">Screen detections</td>
              <td style="padding:10px 12px;border-top:1px solid #e5e7eb;text-align:right">${stats.screenDetections}</td>
            </tr>
            <tr style="background:#f9fafb">
              <td style="padding:10px 12px;border-top:1px solid #e5e7eb">Change requests</td>
              <td style="padding:10px 12px;border-top:1px solid #e5e7eb;text-align:right">${stats.changeRequests}</td>
            </tr>
          </tbody>
        </table>
        <p style="color:#6b7280;font-size:13px">
          This report was generated automatically by PORNBLOCK. You are receiving this because
          you are an accountability partner.
        </p>
      </div>`,
  });
}

// ── Internal helper ───────────────────────────────────────────────────────────

/** Minimal HTML escaping to prevent injection in email bodies. */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  partnerInvite,
  violationAlert,
  requestNotification,
  approvalConfirmation,
  denialNotification,
  weeklyReport,
  // Exposed for testing
  _send,
};
