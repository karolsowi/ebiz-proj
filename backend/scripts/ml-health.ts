/**
 * Pings the Python FinBERT ML sentiment service and reports its status.
 *
 * Usage:
 *   npm run ml:health
 *
 * Exits with non-zero code when the service is unreachable so this can be
 * used in CI / smoke tests.
 */

import 'dotenv/config';

const ML_SERVICE_URL = process.env.ML_SENTIMENT_URL || 'http://localhost:8000';
const TIMEOUT_MS = 5000;

async function main(): Promise<void> {
  console.log(`[ml:health] Checking ${ML_SERVICE_URL}/health ...`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${ML_SERVICE_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      console.error(`[ml:health] FAIL — HTTP ${response.status} ${response.statusText}`);
      process.exit(1);
    }

    const data = (await response.json()) as {
      status?: string;
      services?: { sentiment_service?: boolean };
      model?: string;
      version?: string;
    };

    const sentimentReady = data?.services?.sentiment_service === true;
    const overall = data?.status === 'healthy' && sentimentReady;

    console.log(`[ml:health] status:           ${data?.status ?? 'unknown'}`);
    console.log(`[ml:health] sentiment ready:  ${sentimentReady}`);
    if (data?.model) console.log(`[ml:health] model:            ${data.model}`);
    if (data?.version) console.log(`[ml:health] version:          ${data.version}`);

    if (!overall) {
      console.error('[ml:health] FAIL — FinBERT not ready. Start the Python service first.');
      process.exit(1);
    }

    console.log('[ml:health] OK — FinBERT is reachable and ready.');
    process.exit(0);
  } catch (error) {
    clearTimeout(timer);
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[ml:health] FAIL — ${reason}`);
    console.error(
      `[ml:health] Tip: cd python-reddit-service && python start.py (or set ML_SENTIMENT_URL to the correct host).`,
    );
    process.exit(1);
  }
}

main();
