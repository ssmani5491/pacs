#!/bin/sh
set -e
echo "Applying database migrations..."
npx prisma migrate deploy
echo "Seeding (idempotent)..."
node dist/prisma/seed.js || echo "seed skipped"
echo "Starting backend..."
node dist/src/main.js
