import { and, eq } from 'drizzle-orm';
import type { Response } from 'express';
import { db } from '../db/connection.js';
import { userApiKeys } from '../db/schema.js';
import { encryptionService } from './encryptionService.js';
import AlpacaApiService, { type AlpacaConfig } from './alpacaApi.js';
import { FinnhubAPI } from './finnhubApi.js';
import { AlphaVantageAPI } from './alphaVantageApi.js';

export type IntegrationService = 'alpaca' | 'finnhub' | 'alphavantage' | 'reddit' | 'news';

export interface ResolvedCredentials {
  apiKey: string;
  secretKey?: string | undefined;
  paperTrading?: boolean | undefined;
  source: 'database';
}

export type IntegrationStatusMap = Record<IntegrationService, boolean>;

const ALL_SERVICES: IntegrationService[] = [
  'alpaca',
  'finnhub',
  'alphavantage',
  'reddit',
  'news',
];

const SERVICE_LABELS: Record<IntegrationService, string> = {
  alpaca: 'Alpaca',
  finnhub: 'Finnhub',
  alphavantage: 'Alpha Vantage',
  reddit: 'Reddit',
  news: 'NewsData.io',
};

function credentialsComplete(
  service: IntegrationService,
  creds: ResolvedCredentials
): boolean {
  if (service === 'alpaca' || service === 'reddit') {
    return Boolean(creds.apiKey && creds.secretKey);
  }
  return Boolean(creds.apiKey);
}

/**
 * Load decrypted API credentials for a user from `user_api_keys` only.
 * Does not read `.env` — each user must have their own keys in the DB.
 */
export async function getUserCredentials(
  userId: string,
  service: IntegrationService
): Promise<ResolvedCredentials | null> {
  const [row] = await db
    .select()
    .from(userApiKeys)
    .where(
      and(
        eq(userApiKeys.userId, userId),
        eq(userApiKeys.service, service),
        eq(userApiKeys.isActive, true)
      )
    )
    .limit(1);

  if (!row?.apiKeyEncrypted) {
    return null;
  }

  try {
    const fromDb: ResolvedCredentials = {
      apiKey: encryptionService.decrypt(row.apiKeyEncrypted),
      secretKey: row.secretKeyEncrypted
        ? encryptionService.decrypt(row.secretKeyEncrypted)
        : undefined,
      paperTrading: row.paperTrading,
      source: 'database',
    };

    if (credentialsComplete(service, fromDb)) {
      return fromDb;
    }
    console.warn(`Incomplete ${service} credentials in DB for user ${userId}`);
  } catch (err) {
    console.error(`Failed to decrypt ${service} credentials for user ${userId}:`, err);
  }

  return null;
}

export async function hasUserIntegrationKeys(
  userId: string,
  service: IntegrationService
): Promise<boolean> {
  return (await getUserCredentials(userId, service)) !== null;
}

export async function getIntegrationStatus(userId: string): Promise<IntegrationStatusMap> {
  const entries = await Promise.all(
    ALL_SERVICES.map(async (service) => {
      const configured = await hasUserIntegrationKeys(userId, service);
      return [service, configured] as const;
    })
  );
  return Object.fromEntries(entries) as IntegrationStatusMap;
}

/** User can refresh live news if they have NewsData.io and/or Finnhub keys. */
export async function hasNewsFetchKeys(userId: string): Promise<boolean> {
  return (
    (await hasUserIntegrationKeys(userId, 'news')) ||
    (await hasUserIntegrationKeys(userId, 'finnhub'))
  );
}

export function credentialsMissingResponse(res: Response, service: IntegrationService): void {
  res.status(400).json({
    error: `${SERVICE_LABELS[service]} API keys not configured`,
    message: `Add your ${SERVICE_LABELS[service]} keys under Account → API keys.`,
    service,
    code: 'INTEGRATION_KEYS_MISSING',
  });
}

function buildAlpacaConfig(creds: ResolvedCredentials): AlpacaConfig {
  const paper = creds.paperTrading ?? true;
  return {
    apiKey: creds.apiKey,
    secretKey: creds.secretKey ?? '',
    baseUrl:
      process.env.ALPACA_BASE_URL ||
      (paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'),
    dataUrl: process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets',
    streamUrl: process.env.ALPACA_STREAM_URL || 'wss://stream.data.alpaca.markets/v2/iex',
    isPaper: paper,
  };
}

export async function getAlpacaClientForUser(userId: string): Promise<AlpacaApiService | null> {
  const creds = await getUserCredentials(userId, 'alpaca');
  if (!creds?.secretKey) return null;
  return new AlpacaApiService(buildAlpacaConfig(creds));
}

export async function getFinnhubClientForUser(userId: string): Promise<FinnhubAPI | null> {
  const creds = await getUserCredentials(userId, 'finnhub');
  if (!creds) return null;
  return new FinnhubAPI(creds.apiKey);
}

export async function getAlphaVantageClientForUser(userId: string): Promise<AlphaVantageAPI | null> {
  const creds = await getUserCredentials(userId, 'alphavantage');
  if (!creds) return null;
  return new AlphaVantageAPI(creds.apiKey);
}

export async function getRedditCredentialsForUser(
  userId: string
): Promise<ResolvedCredentials | null> {
  return getUserCredentials(userId, 'reddit');
}

export async function getNewsCredentialsForUser(
  userId: string
): Promise<ResolvedCredentials | null> {
  return getUserCredentials(userId, 'news');
}
