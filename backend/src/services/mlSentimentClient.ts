/**
 * ML Sentiment Client
 * HTTP client for the Python FinBERT service.
 * Used by both Reddit and News sentiment analyzers.
 * Gracefully falls back to keyword-based scoring when Python service is unavailable.
 */

import fetch from 'node-fetch';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

const ML_SERVICE_URL = process.env.ML_SENTIMENT_URL || 'http://localhost:8000';
/** Longer default for large GPU batches (matches python MAX_API_BATCH default 1024) */
const ML_REQUEST_TIMEOUT = parseInt(process.env.ML_TIMEOUT || '180000', 10);
/** Must stay ≤ Python `MAX_API_BATCH` (default 1024) */
const ML_MAX_TEXTS_PER_REQUEST = parseInt(process.env.ML_MAX_TEXTS_PER_REQUEST || '1024', 10);
const ML_URL_PROTOCOL = new URL(ML_SERVICE_URL).protocol;
const keepAliveHttpAgent = new HttpAgent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 });
const keepAliveHttpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 });

export interface MLSentimentScore {
  score: number;       // -1 to 1
  label: string;       // bullish / bearish / neutral / very_bullish / very_bearish
  confidence: number;  // 0 to 1
  positive: number;    // 0 to 1 probability
  negative: number;    // 0 to 1 probability
  neutral: number;     // 0 to 1 probability
  model: string;       // model name (e.g. ProsusAI/finbert)
}

export interface MLBatchResponse {
  results: MLSentimentScore[];
  model: string;
  count: number;
}

class MLSentimentClient {
  private available: boolean | null = null; // null = unknown, true/false = cached status
  private lastHealthCheck: number = 0;
  private healthCheckInterval = 60000; // Re-check every 60s
  private getKeepAliveAgent() {
    return ML_URL_PROTOCOL === 'https:' ? keepAliveHttpsAgent : keepAliveHttpAgent;
  }

  /**
   * Check if the ML service is available
   */
  async isAvailable(): Promise<boolean> {
    const now = Date.now();

    // Use cached status if checked recently
    if (this.available !== null && now - this.lastHealthCheck < this.healthCheckInterval) {
      return this.available;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const response = await fetch(`${ML_SERVICE_URL}/health`, {
        signal: controller.signal,
        agent: this.getKeepAliveAgent(),
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json() as { status?: string; services?: { sentiment_service?: boolean } };
        this.available = data?.status === 'healthy' && data?.services?.sentiment_service === true;
      } else {
        this.available = false;
      }
    } catch {
      this.available = false;
    }

    this.lastHealthCheck = now;
    return this.available;
  }

  /**
   * Analyze sentiment for a batch of texts using FinBERT.
   * Returns null if ML service is unavailable (caller should fall back to keyword-based).
   */
  async analyzeBatch(texts: string[]): Promise<MLSentimentScore[] | null> {
    if (texts.length === 0) return [];

    const serviceUp = await this.isAvailable();
    if (!serviceUp) return null;

    const merged: MLSentimentScore[] = [];
    const chunkSize = Math.max(1, ML_MAX_TEXTS_PER_REQUEST);

    for (let offset = 0; offset < texts.length; offset += chunkSize) {
      const slice = texts.slice(offset, offset + chunkSize);
      const part = await this.analyzeBatchChunk(slice);
      if (part === null) return null;
      merged.push(...part);
    }
    return merged;
  }

  private async analyzeBatchChunk(texts: string[]): Promise<MLSentimentScore[] | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ML_REQUEST_TIMEOUT);

      const response = await fetch(`${ML_SERVICE_URL}/api/ml/sentiment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts }),
        signal: controller.signal,
        agent: this.getKeepAliveAgent(),
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`ML sentiment service returned ${response.status}`);
        return null;
      }

      const data = await response.json() as MLBatchResponse;
      return data.results;
    } catch (error) {
      console.warn('ML sentiment service request failed:', error instanceof Error ? error.message : error);
      // Mark as unavailable so we don't keep hammering a down service
      this.available = false;
      this.lastHealthCheck = Date.now();
      return null;
    }
  }

  /**
   * Analyze sentiment for a single text.
   * Returns null if ML service is unavailable.
   */
  async analyzeText(text: string): Promise<MLSentimentScore | null> {
    const results = await this.analyzeBatch([text]);
    return results ? results[0] ?? null : null;
  }

  /**
   * Get model info from the ML service
   */
  async getModelInfo(): Promise<Record<string, unknown> | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${ML_SERVICE_URL}/api/stats`, {
        signal: controller.signal,
        agent: this.getKeepAliveAgent(),
      });
      clearTimeout(timeout);

      if (response.ok) {
        return await response.json() as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
}

export const mlSentimentClient = new MLSentimentClient();
