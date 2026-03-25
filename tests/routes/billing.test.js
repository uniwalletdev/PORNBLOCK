'use strict';

/**
 * tests/routes/billing.test.js
 *
 * Unit/integration tests for the Stripe billing routes.
 *
 * Stripe is fully mocked — no real HTTP calls to Stripe are made.
 * The database IS used (test DB spun up by globalSetup.js).
 *
 * Tests:
 *   POST /billing/create-checkout-session  (5 cases)
 *   GET  /billing/portal                   (3 cases)
 *   POST /billing/webhook                  (5 cases)
 */

// ── Mock stripe BEFORE the app module loads ──────────────────────────────────
const mockCheckoutCreate   = jest.fn();
const mockPortalCreate     = jest.fn();
const mockConstructEvent   = jest.fn();
const mockCustomerCreate   = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: { create: mockCustomerCreate },
    checkout:  { sessions: { create: mockCheckoutCreate } },
    billingPortal: { sessions: { create: mockPortalCreate } },
    webhooks:  { constructEvent: mockConstructEvent },
  }));
});

process.env.NODE_ENV          = 'test';
process.env.STRIPE_SECRET          = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET  = 'whsec_mock';
process.env.STRIPE_PRICE_PERSONAL  = 'price_personal_mock';
process.env.STRIPE_PRICE_FAMILY    = 'price_family_mock';

const request = require('supertest');
const bcrypt  = require('bcrypt');
const { Pool } = require('pg');
const app     = require('../../src/app');

let pool;
let userId;
let userToken;
let userEmail;

beforeAll(async () => {
  pool = new Pool(global.__DB_CONFIG__);

  const hash = await bcrypt.hash('BillingTest1!', 4);
  const ts   = Date.now();
  userEmail  = `billing_${ts}@pornblock.local`;

  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [userEmail, hash],
  );
  userId = rows[0].id;

  const loginRes = await request(app)
    .post('/auth/login')
    .send({ email: userEmail, password: 'BillingTest1!' });
  userToken = loginRes.body.token;
});

afterAll(async () => {
  if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /billing/create-checkout-session
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /billing/create-checkout-session', () => {
  test('401 if not authenticated', async () => {
    const res = await request(app)
      .post('/billing/create-checkout-session')
      .send({ tier: 'personal' });
    expect(res.status).toBe(401);
  });

  test('400 if tier is missing', async () => {
    const res = await request(app)
      .post('/billing/create-checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tier/i);
  });

  test('400 if tier is invalid', async () => {
    const res = await request(app)
      .post('/billing/create-checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ tier: 'enterprise' });
    expect(res.status).toBe(400);
  });

  test('201 with checkout URL for personal tier (new customer)', async () => {
    mockCustomerCreate.mockResolvedValueOnce({ id: 'cus_mock_new' });
    mockCheckoutCreate.mockResolvedValueOnce({ url: 'https://checkout.stripe.com/pay/mock' });

    const res = await request(app)
      .post('/billing/create-checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ tier: 'personal' });

    expect(res.status).toBe(201);
    expect(res.body.url).toBe('https://checkout.stripe.com/pay/mock');
    expect(mockCustomerCreate).toHaveBeenCalledWith(
      expect.objectContaining({ email: userEmail }),
    );

    // stripe_customer_id should be persisted
    const { rows } = await pool.query(
      'SELECT stripe_customer_id FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0].stripe_customer_id).toBe('cus_mock_new');
  });

  test('201 with checkout URL for family tier (existing customer)', async () => {
    // customer already set from previous test — no create call expected
    mockCheckoutCreate.mockResolvedValueOnce({ url: 'https://checkout.stripe.com/pay/family_mock' });

    const res = await request(app)
      .post('/billing/create-checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ tier: 'family' });

    expect(res.status).toBe(201);
    expect(res.body.url).toBe('https://checkout.stripe.com/pay/family_mock');
    expect(mockCustomerCreate).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_mock_new' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /billing/portal
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /billing/portal', () => {
  test('401 if not authenticated', async () => {
    const res = await request(app).get('/billing/portal');
    expect(res.status).toBe(401);
  });

  test('400 if user has no stripe_customer_id', async () => {
    // Create a fresh user with no stripe_customer_id
    const hash = await bcrypt.hash('PortalTest1!', 4);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      [`portal_no_sub_${Date.now()}@pornblock.local`, hash],
    );
    const noSubId = rows[0].id;

    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email: `portal_no_sub_${rows[0].id}@pornblock.local`, password: 'PortalTest1!' });

    // Use the actual email stored
    const { rows: emailRow } = await pool.query('SELECT email FROM users WHERE id = $1', [noSubId]);
    const loginRes2 = await request(app)
      .post('/auth/login')
      .send({ email: emailRow[0].email, password: 'PortalTest1!' });
    const noSubToken = loginRes2.body.token;

    const res = await request(app)
      .get('/billing/portal')
      .set('Authorization', `Bearer ${noSubToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/subscription/i);

    await pool.query('DELETE FROM users WHERE id = $1', [noSubId]);
  });

  test('200 with portal URL for subscribed user', async () => {
    mockPortalCreate.mockResolvedValueOnce({ url: 'https://billing.stripe.com/session/mock' });

    const res = await request(app)
      .get('/billing/portal')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://billing.stripe.com/session/mock');
    expect(mockPortalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_mock_new' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /billing/webhook
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /billing/webhook', () => {
  const webhookHeaders = {
    'Content-Type': 'application/json',
    'stripe-signature': 'sig_mock',
  };

  test('400 on invalid Stripe signature', async () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });

    const res = await request(app)
      .post('/billing/webhook')
      .set(webhookHeaders)
      .send(Buffer.from(JSON.stringify({ type: 'checkout.session.completed' })));

    expect(res.status).toBe(400);
  });

  test('checkout.session.completed updates user to active', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          customer: 'cus_mock_new',
          customer_email: userEmail,
          subscription_data: { metadata: { tier: 'personal', pornblock_user_id: String(userId) } },
        },
      },
    };
    mockConstructEvent.mockReturnValueOnce(event);

    const res = await request(app)
      .post('/billing/webhook')
      .set(webhookHeaders)
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      'SELECT subscription_status, subscription_tier FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0].subscription_status).toBe('active');
    expect(rows[0].subscription_tier).toBe('personal');
  });

  test('customer.subscription.deleted cancels subscription', async () => {
    const event = {
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_mock_new', status: 'canceled' } },
    };
    mockConstructEvent.mockReturnValueOnce(event);

    const res = await request(app)
      .post('/billing/webhook')
      .set(webhookHeaders)
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      'SELECT subscription_status, subscription_tier FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0].subscription_status).toBe('canceled');
    expect(rows[0].subscription_tier).toBe('free');
  });

  test('invoice.payment_failed sets status to past_due', async () => {
    const event = {
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_mock_new' } },
    };
    mockConstructEvent.mockReturnValueOnce(event);

    const res = await request(app)
      .post('/billing/webhook')
      .set(webhookHeaders)
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      'SELECT subscription_status FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0].subscription_status).toBe('past_due');
  });

  test('customer.subscription.updated reflects new status', async () => {
    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          customer: 'cus_mock_new',
          status: 'active',
          items: { data: [{ price: { id: 'price_family_mock' } }] },
        },
      },
    };
    mockConstructEvent.mockReturnValueOnce(event);

    const res = await request(app)
      .post('/billing/webhook')
      .set(webhookHeaders)
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      'SELECT subscription_status, subscription_tier FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0].subscription_status).toBe('active');
    expect(rows[0].subscription_tier).toBe('family');
  });
});
