'use strict';

const jwt      = require('jsonwebtoken');
const { getAuth } = require('@clerk/express');

/**
 * Dual-auth middleware:
 *  1. If a valid Clerk session is present (set by clerkMiddleware in app.js),
 *     the request is authenticated as an admin dashboard user.
 *  2. Otherwise the Bearer token is verified as a custom JWT (Android app devices).
 *
 * Sets req.user = { id, role, source } on success.
 */
function authenticate(req, res, next) {
  // ── Clerk path (dashboard users) ─────────────────────────────────────────
  const clerkAuth = getAuth(req);
  if (clerkAuth && clerkAuth.userId) {
    req.user = { id: clerkAuth.userId, role: 'admin', source: 'clerk' };
    return next();
  }

  // ── Custom JWT path (Android app / devices) ───────────────────────────────
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { ...payload, source: 'jwt' };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/**
 * Requires admin role — works for both Clerk and custom-JWT users.
 * Must be used AFTER authenticate().
 */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden — admin access required.' });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
