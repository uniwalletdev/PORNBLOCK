'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

// ── POST /auth/register ──────────────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required.' });
    }

    // Basic email format check — full validation happens at DB unique constraint
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Role is always forced to 'standard_user' — no self-elevation possible
    const { rows } = await pool.query(
      `INSERT INTO accounts (email, password_hash, role)
       VALUES ($1, $2, 'standard_user')
       RETURNING id, email, role, created_at`,
      [email.toLowerCase().trim(), password_hash]
    );

    // Auto-create a default policy for the new user
    await pool.query(
      `INSERT INTO policies (user_id, sensitivity_level)
       VALUES ($1, 'medium')
       ON CONFLICT (user_id) DO NOTHING`,
      [rows[0].id]
    );

    return res.status(201).json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── POST /auth/login ─────────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required.' });
    }

    const { rows } = await pool.query(
      `SELECT id, email, password_hash, role FROM accounts WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    // Use a constant-time comparison path regardless of whether user exists
    // to prevent user-enumeration timing attacks
    const account = rows[0];
    const hashToCompare = account
      ? account.password_hash
      : '$2b$12$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

    const valid = await bcrypt.compare(password, hashToCompare);

    if (!account || !valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { id: account.id, email: account.email, role: account.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.json({ token });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
