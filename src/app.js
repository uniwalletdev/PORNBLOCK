'use strict';

require('dotenv').config();

const path    = require('node:path');
const express = require('express');

const authRoutes       = require('./routes/auth');
const deviceRoutes     = require('./routes/devices');
const policyRoutes     = require('./routes/policy');
const heartbeatRoutes  = require('./routes/heartbeat');
const violationRoutes  = require('./routes/violations');
const enrolRoutes      = require('./routes/enrol');
const errorHandler     = require('./middleware/errorHandler');

const app = express();

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false }));

// ── Static files (setup page, dashboard) ─────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Security: remove fingerprinting header ───────────────────────────────────
app.disable('x-powered-by');

// ── Health check (no auth) ───────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth',       authRoutes);
app.use('/devices',    deviceRoutes);
app.use('/policy',     policyRoutes);
app.use('/heartbeat',  heartbeatRoutes);
app.use('/violation',  violationRoutes);   // POST /violation
app.use('/violations', violationRoutes);   // GET  /violations  (admin)
app.use('/enrol',      enrolRoutes);       // POST /enrol/generate, GET /enrol/:token

// ── 404 fallthrough ──────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));

// ── Error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`PORNBLOCK API listening on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = app; // for testing
