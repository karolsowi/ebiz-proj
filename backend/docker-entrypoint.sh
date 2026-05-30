#!/bin/sh
set -e

echo "Waiting for database..."
until node -e "
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);
sql\`SELECT 1\`.then(() => { sql.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  sleep 2
done

echo "Running migrations..."
npm run db:migrate

echo "Seeding demo data..."
npm run db:seed

echo "Importing API keys from environment (if present)..."
npm run keys:import-env || true

echo "Starting API server..."
exec npm run start
