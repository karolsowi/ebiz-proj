/**
 * Full-database sentiment backfill (Reddit + news). Start the Python GPU service first.
 *
 * Examples:
 *   npx tsx scripts/sentiment_full_backfill.ts
 *   npx tsx scripts/sentiment_full_backfill.ts --workers=4 --shard=2
 *   npx tsx scripts/sentiment_full_backfill.ts --fetch-batch=512 --phases=reddit_comments,news
 *   npx tsx scripts/sentiment_full_backfill.ts --parallel-by-year --start-year=2020 --end-year=2025
 *
 * Env (optional):
 *   SENTIMENT_BACKFILL_FETCH_BATCH — default fetch size if --fetch-batch omitted (default 384)
 *   SENTIMENT_BACKFILL_ML_SUBBATCH — texts per GPU micro-batch (default 256; cap with ML_MAX_TEXTS_PER_REQUEST)
 *   SENTIMENT_BACKFILL_ANALYZE_CONCURRENCY — CPU post-ML concurrency (default 32)
 *   ML_MAX_TEXTS_PER_REQUEST — must stay ≤ Python MAX_API_BATCH (default 1024)
 *   SENTIMENT_BACKFILL_LOG_EVERY — progress log cadence (batches); use if npm swallows `--log-every`
 *   REDDIT_COMMENT_MIN_SCORE_SENTIMENT — ignore comments below this Reddit score for ML (default 20); override with --min-comment-score or SENTIMENT_BACKFILL_MIN_COMMENT_SCORE
 */
import { closeConnection } from '../src/db/connection.ts';
import { REDDIT_COMMENT_MIN_SCORE_SENTIMENT } from '../src/services/redditSentimentAnalyzer.ts';
import { runFullSentimentBackfill, runSqlPrewarm } from '../src/services/sentimentBackfillRunner.ts';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';

function numArg(keys: string[], fallback: number): number {
  for (const key of keys) {
    const i = process.argv.indexOf(key);
    if (i >= 0 && process.argv[i + 1]) {
      const v = parseInt(process.argv[i + 1], 10);
      if (!Number.isNaN(v)) return v;
    }
    const hit = process.argv.find((a) => a.startsWith(`${key}=`));
    if (hit) {
      const v = parseInt(hit.split('=')[1], 10);
      if (!Number.isNaN(v)) return v;
    }
  }
  return fallback;
}

async function main() {
  const workers = Math.max(1, numArg(['--workers'], 1));
  const shard = Math.max(0, numArg(['--shard'], 0));

  let phases: ('sql' | 'reddit_posts' | 'reddit_comments' | 'news')[] | undefined;
  const pIdx = process.argv.indexOf('--phases');
  if (pIdx >= 0 && process.argv[pIdx + 1]) {
    phases = process.argv[pIdx + 1].split(',').map((s) => s.trim()) as typeof phases;
  }

  const fetchBatch = numArg(
    ['--fetch-batch'],
    parseInt(process.env.SENTIMENT_BACKFILL_FETCH_BATCH || '384', 10),
  );
  const mlSubBatch = numArg(
    ['--ml-subbatch'],
    parseInt(process.env.SENTIMENT_BACKFILL_ML_SUBBATCH || '256', 10),
  );
  const analyzeConcurrency = numArg(
    ['--analyze-concurrency'],
    parseInt(process.env.SENTIMENT_BACKFILL_ANALYZE_CONCURRENCY || '32', 10),
  );
  const logEveryBatches = numArg(
    ['--log-every'],
    parseInt(process.env.SENTIMENT_BACKFILL_LOG_EVERY ?? '2', 10),
  );

  const minCommentScore = Math.max(
    0,
    numArg(
      ['--min-comment-score'],
      parseInt(process.env.SENTIMENT_BACKFILL_MIN_COMMENT_SCORE ?? String(REDDIT_COMMENT_MIN_SCORE_SENTIMENT), 10),
    ),
  );

  const parallelByYear = process.argv.includes('--parallel-by-year');
  const currentYear = new Date().getUTCFullYear();
  const startYear = numArg(['--start-year'], parseInt(process.env.SENTIMENT_BACKFILL_START_YEAR || '2020', 10));
  const endYear = numArg(['--end-year'], parseInt(process.env.SENTIMENT_BACKFILL_END_YEAR || String(currentYear), 10));
  const refreshMomentumView = !process.argv.includes('--no-refresh-momentum-view');

  console.log(
    '[sentiment_full_backfill] workers=%d shard=%d fetch=%d mlSub=%d analyzeConc=%d logEvery=%d minCommentScore=%d parallelByYear=%s',
    workers,
    shard,
    fetchBatch,
    mlSubBatch,
    analyzeConcurrency,
    logEveryBatches,
    minCommentScore,
    parallelByYear ? 'yes' : 'no',
  );
  console.log('[sentiment_full_backfill] ML service should be running (GPU: python-reddit-service, DEVICE=cuda).');

  const sharedOptions = {
    workers,
    shard,
    fetchBatch,
    mlSubBatch,
    analyzeConcurrency,
    logEveryBatches,
    minCommentScore,
    phases,
  };

  if (parallelByYear) {
    const years = [];
    for (let y = Math.min(startYear, endYear); y <= Math.max(startYear, endYear); y++) {
      years.push(y);
    }
    console.log(
      '[sentiment_full_backfill] Parallel per-year mode: %s',
      years.map((y) => String(y)).join(', '),
    );

    if (!process.argv.includes('--no-sql-prewarm')) {
      console.log('[sentiment_full_backfill] Running SQL prewarm once before worker threads.');
      await runSqlPrewarm(minCommentScore);
    }

    const scriptPath = fileURLToPath(import.meta.url);
    const workerPromises = years.map((year) => {
      return new Promise<void>((resolve, reject) => {
        const worker = new Worker(scriptPath, {
          execArgv: ['--import', 'tsx'],
          workerData: {
            mode: 'year',
            year,
            options: {
              ...sharedOptions,
              sqlPrewarm: false,
              refreshMomentumView: false,
            },
          },
        });
        worker.on('message', (msg) => {
          if (typeof msg === 'string') {
            console.log(msg);
          }
        });
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Year worker ${year} exited with code ${code}`));
        });
      });
    });

    await Promise.all(workerPromises);
    if (refreshMomentumView) {
      await runFullSentimentBackfill({
        ...sharedOptions,
        phases: [],
        sqlPrewarm: false,
        refreshMomentumView: true,
      });
    }

    console.log('[sentiment_full_backfill] done');
    await closeConnection();
    return;
  }

  await runFullSentimentBackfill({
    ...sharedOptions,
    sqlPrewarm: !process.argv.includes('--no-sql-prewarm'),
    refreshMomentumView,
  });

  console.log('[sentiment_full_backfill] done');
  await closeConnection();
}

if (!isMainThread && workerData?.mode === 'year') {
  const year = Number(workerData.year);
  const startDate = new Date(Date.UTC(year, 0, 1));
  const endDate = new Date(Date.UTC(year + 1, 0, 1));
  runFullSentimentBackfill({
    ...(workerData.options || {}),
    startDate,
    endDate,
  })
    .then(async () => {
      parentPort?.postMessage(`[sentiment_full_backfill][year=${year}] done`);
      await closeConnection();
    })
    .catch(async (e) => {
      parentPort?.postMessage(`[sentiment_full_backfill][year=${year}] failed: ${String(e)}`);
      await closeConnection();
      process.exit(1);
    });
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
