'use strict';

/**
 * tests/setup/setEnvVars.js
 *
 * Listed under jest.setupFiles so it runs in EACH worker process before any
 * test file is loaded. Loads .env.test so all required vars are present in
 * every Jest worker process.
 */

const path = require('path');
// Load .env.test into this worker's process.env.
// Use __dirname so the path resolves correctly regardless of cwd.
require('dotenv').config({
  path: path.resolve(__dirname, '../../.env.test'),
  override: true,
});
