/**
 * Physically DELETE reddit_comments where score < N (default 20).
 * Matches DB column reddit_comments.score (Reddit API net score, not UI "likes" only).
 *
 * Usage:
 *   npx tsx scripts/delete_reddit_comments_below_score.ts --dry-run
 *   npx tsx scripts/delete_reddit_comments_below_score.ts --confirm
 *   npx tsx scripts/delete_reddit_comments_below_score.ts --confirm --min-score=50 --batch=25000
 */
import { client, closeConnection } from '../src/db/connection.js';

function num(keys: string[], fallback: number): number {
  for (const k of keys) {
    const kv = process.argv.find((a) => a.startsWith(`${k}=`));
    if (kv) {
      const v = parseInt(kv.slice(k.length + 1), 10);
      if (!Number.isNaN(v)) return v;
    }
  }
  return fallback;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const confirm = process.argv.includes('--confirm');
  const minKeepScore = Math.max(
    0,
    num(['--min-score'], parseInt(process.env.REDDIT_COMMENT_MIN_SCORE_SENTIMENT ?? '20', 10)),
  );
  const batchSize = Math.max(100, num(['--batch'], 25000));

  const [{ cnt }]: [{ cnt: string }] = await client`
    SELECT COUNT(*)::text AS cnt FROM reddit_comments WHERE score < ${minKeepScore}
  `;

  const toDelete = BigInt(cnt);
  console.log(
    `[delete_reddit_comments_below_score] score < ${minKeepScore}: ${cnt} rows (batch=${dryRun ? 'dry-run only' : batchSize})`,
  );

  if (dryRun) {
    console.log('[delete_reddit_comments_below_score] --dry-run: no rows deleted.');
    return;
  }
  if (!confirm) {
    console.error('[delete_reddit_comments_below_score] Refusing without --confirm (or pass --dry-run).');
    process.exitCode = 1;
    return;
  }
  if (toDelete === 0n) {
    console.log('[delete_reddit_comments_below_score] nothing to delete.');
    return;
  }

  let batches = 0;
  let total = 0n;
  for (;;) {
    const removed = await client`
      DELETE FROM reddit_comments
      WHERE ctid IN (
        SELECT ctid FROM reddit_comments WHERE score < ${minKeepScore} LIMIT ${batchSize}
      )
      RETURNING id
    `;
    const n = removed.length;
    if (n === 0) break;
    batches++;
    total += BigInt(n);
    console.log(`[delete_reddit_comments_below_score] batch ${batches}: deleted ${n} (total ~${total.toString()} / ~${cnt})`);
  }

  console.log(`[delete_reddit_comments_below_score] done. deleted batches=${batches} rows≈${total.toString()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnection();
  });
