'use strict';

/**
 * src/routes/billing.js
 *
 * Stripe billing — three endpoints.
 *
 *  1.  POST  /billing/create-checkout-session  — create a Stripe Checkout session
 *  2.  GET   /billing/portal                   — Stripe Customer Portal session URL
 *  3.  POST  /billing/webhook                  — Stripe signed webhook (raw body)
 *
 * The webhook route must receive the raw body for signature verification.
 * It is registered in app.js with express.raw() BEFORE express.json().
 *
 * Supported webhook events:
 *   checkout.session.completed
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   invoice.payment_failed
 */

const express = require('express');
const Stripe  = require('stripe');
const pool    = require('../config/database');
const env     = require('../config/env');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Stripe client — lazily safe: if STRIPE_SECRET is absent the
// module still loads; only hit if actually used.
const stripe = env.STRIPE_SECRET ? new Stripe(env.STRIPE_SECRET, { apiVersion: '2024-04-10' }) : null;

// Tier → Stripe Price ID mapping.
const TIER_PRICES = {
  personal: env.STRIPE_PRICE_PERSONAL,
  family:   env.STRIPE_PRICE_FAMILY,
};

// ── helper: require Stripe keys, otherwise 503 ────────────────────────────────
function requireStripe(res) {
  if (!stripe) {
    res.status(503).json({ error: 'Billing is not configured on this server.' });
    return false;
  }
  return true;
}

// ── helper: get or create Stripe customer for a user ─────────────────────────
async function getOrCreateCustomer(userId, email) {
  const { rows } = await pool.query(
    'SELECT stripe_customer_id FROM users WHERE id = $1',
    [userId],
  );

  if (rows[0]?.stripe_customer_id) {
    return rows[0].stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email,
    metadata: { pornblock_user_id: String(userId) },
  });

  await pool.query(
    'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
    [customer.id, userId],
  );

  return customer.id;
}

// ── 1. POST /billing/create-checkout-session ──────────────────────────────────
router.post('/create-checkout-session', authenticate, async (req, res, next) => {
  if (!requireStripe(res)) return;

  try {
    const { tier } = req.body;

    if (!tier || !TIER_PRICES[tier]) {
      return res.status(400).json({ error: 'tier must be "personal" or "family".' });
    }

    const priceId = TIER_PRICES[tier];
    if (!priceId) {
      return res.status(503).json({ error: `Price for tier "${tier}" is not configured.` });
    }

    const customerId = await getOrCreateCustomer(req.user.id, req.user.email);

    // Build return URLs — fall back to Railway origin if FRONTEND_URL absent.
    const base = env.FRONTEND_URL || 'https://pornblock-production.up.railway.app';
    const successUrl = `${base}/dashboard?checkout=success`;
    const cancelUrl  = `${base}/dashboard?checkout=cancel`;

    const session = await stripe.checkout.sessions.create({
      customer:   customerId,
      mode:       'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url:  cancelUrl,
      // Pre-fill email so the user doesn't have to type it again.
      customer_email: customerId ? undefined : req.user.email,
      subscription_data: {
        metadata: { pornblock_user_id: String(req.user.id), tier },
      },
    });

    res.status(201).json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// ── 2. GET /billing/portal ────────────────────────────────────────────────────
router.get('/portal', authenticate, async (req, res, next) => {
  if (!requireStripe(res)) return;

  try {
    const { rows } = await pool.query(
      'SELECT stripe_customer_id FROM users WHERE id = $1',
      [req.user.id],
    );

    if (!rows[0]?.stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription found.' });
    }

    const base       = env.FRONTEND_URL || 'https://pornblock-production.up.railway.app';
    const returnUrl  = `${base}/dashboard`;

    const session = await stripe.billingPortal.sessions.create({
      customer:   rows[0].stripe_customer_id,
      return_url: returnUrl,
    });

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// ── 3. POST /billing/webhook ──────────────────────────────────────────────────
// NOTE: this route requires a raw (Buffer) body for signature verification.
// Register express.raw({ type: 'application/json' }) BEFORE express.json()
// in app.js, scoped only to this path.
router.post('/webhook', async (req, res) => {
  if (!stripe) return res.sendStatus(503);
  if (!env.STRIPE_WEBHOOK_SECRET) return res.sendStatus(503);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    // Invalid signature — reject immediately.
    return res.status(400).json({ error: `Webhook signature invalid: ${err.message}` });
  }

  try {
    await handleWebhookEvent(event);
    res.sendStatus(200);
  } catch (err) {
    // Return 500 so Stripe retries delivery.
    console.error('[billing/webhook] handler error:', err);
    res.sendStatus(500);
  }
});

// ── Webhook event dispatcher ──────────────────────────────────────────────────
async function handleWebhookEvent(event) {
  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode !== 'subscription') break;

      const customerId = session.customer;
      const tier = session.subscription_data?.metadata?.tier
        ?? session.metadata?.tier
        ?? null;

      await pool.query(
        `UPDATE users
            SET subscription_status = 'active',
                subscription_tier   = COALESCE($1, subscription_tier),
                stripe_customer_id  = $2
          WHERE stripe_customer_id  = $2
             OR (stripe_customer_id IS NULL AND email = $3)`,
        [tier, customerId, session.customer_email],
      );
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      await upsertSubscription(sub);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await pool.query(
        `UPDATE users
            SET subscription_status = 'canceled',
                subscription_tier   = 'free'
          WHERE stripe_customer_id  = $1`,
        [sub.customer],
      );
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      await pool.query(
        `UPDATE users
            SET subscription_status = 'past_due'
          WHERE stripe_customer_id  = $1`,
        [invoice.customer],
      );
      break;
    }

    default:
      // Unhandled event type — no-op (Stripe still gets 200).
      break;
  }
}

// ── Update user row from a subscription object ────────────────────────────────
async function upsertSubscription(sub) {
  // Resolve tier from the price ID in the subscription.
  const priceId = sub.items?.data?.[0]?.price?.id;
  let tier = null;
  if (priceId === env.STRIPE_PRICE_PERSONAL) tier = 'personal';
  else if (priceId === env.STRIPE_PRICE_FAMILY) tier = 'family';

  // Map Stripe statuses to our schema CHECK constraint values.
  const statusMap = {
    active:            'active',
    trialing:          'trialing',
    past_due:          'past_due',
    canceled:          'canceled',
    incomplete:        'past_due',
    incomplete_expired:'canceled',
    unpaid:            'unpaid',
    paused:            'past_due',
  };
  const status = statusMap[sub.status] ?? 'active';

  await pool.query(
    `UPDATE users
        SET subscription_status = $1,
            subscription_tier   = COALESCE($2, subscription_tier)
      WHERE stripe_customer_id  = $3`,
    [status, tier, sub.customer],
  );
}

module.exports = router;
