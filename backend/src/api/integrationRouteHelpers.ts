import type { Request, Response } from 'express';
import type AlpacaApiService from '../services/alpacaApi.js';
import type { FinnhubAPI } from '../services/finnhubApi.js';
import type { AlphaVantageAPI } from '../services/alphaVantageApi.js';
import {
  credentialsMissingResponse,
  getAlpacaClientForUser,
  getFinnhubClientForUser,
  getAlphaVantageClientForUser,
  hasUserIntegrationKeys,
  hasNewsFetchKeys,
} from '../services/credentialResolver.js';

export function integrationUserId(req: Request): string {
  return req.user!.userId;
}

export async function requireAlpacaClient(
  req: Request,
  res: Response
): Promise<AlpacaApiService | null> {
  const client = await getAlpacaClientForUser(integrationUserId(req));
  if (!client) {
    credentialsMissingResponse(res, 'alpaca');
    return null;
  }
  return client;
}

export async function requireFinnhubClient(
  req: Request,
  res: Response
): Promise<FinnhubAPI | null> {
  const client = await getFinnhubClientForUser(integrationUserId(req));
  if (!client) {
    credentialsMissingResponse(res, 'finnhub');
    return null;
  }
  return client;
}

export async function requireAlphaVantageClient(
  req: Request,
  res: Response
): Promise<AlphaVantageAPI | null> {
  const client = await getAlphaVantageClientForUser(integrationUserId(req));
  if (!client) {
    credentialsMissingResponse(res, 'alphavantage');
    return null;
  }
  return client;
}

export async function requireRedditCredentials(req: Request, res: Response): Promise<boolean> {
  if (!(await hasUserIntegrationKeys(integrationUserId(req), 'reddit'))) {
    credentialsMissingResponse(res, 'reddit');
    return false;
  }
  return true;
}

export async function requireNewsFetchCredentials(req: Request, res: Response): Promise<boolean> {
  if (!(await hasNewsFetchKeys(integrationUserId(req)))) {
    res.status(400).json({
      error: 'News API keys not configured',
      message:
        'Add NewsData.io and/or Finnhub keys under Account → API keys to fetch new headlines.',
      service: 'news',
      code: 'INTEGRATION_KEYS_MISSING',
    });
    return false;
  }
  return true;
}
