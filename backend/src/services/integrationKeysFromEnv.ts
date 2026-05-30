import { and, eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { userApiKeys } from '../db/schema.js';
import { encryptionService } from './encryptionService.js';
import type { IntegrationService } from './credentialResolver.js';

interface KeyEntry {
  name: string;
  service: IntegrationService;
  apiKey?: string | undefined;
  secretKey?: string | undefined;
  paperTrading?: boolean | undefined;
}

function keyEntry(
  name: string,
  service: IntegrationService,
  opts: { apiKey?: string | undefined; secretKey?: string | undefined; paperTrading?: boolean | undefined }
): KeyEntry {
  const entry: KeyEntry = { name, service };
  if (opts.apiKey !== undefined) entry.apiKey = opts.apiKey;
  if (opts.secretKey !== undefined) entry.secretKey = opts.secretKey;
  if (opts.paperTrading !== undefined) entry.paperTrading = opts.paperTrading;
  return entry;
}

function entriesFromEnv(): KeyEntry[] {
  return [
    keyEntry('Alpaca Paper Trading', 'alpaca', {
      apiKey: process.env.ALPACA_API_KEY,
      secretKey: process.env.ALPACA_API_SECRET || process.env.ALPACA_SECRET_KEY,
      paperTrading: process.env.ALPACA_PAPER_TRADING !== 'false',
    }),
    keyEntry('Finnhub Market Data', 'finnhub', { apiKey: process.env.FINNHUB_API_KEY }),
    keyEntry('Alpha Vantage', 'alphavantage', { apiKey: process.env.ALPHA_VANTAGE_API_KEY }),
    keyEntry('Reddit API', 'reddit', {
      apiKey: process.env.REDDIT_CLIENT_ID,
      secretKey: process.env.REDDIT_CLIENT_SECRET,
    }),
    keyEntry('NewsData.io', 'news', { apiKey: process.env.NEWSDATA_API_KEY }),
  ];
}

function complete(entry: KeyEntry): boolean {
  if (entry.service === 'alpaca' || entry.service === 'reddit') {
    return Boolean(entry.apiKey && entry.secretKey);
  }
  return Boolean(entry.apiKey);
}

/** Dev/runtime fallback when keys are not stored in DB yet. */
export function readIntegrationCredentialsFromEnv(
  service: IntegrationService
): { apiKey: string; secretKey?: string; paperTrading?: boolean } | null {
  const entry = entriesFromEnv().find((e) => e.service === service);
  if (!entry || !complete(entry)) return null;
  const creds: { apiKey: string; secretKey?: string; paperTrading?: boolean } = {
    apiKey: entry.apiKey!,
  };
  if (entry.secretKey !== undefined) creds.secretKey = entry.secretKey;
  if (entry.paperTrading !== undefined) creds.paperTrading = entry.paperTrading;
  return creds;
}

/** Import integration keys from environment into encrypted DB rows for a user. */
export async function importIntegrationKeysFromEnv(userId: string): Promise<number> {
  let imported = 0;

  for (const entry of entriesFromEnv()) {
    if (!complete(entry)) continue;

    const [existing] = await db
      .select({ id: userApiKeys.id })
      .from(userApiKeys)
      .where(
        and(
          eq(userApiKeys.userId, userId),
          eq(userApiKeys.service, entry.service),
          eq(userApiKeys.isActive, true)
        )
      )
      .limit(1);

    const payload = {
      name: entry.name,
      apiKeyEncrypted: encryptionService.encrypt(entry.apiKey!),
      secretKeyEncrypted: entry.secretKey
        ? encryptionService.encrypt(entry.secretKey)
        : null,
      paperTrading: entry.paperTrading ?? true,
      isActive: true,
    };

    if (existing) {
      await db.update(userApiKeys).set(payload).where(eq(userApiKeys.id, existing.id));
    } else {
      await db.insert(userApiKeys).values({ userId, service: entry.service, ...payload });
    }
    imported++;
  }

  return imported;
}
