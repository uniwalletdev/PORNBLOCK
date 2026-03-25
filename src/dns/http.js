'use strict';

const express            = require('express');
const { loadBlocklist }  = require('./cache');
const { authenticate, requireAdmin } = require('../middleware/auth');

const app = express();
app.use(express.json({ limit: '32kb' }));
app.disable('x-powered-by');

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── POST /blocklist/reload ────────────────────────────────────────────────────
// Re-reads the entire dns_blocklist + dns_allowlist tables and repopulates
// Redis without requiring a server restart.
// Requires a valid admin JWT in the Authorization header.
app.post('/blocklist/reload', authenticate, requireAdmin, async (req, res) => {
  try {
    await loadBlocklist();
    return res.json({ message: 'Blocklist reloaded successfully.' });
  } catch (err) {
    console.error('[DNS HTTP] Reload failed:', err.message);
    return res.status(500).json({ error: 'Failed to reload blocklist.' });
  }
});

module.exports = app;
