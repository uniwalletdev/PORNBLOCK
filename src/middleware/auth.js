'use strict';

const jwt = require('jsonwebtoken');

/**
 * Verifies the Bearer JWT in the Authorization header.
 * Attaches the decoded payload to req.user on success.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  const token = authHeader.slice(7); // strip "Bearer "
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/**
 * Requires the authenticated user to have the 'admin' role.
 * Must be used AFTER authenticate().
 */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden — admin access required.' });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
