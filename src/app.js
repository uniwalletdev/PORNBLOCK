'use strict';

// Load .env before anything else (no-op in production where vars are injected).
require('dotenv').config();
// Validate required env vars immediately — process.exit(1) if any are missing.
const env = require('./config/env');

const path    = require('node:path');
const express = require('express');
const cors    = require('cors');
const { clerkMiddleware } = require('@clerk/express');

const authRoutes       = require('./routes/auth');
const deviceRoutes     = require('./routes/devices');
const policyRoutes     = require('./routes/policy');
const heartbeatRoutes  = require('./routes/heartbeat');
const violationRoutes  = require('./routes/violations');
const enrolRoutes      = require('./routes/enrol');
const partnerRoutes    = require('./routes/partners');
const billingRoutes    = require('./routes/billing');
const errorHandler     = require('./middleware/errorHandler');

const app = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
// Production: explicit FRONTEND_URL(s) + any *.vercel.app preview URL.
// Development: localhost Vite dev server and the API itself.
const _isProd = env.NODE_ENV === 'production';
const _prodOrigins = env.FRONTEND_URL
  ? env.FRONTEND_URL.split(',').map((o) => o.trim()).filter(Boolean)
  : [];
const _devOrigins = ['http://localhost:5173', 'http://localhost:3000'];

const corsOptions = {
  origin(origin, callback) {
    // Server-to-server requests carry no Origin — always allow.
    if (!origin) return callback(null, true);

    // *.vercel.app covers all preview + production Vercel deployments.
    if (/^https:\/\/[^.]+\.vercel\.app$/.test(origin)) return callback(null, true);

    const allowed = _isProd ? _prodOrigins : _devOrigins;
    if (allowed.includes(origin)) return callback(null, true);

    callback(Object.assign(new Error('CORS: origin not allowed'), { status: 403 }));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

// ── Security: remove fingerprinting header ───────────────────────────────────
app.disable('x-powered-by');

// ── Health check (no auth, no middleware — must be first) ───────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// Handle OPTIONS preflight for every route before any other middleware hits.
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// ── Clerk auth context (non-blocking — populates req.auth for all routes)
// Must come AFTER cors so preflight requests are never rejected by Clerk.
// In test mode skip Clerk: tests use JWT auth and Clerk requires a live key.
if (env.NODE_ENV !== 'test') {
  app.use(clerkMiddleware());
}

// ── Body parsing ─────────────────────────────────────────────────────────────
// Stripe webhooks require the raw body to verify their HMAC signature.
// Register the raw middleware BEFORE express.json(), scoped only to that path.
app.use('/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false }));

// ── Static files (setup page, dashboard) ─────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));


// ── Env check (development only — never exposes values, only presence) ───────
if (env.NODE_ENV !== 'production') {
  app.get('/env-check', (_req, res) => {
    const vars = ['DATABASE_URL', 'JWT_SECRET', 'REDIS_URL', 'NODE_ENV', 'PORT',
                  'FRONTEND_URL', 'DNS_PORT', 'STRIPE_SECRET'];
    const result = Object.fromEntries(vars.map((k) => [k, !!process.env[k]]));
    res.json(result);
  });
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth',       authRoutes);
app.use('/devices',    deviceRoutes);
app.use('/policy',     policyRoutes);
app.use('/heartbeat',  heartbeatRoutes);
app.use('/violation',  violationRoutes);   // POST /violation
app.use('/violations', violationRoutes);   // GET  /violations  (admin)
app.use('/enrol',      enrolRoutes);       // POST /enrol/generate, GET /enrol/:token
app.use('/partners',   partnerRoutes);     // Full accountability partner system
app.use('/billing',    billingRoutes);     // Stripe billing: checkout, portal, webhook

// ── 404 fallthrough ──────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));

// ── Error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────────────────
// Skip listen() in test mode — supertest attaches directly to the app instance,
// and binding the port in every test file would cause EADDRINUSE.
if (env.NODE_ENV !== 'test') {
  const PORT = env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PORNBLOCK API listening on port ${PORT} [${env.NODE_ENV}]`);
    require('./services/partnerPoller').start();
  });
}

module.exports = app; // for testing
