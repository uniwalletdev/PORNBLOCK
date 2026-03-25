'use strict';

/**
 * Centralised error-handling middleware.
 * Must be registered LAST in the Express middleware chain.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Never leak internal details in production
  const isDev = process.env.NODE_ENV === 'development';

  // PostgreSQL unique-violation code
  if (err.code === '23505') {
    return res.status(409).json({ error: 'A record with that value already exists.' });
  }

  // PostgreSQL foreign-key violation
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced resource does not exist.' });
  }

  // PostgreSQL check-constraint violation
  if (err.code === '23514') {
    return res.status(400).json({ error: 'Value violates a database constraint.' });
  }

  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Internal server error.';

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${status}: ${err.message}`);

  res.status(status).json({
    error: message,
    ...(isDev && status === 500 && { stack: err.stack }),
  });
}

module.exports = errorHandler;
