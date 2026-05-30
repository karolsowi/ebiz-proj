/**
 * Snoowrap OAuth client factory.
 *
 * All Reddit OAuth credentials come from encrypted `user_api_keys` rows.
 * Optional env (script-app, highest rate limits):
 *   REDDIT_USERNAME, REDDIT_PASSWORD, REDDIT_USER_AGENT
 */

import snoowrap from 'snoowrap';
import { getRedditCredentialsForUser } from './credentialResolver.js';
import { getApiKeysOwnerUserId } from '../constants/integration.js';

const USER_AGENT =
  process.env.REDDIT_USER_AGENT ||
  'InwestApp/1.0 (automated investment sentiment analysis; contact via app)';

const userClientCache = new Map<string, snoowrap | null>();

async function buildSnoowrap(clientId: string, clientSecret: string): Promise<snoowrap | null> {
  try {
    const username = process.env.REDDIT_USERNAME;
    const password = process.env.REDDIT_PASSWORD;

    if (username && password) {
      return new snoowrap({
        userAgent: USER_AGENT,
        clientId,
        clientSecret,
        username,
        password,
      });
    }

    return await (snoowrap as any).fromApplicationOnlyAuth({
      userAgent: USER_AGENT,
      clientId,
      clientSecret,
      permanent: true,
    });
  } catch (error) {
    console.error(
      '[Reddit] snoowrap initialisation failed:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/** Background jobs (backfill scheduler) — uses API key owner from encrypted DB. */
export async function getSnoowrapClient(): Promise<snoowrap | null> {
  return getSnoowrapClientForUser(getApiKeysOwnerUserId());
}

/** Per-user OAuth client from encrypted DB credentials. */
export async function getSnoowrapClientForUser(userId: string): Promise<snoowrap | null> {
  if (userClientCache.has(userId)) {
    return userClientCache.get(userId) ?? null;
  }

  const creds = await getRedditCredentialsForUser(userId);
  if (!creds?.secretKey) {
    userClientCache.set(userId, null);
    return null;
  }

  const client = await buildSnoowrap(creds.apiKey, creds.secretKey);
  userClientCache.set(userId, client);
  if (client) {
    console.log(`[Reddit] snoowrap client ready for user ${userId}`);
  }
  return client;
}

/** Reset cached clients (useful in tests). */
export function resetSnoowrapClient(): void {
  userClientCache.clear();
}
