/**
 * Run sentiment analysis on existing DB rows (Reddit posts/comments + news articles)
 * where sentiment has not been computed yet (null sentiment_score / sentimentScore).
 *
 * Usage:
 *   npx tsx scripts/run_metadata_sentiment_batch.ts
 *   npx tsx scripts/run_metadata_sentiment_batch.ts --reddit-only
 *   npx tsx scripts/run_metadata_sentiment_batch.ts --news-only --news-batch=80
 *   npx tsx scripts/run_metadata_sentiment_batch.ts --reddit-batch=25 --max-reddit-passes=200
 *   npx tsx scripts/run_metadata_sentiment_batch.ts --max-reddit-items=5000 --max-news-items=2000
 */
import { redditOrchestrator } from '../src/services/redditOrchestrator.js';
import { newsSentimentAnalyzer } from '../src/services/newsSentimentAnalyzer.js';
import { closeConnection } from '../src/db/connection.js';

function numArg(flags: string[], fallback: number): number {
  for (const f of flags) {
    const i = process.argv.indexOf(f);
    if (i >= 0 && process.argv[i + 1]) {
      const v = Number(process.argv[i + 1]);
      if (!Number.isNaN(v) && v > 0) return v;
    }
    const kv = process.argv.find((a) => a.startsWith(`${f}=`));
    if (kv) {
      const v = Number(kv.split('=')[1]);
      if (!Number.isNaN(v) && v > 0) return v;
    }
  }
  return fallback;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function numArgOptional(flags: string[]): number | undefined {
  for (const f of flags) {
    const i = process.argv.indexOf(f);
    if (i >= 0 && process.argv[i + 1]) {
      const v = Number(process.argv[i + 1]);
      if (!Number.isNaN(v) && v >= 0) return v;
    }
    const kv = process.argv.find((a) => a.startsWith(`${f}=`));
    if (kv) {
      const v = Number(kv.split('=')[1]);
      if (!Number.isNaN(v) && v >= 0) return v;
    }
  }
  return undefined;
}

async function main() {
  const redditOnly = flag('--reddit-only');
  const newsOnly = flag('--news-only');
  const redditBatch = numArg(['--reddit-batch'], 30);
  const newsBatch = numArg(['--news-batch'], 50);
  const maxRedditPasses = numArg(['--max-reddit-passes'], 10_000);
  const maxNewsPasses = numArg(['--max-news-passes'], 10_000);
  const maxRedditItems = numArgOptional(['--max-reddit-items']);
  const maxNewsItems = numArgOptional(['--max-news-items']);

  let redditProcessed = 0;
  let newsProcessed = 0;
  let stockRowsFromNews = 0;
  let redditPasses = 0;
  let newsPasses = 0;

  if (!newsOnly) {
    const cap =
      maxRedditItems !== undefined
        ? `, stop after ~${maxRedditItems} items`
        : '';
    console.log(
      `Reddit: draining unanalyzed posts/comments (batch≈${redditBatch}, maxPasses=${maxRedditPasses}${cap})...`
    );
    for (; redditPasses < maxRedditPasses; redditPasses++) {
      const n = await redditOrchestrator.processPendingSentiment(redditBatch);
      redditProcessed += n;
      if (n === 0) break;
      if (maxRedditItems !== undefined && redditProcessed >= maxRedditItems) {
        console.log(`Reddit: reached --max-reddit-items=${maxRedditItems} (stopping)`);
        break;
      }
      if ((redditPasses + 1) % 5 === 0) {
        console.log(`  … reddit cumulative ${redditProcessed} (pass ${redditPasses + 1})`);
      }
    }
    if (redditPasses >= maxRedditPasses) {
      console.warn(`Reddit: stopped at max passes (${maxRedditPasses}); re-run if more rows remain.`);
    }
    console.log(`Reddit total processed this run: ${redditProcessed}`);
  }

  if (!redditOnly) {
    const cap =
      maxNewsItems !== undefined ? `, stop after ~${maxNewsItems} articles` : '';
    console.log(`News: draining unanalyzed articles (batch=${newsBatch}, maxPasses=${maxNewsPasses}${cap})...`);
    for (; newsPasses < maxNewsPasses; newsPasses++) {
      const out = await newsSentimentAnalyzer.processUnanalyzedNews(newsBatch);
      newsProcessed += out.processed;
      stockRowsFromNews += out.stockSentimentsStored;
      if (out.processed === 0) break;
      if (maxNewsItems !== undefined && newsProcessed >= maxNewsItems) {
        console.log(`News: reached --max-news-items=${maxNewsItems} (stopping)`);
        break;
      }
      if ((newsPasses + 1) % 5 === 0) {
        console.log(`  … news cumulative ${newsProcessed}, stock-sentiment inserts +${stockRowsFromNews} (pass ${newsPasses + 1})`);
      }
    }
    if (newsPasses >= maxNewsPasses) {
      console.warn(`News: stopped at max passes (${maxNewsPasses}); re-run if more rows remain.`);
    }
    console.log(`News total processed: ${newsProcessed}, failed (this batch path): see logs, stock sentiment rows stored: ${stockRowsFromNews}`);
  }

  await closeConnection();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
