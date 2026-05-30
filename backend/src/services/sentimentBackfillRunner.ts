/**
 * High-throughput sentiment backfill over existing reddit_posts / reddit_comments / news_articles.
 * Uses ML batch API + parallel CPU (lexicon / detection) with bounded DB writes afterward.
 */
import { and, count, desc, eq, getTableColumns, gte, isNull, sql } from 'drizzle-orm';
import { client, db } from '../db/connection.js';
import { newsArticles, redditComments, redditPosts } from '../db/schema.js';
import type { MLSentimentScore } from './mlSentimentClient.js';
import { mlSentimentClient } from './mlSentimentClient.js';
import { newsSentimentAnalyzer } from './newsSentimentAnalyzer.js';
import { redditSentimentAnalyzer, buildCommentWithPostContext, REDDIT_COMMENT_MIN_SCORE_SENTIMENT } from './redditSentimentAnalyzer.js';

export interface BackfillRunnerOptions {
  /** Split work across parallel processes: 0 .. workers-1 */
  workers: number;
  shard: number;
  fetchBatch: number;
  mlSubBatch: number;
  analyzeConcurrency: number;
  logEveryBatches: number;
  /** Reddit comment.score must be ≥ this for ML/backfill (default from REDDIT_COMMENT_MIN_SCORE_SENTIMENT, usually 20). */
  minCommentScore: number;
  /** If true, run cheap SQL updates before row-by-row phases */
  sqlPrewarm: boolean;
  /** Optional UTC date range filter (inclusive start, exclusive end). */
  startDate?: Date;
  endDate?: Date;
  /** Refresh sentiment momentum materialized view at end of run. */
  refreshMomentumView: boolean;
}

const DEFAULTS: BackfillRunnerOptions = {
  workers: 1,
  shard: 0,
  fetchBatch: 256,
  /** Match Node ML_MAX_TEXTS_PER_REQUEST / Python micro-batch (GPU-friendly) */
  mlSubBatch: Math.min(512, parseInt(process.env.SENTIMENT_BACKFILL_ML_SUBBATCH || '128', 10)),
  analyzeConcurrency: Math.min(32, parseInt(process.env.SENTIMENT_BACKFILL_ANALYZE_CONCURRENCY || '24', 10)),
  logEveryBatches: 5,
  minCommentScore: REDDIT_COMMENT_MIN_SCORE_SENTIMENT,
  sqlPrewarm: true,
  refreshMomentumView: true,
};

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.min(Math.max(1, concurrency), items.length);

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function shardPosts() {
  const w = opts.workers;
  const s = opts.shard;
  return w > 1
    ? sql`mod(abs(hashtext(${redditPosts.id}::text)), ${w}) = ${s}`
    : sql`true`;
}

function dateRangePosts() {
  if (opts.startDate && opts.endDate) {
    return and(gte(redditPosts.created, opts.startDate), sql`${redditPosts.created} < ${opts.endDate}`);
  }
  if (opts.startDate) return gte(redditPosts.created, opts.startDate);
  if (opts.endDate) return sql`${redditPosts.created} < ${opts.endDate}`;
  return undefined;
}

function shardComments() {
  const w = opts.workers;
  const s = opts.shard;
  return w > 1
    ? sql`mod(abs(hashtext(${redditComments.id}::text)), ${w}) = ${s}`
    : sql`true`;
}

function dateRangeComments() {
  if (opts.startDate && opts.endDate) {
    return and(gte(redditComments.created, opts.startDate), sql`${redditComments.created} < ${opts.endDate}`);
  }
  if (opts.startDate) return gte(redditComments.created, opts.startDate);
  if (opts.endDate) return sql`${redditComments.created} < ${opts.endDate}`;
  return undefined;
}

function shardNews() {
  const w = opts.workers;
  const s = opts.shard;
  return w > 1
    ? sql`mod(abs(${newsArticles.id}::bigint), ${w}) = ${s}`
    : sql`true`;
}

function dateRangeNews() {
  if (opts.startDate && opts.endDate) {
    return and(gte(newsArticles.publishedAt, opts.startDate), sql`${newsArticles.publishedAt} < ${opts.endDate}`);
  }
  if (opts.startDate) return gte(newsArticles.publishedAt, opts.startDate);
  if (opts.endDate) return sql`${newsArticles.publishedAt} < ${opts.endDate}`;
  return undefined;
}

let opts = DEFAULTS;

function formatBacklogProgress(processedRows: number, backlogAtPhaseStart: number): string {
  if (backlogAtPhaseStart <= 0) return `${processedRows} processed (was 0 at phase start)`;
  const remaining = Math.max(0, backlogAtPhaseStart - processedRows);
  const pct = Math.min(99.99, Math.max(0, (processedRows / backlogAtPhaseStart) * 100));
  return `${processedRows}/${backlogAtPhaseStart} (${remaining} left ~${pct.toFixed(1)}%)`;
}

async function countRedditPostsBacklog(): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(redditPosts)
    .where(and(isNull(redditPosts.sentimentScore), shardPosts(), dateRangePosts()));
  return Number(row?.c ?? 0);
}

async function countRedditCommentsBacklog(): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(redditComments)
    .where(
      and(
        isNull(redditComments.sentimentScore),
        sql`length(trim(${redditComments.content})) > 20`,
        gte(redditComments.score, opts.minCommentScore),
        shardComments(),
        dateRangeComments(),
      ),
    );
  return Number(row?.c ?? 0);
}

async function countNewsBacklog(): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(newsArticles)
    .where(and(isNull(newsArticles.sentimentScore), shardNews(), dateRangeNews()));
  return Number(row?.c ?? 0);
}

function applyShardOptions(o: Partial<BackfillRunnerOptions>) {
  const workers = Math.max(1, o.workers ?? DEFAULTS.workers);
  let shard = Math.max(0, o.shard ?? DEFAULTS.shard);
  if (shard >= workers) {
    console.warn(`[sentiment-backfill] shard ${shard} >= workers ${workers}; clamping to ${workers - 1}`);
    shard = workers - 1;
  }
  const minCommentScore = Math.max(0, Math.floor(o.minCommentScore ?? DEFAULTS.minCommentScore));
  opts = {
    ...DEFAULTS,
    ...o,
    workers,
    shard,
    minCommentScore,
    ...(o.startDate ? { startDate: o.startDate } : {}),
    ...(o.endDate ? { endDate: o.endDate } : {}),
  };
}

export async function runSqlPrewarm(minCommentScore: number): Promise<{ comments: unknown; posts: unknown }> {
  const comments = await client`
    UPDATE reddit_comments
    SET
      sentiment_score = 0,
      sentiment_label = 'neutral',
      confidence_score = 0,
      financial_relevance = 0,
      last_updated = NOW()
    WHERE sentiment_score IS NULL
      AND (
        length(trim(content)) <= 20
        OR score < ${minCommentScore}
      )
  `;

  const posts = await client`
    UPDATE reddit_posts
    SET
      sentiment_score = 0,
      sentiment_label = 'neutral',
      confidence_score = 0,
      financial_relevance = 0,
      last_updated = NOW()
    WHERE sentiment_score IS NULL
      AND length(trim(coalesce(title, '') || ' ' || coalesce(content, ''))) < 10
  `;

  return { comments, posts };
}

async function processRedditPostBatch(rows: (typeof redditPosts.$inferSelect)[]) {
  type W = { post: (typeof rows)[0]; text: string };
  const work: W[] = [];
  for (const post of rows) {
    const text = `${post.title} ${post.content || ''}`.trim();
    if (text.length < 10) {
      await db
        .update(redditPosts)
        .set({
          sentimentScore: '0',
          sentimentLabel: 'neutral',
          confidenceScore: '0',
          financialRelevance: '0',
          lastUpdated: new Date(),
        })
        .where(eq(redditPosts.id, post.id));
      continue;
    }
    work.push({ post, text });
  }

  for (let i = 0; i < work.length; i += opts.mlSubBatch) {
    const chunk = work.slice(i, i + opts.mlSubBatch);
    const mlArr = await mlSentimentClient.analyzeBatch(chunk.map((c) => c.text));
    const sentiments = await mapPool(chunk, opts.analyzeConcurrency, async (w, idx) => {
      const pre = mlArr?.[idx] ?? null;
      return redditSentimentAnalyzer.analyzeSentiment(w.text, 'post', {
        precomputedMl: pre,
      });
    });
    for (let j = 0; j < chunk.length; j++) {
      await redditSentimentAnalyzer.persistAnalyzedPost(chunk[j]!.post.id, sentiments[j]!);
    }
  }
}

type CommentWithPostRow = typeof redditComments.$inferSelect & {
  postTitle: string | null;
  postContent: string | null;
};

type NewsBackfillWork = {
  article: (typeof newsArticles.$inferSelect);
  text: string;
};

async function processRedditCommentBatch(rows: CommentWithPostRow[]) {
  type W = { row: CommentWithPostRow; text: string };
  const work: W[] = [];
  for (const row of rows) {
    const raw = (row.content || '').trim();
    if (raw.length <= 20) {
      await db
        .update(redditComments)
        .set({
          sentimentScore: '0',
          sentimentLabel: 'neutral',
          confidenceScore: '0',
          financialRelevance: '0',
          lastUpdated: new Date(),
        })
        .where(eq(redditComments.id, row.id));
      continue;
    }
    work.push({
      row,
      text: buildCommentWithPostContext(row.postTitle, row.postContent, raw),
    });
  }

  for (let i = 0; i < work.length; i += opts.mlSubBatch) {
    const chunk = work.slice(i, i + opts.mlSubBatch);
    const mlArr = await mlSentimentClient.analyzeBatch(chunk.map((c) => c.text));
    const sentiments = await mapPool(chunk, opts.analyzeConcurrency, async (w, idx) => {
      const pre = mlArr?.[idx] ?? null;
      return redditSentimentAnalyzer.analyzeSentiment(w.text, 'comment', {
        precomputedMl: pre,
        commentDepth: w.row.depth,
      });
    });
    for (let j = 0; j < chunk.length; j++) {
      await redditSentimentAnalyzer.persistAnalyzedComment(chunk[j]!.row.id, sentiments[j]!);
    }
  }
}

async function processNewsBatch(rows: (typeof newsArticles.$inferSelect)[]) {
  const work: NewsBackfillWork[] = rows.map((article) => ({
    article,
    text: newsSentimentAnalyzer.buildSentimentInput(article.title, article.summary, article.content),
  }));

  for (let i = 0; i < work.length; i += opts.mlSubBatch) {
    const chunk = work.slice(i, i + opts.mlSubBatch);
    const mlArr = await mlSentimentClient.analyzeBatch(chunk.map((c) => c.text));
    const sentiments = await mapPool(chunk, opts.analyzeConcurrency, async (w, idx) => {
      const pre: MLSentimentScore | null = mlArr?.[idx] ?? null;
      return newsSentimentAnalyzer.analyzeSentiment(w.text, {
        precomputedMl: pre,
        title: w.article.title,
        summary: w.article.summary,
        content: w.article.content,
      });
    });
    for (let j = 0; j < chunk.length; j++) {
      await newsSentimentAnalyzer.persistAnalyzedNewsArticle(chunk[j]!.article.id, sentiments[j]!);
    }
  }
}

export async function runFullSentimentBackfill(
  partial: Partial<BackfillRunnerOptions> & {
    phases?: Array<'sql' | 'reddit_posts' | 'reddit_comments' | 'news'>;
  } = {},
): Promise<void> {
  applyShardOptions(partial);
  const phases = partial.phases ?? ['sql', 'reddit_posts', 'reddit_comments', 'news'];

  if (phases.includes('sql') && opts.sqlPrewarm) {
    console.log(
      `[sentiment-backfill] SQL prewarm: short comments, score < ${opts.minCommentScore}, or tiny posts → neutral`,
    );
    await runSqlPrewarm(opts.minCommentScore);
    console.log('[sentiment-backfill] SQL prewarm done.');
  }

  if (phases.includes('reddit_posts')) {
    const backlog0 = await countRedditPostsBacklog();
    console.log(
      `[sentiment-backfill] Reddit posts (shard ${opts.shard}/${opts.workers}, batch ${opts.fetchBatch}) — backlog: ${backlog0} rows with NULL sentiment`,
    );
    let batches = 0;
    let total = 0;
    for (;;) {
      const rows = await db
        .select()
        .from(redditPosts)
        .where(and(isNull(redditPosts.sentimentScore), shardPosts(), dateRangePosts()))
        .orderBy(desc(redditPosts.fetchedAt))
        .limit(opts.fetchBatch);
      if (rows.length === 0) break;
      await processRedditPostBatch(rows);
      batches++;
      total += rows.length;
      if (batches === 1 || batches % opts.logEveryBatches === 0) {
        console.log(
          `[sentiment-backfill] posts: ${formatBacklogProgress(total, backlog0)} — ${batches} batches`,
        );
      }
    }
    const left = Math.max(0, backlog0 - total);
    console.log(
      `[sentiment-backfill] Reddit posts finished: ${total} rows this run (~${left} still NULL if concurrent writers), shard ${opts.shard}.`,
    );
  }

  if (phases.includes('reddit_comments')) {
    const backlog0 = await countRedditCommentsBacklog();
    console.log(
      `[sentiment-backfill] Reddit comments (shard ${opts.shard}/${opts.workers}, batch ${opts.fetchBatch}) — backlog: ${backlog0} rows (score≥${opts.minCommentScore}, content>20)`,
    );
    let batches = 0;
    let total = 0;
    for (;;) {
      const rows = await db
        .select({
          ...getTableColumns(redditComments),
          postTitle: redditPosts.title,
          postContent: redditPosts.content,
        })
        .from(redditComments)
        .leftJoin(redditPosts, eq(redditComments.postId, redditPosts.id))
        .where(
          and(
            isNull(redditComments.sentimentScore),
            sql`length(trim(${redditComments.content})) > 20`,
            gte(redditComments.score, opts.minCommentScore),
            shardComments(),
            dateRangeComments(),
          ),
        )
        .orderBy(desc(redditComments.fetchedAt))
        .limit(opts.fetchBatch);
      if (rows.length === 0) break;
      await processRedditCommentBatch(rows);
      batches++;
      total += rows.length;
      if (batches === 1 || batches % opts.logEveryBatches === 0) {
        console.log(
          `[sentiment-backfill] comments: ${formatBacklogProgress(total, backlog0)} — ${batches} batches`,
        );
      }
    }
    const left = Math.max(0, backlog0 - total);
    console.log(
      `[sentiment-backfill] Reddit comments finished: ${total} rows this run (~${left} still NULL if concurrent writers), shard ${opts.shard}.`,
    );
  }

  if (phases.includes('news')) {
    const backlog0 = await countNewsBacklog();
    console.log(
      `[sentiment-backfill] News articles (shard ${opts.shard}/${opts.workers}, batch ${opts.fetchBatch}) — backlog: ${backlog0} rows`,
    );
    let batches = 0;
    let total = 0;
    for (;;) {
      const rows = await db
        .select()
        .from(newsArticles)
        .where(and(isNull(newsArticles.sentimentScore), shardNews(), dateRangeNews()))
        .orderBy(desc(newsArticles.publishedAt))
        .limit(opts.fetchBatch);
      if (rows.length === 0) break;
      await processNewsBatch(rows);
      batches++;
      total += rows.length;
      if (batches === 1 || batches % opts.logEveryBatches === 0) {
        console.log(
          `[sentiment-backfill] news: ${formatBacklogProgress(total, backlog0)} — ${batches} batches`,
        );
      }
    }
    const left = Math.max(0, backlog0 - total);
    console.log(
      `[sentiment-backfill] News finished: ${total} rows this run (~${left} still NULL if concurrent writers), shard ${opts.shard}.`,
    );
  }

  if (opts.refreshMomentumView) {
    try {
      await db.execute(sql`REFRESH MATERIALIZED VIEW sentiment_momentum_24_48h`);
      console.log('[sentiment-backfill] Refreshed materialized view: sentiment_momentum_24_48h');
    } catch (error) {
      console.warn('[sentiment-backfill] Could not refresh sentiment_momentum_24_48h:', error);
    }
  }
}
