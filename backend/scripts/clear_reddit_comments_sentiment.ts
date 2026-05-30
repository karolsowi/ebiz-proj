/**
 * Clear row-level FinBERT/lexicon fields on reddit_comments so they can be re-processed.
 * Does not touch reddit_comments.score (Reddit API score).
 *
 *   npx tsx scripts/clear_reddit_comments_sentiment.ts --dry-run
 *   npx tsx scripts/clear_reddit_comments_sentiment.ts --confirm --batch=50000
 */
import { client, closeConnection } from '../src/db/connection.js';

function num(key: string, fallback: number): number {
  const kv = process.argv.find((a) => a.startsWith(`${key}=`));
  if (kv) {
    const v = parseInt(kv.split('=')[1], 10);
    if (!Number.isNaN(v) && v > 0) return v;
  }
  return fallback;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const confirm = process.argv.includes('--confirm');
  const batchSize = num('--batch', 50_000);

  const [{ cnt }]: [{ cnt: string }] = await client`
    SELECT COUNT(*)::text AS cnt FROM reddit_comments WHERE sentiment_score IS NOT NULL
  `;
  console.log(`[clear_reddit_comments_sentiment] rows with sentiment populated: ${cnt}`);

  if (dryRun) {
    console.log('[clear_reddit_comments_sentiment] --dry-run: no updates.');
    return;
  }
  if (!confirm) {
    console.error('[clear_reddit_comments_sentiment] Pass --confirm to clear, or --dry-run.');
    process.exitCode = 1;
    return;
  }
  if (cnt === '0') {
    console.log('[clear_reddit_comments_sentiment] nothing to clear.');
    return;
  }

  let batches = 0;
  let total = 0;
  for (;;) {
    const cleared = await client`
      UPDATE reddit_comments AS r
      SET
        sentiment_score = NULL,
        sentiment_label = NULL,
        confidence_score = NULL,
        detected_stocks = NULL,
        detected_sectors = NULL,
        financial_relevance = NULL,
        last_updated = NOW()
      FROM (
        SELECT id FROM reddit_comments WHERE sentiment_score IS NOT NULL LIMIT ${batchSize}
      ) AS s
      WHERE r.id = s.id
      RETURNING r.id
    `;
    const n = cleared.length;
    if (n === 0) break;
    batches++;
    total += n;
    console.log(`[clear_reddit_comments_sentiment] batch ${batches}: cleared ${n} (total ${total})`);
  }
  console.log(`[clear_reddit_comments_sentiment] done. batches=${batches} rows≈${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnection();
  });
