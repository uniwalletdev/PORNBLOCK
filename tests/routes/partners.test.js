'use strict';

/**
 * tests/routes/partners.test.js
 *
 * Integration tests for the accountability partner system.
 * Covers: invite, list, update, delete, change-requests, approve, deny,
 * and the 72-hour delay executor (partnerPoller).
 *
 * Email is mocked — no real HTTP calls are made.
 */

// Mock the email service before app is loaded.
jest.mock('../../src/services/email', () => ({
  partnerInvite:        jest.fn().mockResolvedValue({ skipped: true }),
  violationAlert:       jest.fn().mockResolvedValue({ skipped: true }),
  requestNotification:  jest.fn().mockResolvedValue([{ skipped: true }]),
  approvalConfirmation: jest.fn().mockResolvedValue({ skipped: true }),
  denialNotification:   jest.fn().mockResolvedValue({ skipped: true }),
  weeklyReport:         jest.fn().mockResolvedValue({ skipped: true }),
  _send:                jest.fn().mockResolvedValue({ skipped: true }),
}));

process.env.NODE_ENV = 'test';

const request = require('supertest');
const bcrypt  = require('bcrypt');
const { Pool } = require('pg');
const app     = require('../../src/app');
const { executePendingChanges } = require('../../src/services/partnerPoller');
const emailMock = require('../../src/services/email');

let pool;
// IDs created in beforeAll — cleaned up in afterAll.
let userId;
let userId2;
let userToken;  // JWT for userId
let user2Token; // JWT for userId2

beforeAll(async () => {
  pool = new Pool(global.__DB_CONFIG__);

  // Create two test users.
  const hash = await bcrypt.hash('TestPass123!', 4);

  const { rows: u1 } = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [`partner_u1_${Date.now()}@pornblock.local`, hash],
  );
  userId = u1[0].id;

  const { rows: u2 } = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [`partner_u2_${Date.now()}@pornblock.local`, hash],
  );
  userId2 = u2[0].id;

  // Obtain JWTs for both users via the /auth/login route.
  // We need to know what email we registered with — store it.
  const { rows: u1Row } = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
  const { rows: u2Row } = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId2]);

  const loginRes1 = await request(app)
    .post('/auth/login')
    .send({ email: u1Row[0].email, password: 'TestPass123!' });
  userToken = loginRes1.body.token;

  const loginRes2 = await request(app)
    .post('/auth/login')
    .send({ email: u2Row[0].email, password: 'TestPass123!' });
  user2Token = loginRes2.body.token;
});

afterAll(async () => {
  // Cascade deletes will clean related rows.
  if (userId)  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  if (userId2) await pool.query(`DELETE FROM users WHERE id = $1`, [userId2]);
  await pool.end();
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /partners/invite
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /partners/invite', () => {
  let createdPartnerId;

  afterEach(async () => {
    if (createdPartnerId) {
      await pool.query(`DELETE FROM accountability_partners WHERE id = $1`, [createdPartnerId]);
      createdPartnerId = null;
    }
  });

  it('creates a partner and sends invite email', async () => {
    const res = await request(app)
      .post('/partners/invite')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ email: 'partner@example.com', name: 'Alice', role: 'primary' });

    expect(res.status).toBe(201);
    expect(res.body.partner).toMatchObject({
      partner_email: 'partner@example.com',
      partner_name:  'Alice',
      role:          'primary',
      status:        'invited',
    });
    createdPartnerId = res.body.partner.id;
    expect(emailMock.partnerInvite).toHaveBeenCalledWith(
      'partner@example.com',
      expect.objectContaining({ inviteUrl: expect.stringContaining('accept-invite?token=') }),
    );
  });

  it('normalises email to lowercase', async () => {
    const res = await request(app)
      .post('/partners/invite')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ email: 'CAPS@Example.COM', name: 'Bob' });

    expect(res.status).toBe(201);
    expect(res.body.partner.partner_email).toBe('caps@example.com');
    createdPartnerId = res.body.partner.id;
  });

  it('rejects invalid email', async () => {
    const res = await request(app)
      .post('/partners/invite')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ email: 'not-an-email', name: 'Eve' });
    expect(res.status).toBe(400);
  });

  it('rejects missing name', async () => {
    const res = await request(app)
      .post('/partners/invite')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ email: 'ok@example.com' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid role', async () => {
    const res = await request(app)
      .post('/partners/invite')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ email: 'ok2@example.com', name: 'Carol', role: 'superadmin' });
    expect(res.status).toBe(400);
  });

  it('409 on duplicate email for same user', async () => {
    const firstRes = await request(app)
      .post('/partners/invite')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ email: 'dup@example.com', name: 'First' });
    expect(firstRes.status).toBe(201);
    createdPartnerId = firstRes.body.partner.id;

    const dupRes = await request(app)
      .post('/partners/invite')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ email: 'dup@example.com', name: 'Duplicate' });
    expect(dupRes.status).toBe(409);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/partners/invite')
      .send({ email: 'anon@example.com', name: 'Anon' });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /partners
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /partners', () => {
  let pId;

  beforeAll(async () => {
    const { rows } = await pool.query(
      `INSERT INTO accountability_partners (user_id, partner_email, partner_name)
       VALUES ($1, 'listtest@example.com', 'ListUser') RETURNING id`,
      [userId],
    );
    pId = rows[0].id;
  });

  afterAll(async () => {
    if (pId) await pool.query(`DELETE FROM accountability_partners WHERE id = $1`, [pId]);
  });

  it('returns partners for the authenticated user', async () => {
    const res = await request(app)
      .get('/partners')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    const emails = res.body.partners.map((p) => p.partner_email);
    expect(emails).toContain('listtest@example.com');
  });

  it('does not return partners from another user', async () => {
    const res = await request(app)
      .get('/partners')
      .set('Authorization', `Bearer ${user2Token}`);
    expect(res.status).toBe(200);
    const emails = res.body.partners.map((p) => p.partner_email);
    expect(emails).not.toContain('listtest@example.com');
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/partners')).status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. PUT /partners/:id
// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /partners/:id', () => {
  let pId;

  beforeAll(async () => {
    const { rows } = await pool.query(
      `INSERT INTO accountability_partners (user_id, partner_email, partner_name, role)
       VALUES ($1, 'roletest@example.com', 'RoleUser', 'standard') RETURNING id`,
      [userId],
    );
    pId = rows[0].id;
  });

  afterAll(async () => {
    if (pId) await pool.query(`DELETE FROM accountability_partners WHERE id = $1`, [pId]);
  });

  it('updates role', async () => {
    const res = await request(app)
      .put(`/partners/${pId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ role: 'observer' });
    expect(res.status).toBe(200);
    expect(res.body.partner.role).toBe('observer');
  });

  it('rejects invalid role', async () => {
    const res = await request(app)
      .put(`/partners/${pId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ role: 'godmode' });
    expect(res.status).toBe(400);
  });

  it('404 for another user\'s partner', async () => {
    const res = await request(app)
      .put(`/partners/${pId}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ role: 'primary' });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. DELETE /partners/:id
// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /partners/:id', () => {
  it('removes a partner when at least 2 exist', async () => {
    // Create 2 partners first.
    const { rows: p1 } = await pool.query(
      `INSERT INTO accountability_partners (user_id, partner_email, partner_name)
       VALUES ($1, 'del1@example.com', 'Del1') RETURNING id`,
      [userId],
    );
    const { rows: p2 } = await pool.query(
      `INSERT INTO accountability_partners (user_id, partner_email, partner_name)
       VALUES ($1, 'del2@example.com', 'Del2') RETURNING id`,
      [userId],
    );

    const res = await request(app)
      .delete(`/partners/${p1[0].id}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(204);

    // Clean up the remaining one.
    await pool.query(`DELETE FROM accountability_partners WHERE id = $1`, [p2[0].id]);
  });

  it('409 when removing the last partner', async () => {
    // Ensure exactly 1 partner exists for userId.
    await pool.query(`DELETE FROM accountability_partners WHERE user_id = $1`, [userId]);
    const { rows: p } = await pool.query(
      `INSERT INTO accountability_partners (user_id, partner_email, partner_name)
       VALUES ($1, 'last@example.com', 'LastOne') RETURNING id`,
      [userId],
    );

    const res = await request(app)
      .delete(`/partners/${p[0].id}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/last/i);

    // Clean up.
    await pool.query(`DELETE FROM accountability_partners WHERE id = $1`, [p[0].id]);
  });

  it('404 for another user\'s partner', async () => {
    const { rows: p } = await pool.query(
      `INSERT INTO accountability_partners (user_id, partner_email, partner_name)
       VALUES ($1, 'other_del@example.com', 'Other') RETURNING id`,
      [userId],
    );

    const res = await request(app)
      .delete(`/partners/${p[0].id}`)
      .set('Authorization', `Bearer ${user2Token}`);
    expect(res.status).toBe(404);

    await pool.query(`DELETE FROM accountability_partners WHERE id = $1`, [p[0].id]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5–8. Change request workflow  (request → approve/deny)
// ─────────────────────────────────────────────────────────────────────────────
describe('Change request workflow', () => {
  // Set up: user has one active partner with a known ID.
  let activePartnerId;
  let requestId;
  let actionToken;

  beforeAll(async () => {
    await pool.query(`DELETE FROM accountability_partners WHERE user_id = $1`, [userId]);
    const { rows: p } = await pool.query(
      `INSERT INTO accountability_partners
         (user_id, partner_email, partner_name, role, status)
       VALUES ($1, 'active_partner@example.com', 'Active Partner', 'primary', 'active')
       RETURNING id`,
      [userId],
    );
    activePartnerId = p[0].id;
  });

  afterAll(async () => {
    if (activePartnerId) {
      await pool.query(`DELETE FROM accountability_partners WHERE id = $1`, [activePartnerId]);
    }
  });

  // ── 5. POST /partners/requests ────────────────────────────────────────────
  describe('POST /partners/requests', () => {
    it('creates a request and emails partners', async () => {
      const res = await request(app)
        .post('/partners/requests')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          request_type: 'allowlist_site',
          reason:       'I need to access this site for my job search.',
          payload:      { domain: 'linkedin.com' },
        });

      expect(res.status).toBe(201);
      expect(res.body.request).toMatchObject({
        request_type: 'allowlist_site',
        status:       'pending',
      });
      requestId = res.body.request.id;

      // Fetch the action token for the partner from the DB.
      const { rows: actionRows } = await pool.query(
        `SELECT action_token FROM partner_actions WHERE request_id = $1 AND partner_id = $2`,
        [requestId, activePartnerId],
      );
      expect(actionRows.length).toBe(1);
      actionToken = actionRows[0].action_token;

      expect(emailMock.requestNotification).toHaveBeenCalledTimes(1);
    });

    it('400 when request_type is invalid', async () => {
      const res = await request(app)
        .post('/partners/requests')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ request_type: 'hack_everything', reason: 'This should fail completely.' });
      expect(res.status).toBe(400);
    });

    it('400 when reason is too short', async () => {
      const res = await request(app)
        .post('/partners/requests')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ request_type: 'allowlist_site', reason: 'Short.' });
      expect(res.status).toBe(400);
    });

    it('400 when user has no active partners', async () => {
      const res = await request(app)
        .post('/partners/requests')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ request_type: 'change_setting', reason: 'User 2 has no partners at all.' });
      expect(res.status).toBe(400);
    });
  });

  // ── 6. GET /partners/requests ─────────────────────────────────────────────
  describe('GET /partners/requests', () => {
    it('returns pending requests with partner_votes', async () => {
      const res = await request(app)
        .get('/partners/requests')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.requests)).toBe(true);
      const found = res.body.requests.find((r) => r.id === requestId);
      expect(found).toBeDefined();
      expect(Array.isArray(found.partner_votes)).toBe(true);
    });

    it('does not return another user\'s requests', async () => {
      const res = await request(app)
        .get('/partners/requests')
        .set('Authorization', `Bearer ${user2Token}`);
      expect(res.status).toBe(200);
      const ids = res.body.requests.map((r) => r.id);
      expect(ids).not.toContain(requestId);
    });
  });

  // ── 7. POST /partners/requests/:id/approve ────────────────────────────────
  describe('POST /partners/requests/:id/approve', () => {
    it('records approval — majority reached on single partner', async () => {
      const res = await request(app)
        .post(`/partners/requests/${requestId}/approve`)
        .send({ token: actionToken });

      expect(res.status).toBe(200);
      // Single partner = 1/1 = majority immediately.
      expect(res.body.message).toMatch(/majority/i);
      expect(res.body.delay_until).toBeDefined();
      expect(emailMock.approvalConfirmation).toHaveBeenCalledTimes(1);
    });

    it('401 with invalid token', async () => {
      const res = await request(app)
        .post(`/partners/requests/${requestId}/approve`)
        .send({ token: 'invalid_garbage_token_00000000' });
      expect(res.status).toBe(401);
    });

    it('409 when token already used', async () => {
      // The token was used in the previous test case.
      const res = await request(app)
        .post(`/partners/requests/${requestId}/approve`)
        .send({ token: actionToken });
      expect(res.status).toBe(409);
    });

    it('400 when token is missing', async () => {
      const res = await request(app)
        .post(`/partners/requests/${requestId}/approve`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  // ── 8. POST /partners/requests/:id/deny ──────────────────────────────────
  describe('POST /partners/requests/:id/deny', () => {
    let denyRequestId;
    let denyToken;

    beforeAll(async () => {
      // Create a fresh pending request.
      const { rows: r } = await pool.query(
        `INSERT INTO partner_change_requests (user_id, request_type, reason)
         VALUES ($1, 'change_setting', 'I want to lower my sensitivity settings for research.')
         RETURNING id`,
        [userId],
      );
      denyRequestId = r[0].id;

      const tok = require('node:crypto').randomBytes(32).toString('hex');
      await pool.query(
        `INSERT INTO partner_actions (request_id, partner_id, action_token, token_expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')`,
        [denyRequestId, activePartnerId, tok],
      );
      denyToken = tok;
    });

    afterAll(async () => {
      if (denyRequestId) {
        await pool.query(`DELETE FROM partner_change_requests WHERE id = $1`, [denyRequestId]);
      }
    });

    it('denies the request and notifies user', async () => {
      const res = await request(app)
        .post(`/partners/requests/${denyRequestId}/deny`)
        .send({ token: denyToken, reason: 'This is not a valid reason to lower protection.' });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/denied/i);
      expect(emailMock.denialNotification).toHaveBeenCalledTimes(1);

      const { rows } = await pool.query(
        `SELECT status FROM partner_change_requests WHERE id = $1`,
        [denyRequestId],
      );
      expect(rows[0].status).toBe('denied');
    });

    it('400 when token is missing', async () => {
      const res = await request(app)
        .post(`/partners/requests/${denyRequestId}/deny`)
        .send({});
      expect(res.status).toBe(400);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. 72-hour delay poller (executePendingChanges)
// ─────────────────────────────────────────────────────────────────────────────
describe('partnerPoller.executePendingChanges()', () => {
  let pollUserId;
  let pollRequestId;

  beforeAll(async () => {
    // Create a dedicated user with a policy for the poller tests.
    const hash = await bcrypt.hash('TestPass123!', 4);
    const { rows: u } = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      [`poller_${Date.now()}@pornblock.local`, hash],
    );
    pollUserId = u[0].id;

    // Ensure a policy row exists so the allowlist_site change has somewhere to go.
    await pool.query(
      `INSERT INTO policies (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [pollUserId],
    );
  });

  afterAll(async () => {
    if (pollUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [pollUserId]);
  });

  afterEach(async () => {
    if (pollRequestId) {
      await pool.query(`DELETE FROM partner_change_requests WHERE id = $1`, [pollRequestId]);
      pollRequestId = null;
    }
  });

  it('executes an approved allowlist_site request past its delay', async () => {
    // Insert an approved request with delay_until in the past.
    const { rows } = await pool.query(
      `INSERT INTO partner_change_requests
         (user_id, request_type, reason, status, payload, delay_until)
       VALUES ($1, 'allowlist_site', 'Long enough reason for allowlist.', 'approved',
               '{"domain":"linkedin.com"}'::jsonb, NOW() - INTERVAL '1 second')
       RETURNING id`,
      [pollUserId],
    );
    pollRequestId = rows[0].id;

    await executePendingChanges();

    const { rows: updated } = await pool.query(
      `SELECT status, executed_at FROM partner_change_requests WHERE id = $1`,
      [pollRequestId],
    );
    expect(updated[0].status).toBe('executed');
    expect(updated[0].executed_at).not.toBeNull();
  });

  it('does NOT execute a request whose delay has not elapsed', async () => {
    const { rows } = await pool.query(
      `INSERT INTO partner_change_requests
         (user_id, request_type, reason, status, payload, delay_until)
       VALUES ($1, 'change_setting', 'Changing sensitivity for legitimate reason.', 'approved',
               '{"sensitivity_level":1}'::jsonb, NOW() + INTERVAL '1 hour')
       RETURNING id`,
      [pollUserId],
    );
    pollRequestId = rows[0].id;

    await executePendingChanges();

    const { rows: unchanged } = await pool.query(
      `SELECT status FROM partner_change_requests WHERE id = $1`,
      [pollRequestId],
    );
    expect(unchanged[0].status).toBe('approved'); // unchanged
  });

  it('executes a remove_protection request and deactivates devices', async () => {
    // Insert a device for this user.
    const { rows: dev } = await pool.query(
      `INSERT INTO devices (user_id, device_name, platform, device_token, protection_active)
       VALUES ($1, 'Test Device', 'android', $2, TRUE) RETURNING id`,
      [pollUserId, require('node:crypto').randomBytes(16).toString('hex')],
    );
    const devId = dev[0].id;

    const { rows: req } = await pool.query(
      `INSERT INTO partner_change_requests
         (user_id, request_type, reason, status, payload, delay_until)
       VALUES ($1, 'remove_protection', 'Needs protection removed for family reason.', 'approved',
               '{}'::jsonb, NOW() - INTERVAL '1 second')
       RETURNING id`,
      [pollUserId],
    );
    pollRequestId = req[0].id;

    await executePendingChanges();

    const { rows: dev2 } = await pool.query(
      `SELECT protection_active FROM devices WHERE id = $1`,
      [devId],
    );
    expect(dev2[0].protection_active).toBe(false);

    await pool.query(`DELETE FROM devices WHERE id = $1`, [devId]);
  });
});
