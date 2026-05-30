/**
 * Background Reddit library import: runs on server start and on an interval.
 * Disabled with REDDIT_BACKFILL_DISABLED=true.
 */

import { runBackfillChunk } from './redditSmartBackfillService.js';

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let startupTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

export function startRedditBackfillScheduler(): void {
  if (process.env.REDDIT_BACKFILL_DISABLED === 'true') {
    console.log('📥 Reddit backfill scheduler: off (REDDIT_BACKFILL_DISABLED=true)');
    return;
  }

  const startupDelayMs = Math.max(
    2000,
    parseInt(process.env.REDDIT_BACKFILL_STARTUP_DELAY_MS || '10000', 10) || 10000
  );
  const intervalMs = Math.max(
    60_000,
    parseInt(process.env.REDDIT_BACKFILL_INTERVAL_MS || String(5 * 60 * 1000), 10) ||
      5 * 60 * 1000
  );
  const maxListing = Math.max(
    1,
    parseInt(process.env.REDDIT_BACKFILL_LISTING_BUDGET || '8', 10) || 8
  );
  const maxComments = Math.max(
    0,
    parseInt(process.env.REDDIT_BACKFILL_COMMENT_BUDGET || '3', 10) || 3
  );
  const fetchComments = process.env.REDDIT_BACKFILL_FETCH_COMMENTS !== 'false';
  const processSentiment = process.env.REDDIT_BACKFILL_SENTIMENT === 'true';

  const tick = () => {
    runBackfillChunk({
      maxListingRequests: maxListing,
      maxCommentFetches: maxComments,
      fetchComments,
      processSentiment,
    })
      .then((result) => {
        if (result.errors.length > 0) {
          console.warn(
            `[Reddit backfill] chunk finished with ${result.errors.length} issue(s):`,
            result.errors.slice(0, 2)
          );
        }
      })
      .catch((err) => {
        console.error('[Reddit backfill] chunk failed:', err);
      });
  };

  console.log(
    `\n📥 Reddit backfill scheduler: first chunk in ${startupDelayMs}ms, then every ${Math.round(intervalMs / 1000)}s`
  );

  startupTimeoutHandle = setTimeout(() => {
    startupTimeoutHandle = null;
    tick();
  }, startupDelayMs);

  intervalHandle = setInterval(tick, intervalMs);
}

export function stopRedditBackfillScheduler(): void {
  if (startupTimeoutHandle) {
    clearTimeout(startupTimeoutHandle);
    startupTimeoutHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
