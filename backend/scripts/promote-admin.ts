/**
 * Promote a user to admin role (PostgreSQL via Drizzle).
 *
 * Usage:
 *   npx tsx scripts/promote-admin.ts test@test.com
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

import { eq } from 'drizzle-orm';
import { db } from '../src/db/connection.js';
import { users } from '../src/db/schema.js';

const email = (process.argv[2] ?? 'test@test.com').trim().toLowerCase();

async function main(): Promise<void> {
  const updated = await db
    .update(users)
    .set({ role: 'admin', updatedAt: new Date() })
    .where(eq(users.email, email))
    .returning({ id: users.id, email: users.email, role: users.role });

  const row = updated[0];
  if (!row) {
    console.error(`❌ No user found with email: ${email}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✅ Admin role granted: ${row.email} (${row.id}) → role=${row.role}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
