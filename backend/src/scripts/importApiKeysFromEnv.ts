/**
 * One-time dev helper: read integration keys from .env and store encrypted in DB.
 * After running, remove API keys from .env — runtime reads DB only.
 *
 *   npm run keys:import-env
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { importIntegrationKeysFromEnv } from '../services/integrationKeysFromEnv.js';
import { DEMO_USER_ID } from '../constants/integration.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

async function main() {
  const userId = process.env.API_KEYS_OWNER_USER_ID?.trim() || DEMO_USER_ID;
  const imported = await importIntegrationKeysFromEnv(userId);

  if (imported === 0) {
    console.log('No API keys found in .env — add keys under Account → API keys in the app.');
  } else {
    console.log(`Imported ${imported} key(s) into encrypted DB for user ${userId}.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
