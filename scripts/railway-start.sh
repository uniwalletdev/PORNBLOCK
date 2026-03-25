#!/bin/bash
# Railway deploy entry point — run migrations then start the API.
set -e  # exit immediately on any error

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PORNBLOCK — Railway Deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "▶  Step 1/2: Running database migrations..."
npm run migrate
echo "✔  Migrations complete"

echo ""
echo "▶  Step 2/2: Starting API server..."
exec npm start
