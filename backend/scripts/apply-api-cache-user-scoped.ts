/**
 * Apply src/db/migrations/0008_user_scoped_cache.sql if the DB was created before user-scoped cache.
 * Run: npx tsx scripts/apply-api-cache-user-scoped.ts
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const url = rawUrl.replace(/^"|"$/g, '');

async function main() {
  const sqlPath = join(__dirname, '../src/db/migrations/0008_user_scoped_cache.sql');
  const mig = readFileSync(sqlPath, 'utf8');
  const client = postgres(url, { max: 1 });
  try {
    await client.unsafe(mig);
    console.log('Applied 0008_user_scoped_cache.sql (api_response_cache.user_id)');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
