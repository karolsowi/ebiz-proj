/**
 * Resumable Reddit quality backfill: stores cursors in Postgres, processes small
 * “chunks” with jittered delays to stay under Reddit rate limits. When historical
 * crawl (top + /new) finishes for a subreddit, it switches to “live” mode:
 * poll /new for fresh posts with the same quality bar.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import {
  redditBackfillConfig,
  redditBackfillProgress,
  redditComments,
  redditPosts,
} from '../db/schema.js';
import { redditService, type RedditPostData } from './redditService.js';
import { redditSentimentAnalyzer } from './redditSentimentAnalyzer.js';

export const DEFAULT_SUBS = [
  'stocks',
  'investing',
  'wallstreetbets',
  'ValueInvesting',
];

export interface BackfillChunkOptions {
  subreddits?: string[];
  /** Max Reddit listing API calls in this chunk (spread across subs). Default 8 */
  maxListingRequests?: number;
  /** Max comment-tree fetches (expensive). Default 4 */
  maxCommentFetches?: number;
  /** Base delay between listing requests; jitter added (default 2600 ms) */
  delayBetweenRequestsMs?: number;
  /** Extra random jitter 0..this (default 500 ms) */
  requestJitterMs?: number;
  delayBetweenCommentMs?: number;
  fetchComments?: boolean;
  processSentiment?: boolean;
  sentimentBatchSize?: number;
}

export interface BackfillChunkResult {
  since: string;
  minScore: number;
  minComments: number;
  listingCallsThisChunk: number;
  commentCallsThisChunk: number;
  postsIngestedThisChunk: number;
  commentsFetched: number;
  /** Every tracked subreddit finished top + new history and is on live polling */
  allHistoryComplete: boolean;
  /** No subreddit could make a listing call (should not happen if subs exist) */
  idle: boolean;
  errors: string[];
  subs: Array<{
    subreddit: string;
    phase: string;
    topComplete: boolean;
    newHistoryComplete: boolean;
    liveStartedAt: Date | null;
    listingCallsTotal: number;
    postsIngestedTotal: number;
  }>;
}

function jitterDelay(baseMs: number, jitterMax: number): Promise<void> {
  const ms = baseMs + Math.floor(Math.random() * jitterMax);
  return new Promise(resolve => setTimeout(resolve, ms));
}

function qualifiesHistory(
  raw: Pick<RedditPostData, 'created_utc' | 'score' | 'num_comments'>,
  since: Date,
  now: Date,
  minScore: number,
  minComments: number
): boolean {
  const created = new Date(raw.created_utc * 1000);
  if (created < since || created > now) return false;
  if (raw.score < minScore) return false;
  if (raw.num_comments < minComments) return false;
  return true;
}

function qualifiesLive(
  raw: Pick<RedditPostData, 'score' | 'num_comments'>,
  minScore: number,
  minComments: number
): boolean {
  if (raw.score < minScore) return false;
  if (raw.num_comments < minComments) return false;
  return true;
}

export async function ensureBackfillConfig(): Promise<{
  since: Date;
  minScore: number;
  minComments: number;
}> {
  const rows = await db.select().from(redditBackfillConfig).where(eq(redditBackfillConfig.id, 1)).limit(1);
  if (!rows.length) {
    const since = new Date(Date.UTC(2020, 0, 1));
    await db.insert(redditBackfillConfig).values({
      id: 1,
      sinceTs: since,
      minScore: 50,
      minComments: 10,
    });
    return { since, minScore: 50, minComments: 10 };
  }
  const r = rows[0]!;
  return {
    since: r.sinceTs!,
    minScore: r.minScore,
    minComments: r.minComments,
  };
}

/** Persist optional thresholds / start date (singleton row id=1). */
export async function updateBackfillConfigIfProvided(opts: {
  since?: string;
  minScore?: number;
  minComments?: number;
}): Promise<void> {
  const patch: {
    sinceTs?: Date;
    minScore?: number;
    minComments?: number;
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (opts.since !== undefined && opts.since.trim() !== '') {
    const d = new Date(opts.since);
    if (!Number.isNaN(d.getTime())) patch.sinceTs = d;
  }
  if (opts.minScore !== undefined && Number.isFinite(opts.minScore)) {
    patch.minScore = Math.max(0, Math.floor(opts.minScore));
  }
  if (opts.minComments !== undefined && Number.isFinite(opts.minComments)) {
    patch.minComments = Math.max(0, Math.floor(opts.minComments));
  }

  const has =
    patch.sinceTs !== undefined ||
    patch.minScore !== undefined ||
    patch.minComments !== undefined;
  if (!has) return;

  await ensureBackfillConfig();
  await db.update(redditBackfillConfig).set(patch).where(eq(redditBackfillConfig.id, 1));
}

async function ensureProgressRows(subreddits: string[]): Promise<void> {
  for (const sub of subreddits) {
    await db
      .insert(redditBackfillProgress)
      .values({ subreddit: sub })
      .onConflictDoNothing();
  }
}

async function countCommentsForPost(postId: string): Promise<number> {
  const r = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(redditComments)
    .where(eq(redditComments.postId, postId));
  return Number(r[0]?.n ?? 0);
}

type ProgressRow = typeof redditBackfillProgress.$inferSelect;

/** Prefer finishing historical crawl before live polling */
function phaseSort(a: ProgressRow, b: ProgressRow): number {
  const score = (r: ProgressRow) => {
    if (r.phase === 'top' && !r.topComplete) return 0;
    if (r.phase === 'new_history' && !r.newHistoryComplete) return 1;
    if (r.phase === 'live') return 3;
    return 2;
  };
  const d = score(a) - score(b);
  if (d !== 0) return d;
  return a.subreddit.localeCompare(b.subreddit);
}

interface StepCfg {
  since: Date;
  minScore: number;
  minComments: number;
}

async function listingStep(
  row: ProgressRow,
  cfg: StepCfg,
  now: Date,
  errors: string[]
): Promise<{ listingUsed: boolean; postsSaved: number }> {
  const sub = row.subreddit;
  let postsSaved = 0;

  if (row.phase === 'live') {
    try {
      const { items } = await redditService.fetchListingPageRaw(sub, 'new', { limit: 100 });
      await db
        .update(redditBackfillProgress)
        .set({
          listingCallsTotal: sql`${redditBackfillProgress.listingCallsTotal} + 1`,
          lastChunkAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(redditBackfillProgress.subreddit, sub));

      for (const raw of items) {
        if (!qualifiesLive(raw, cfg.minScore, cfg.minComments)) continue;
        try {
          await redditService.ingestPostFromRaw(raw);
          postsSaved++;
        } catch (e) {
          errors.push(`live r/${sub} ${raw.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (postsSaved > 0) {
        await db
          .update(redditBackfillProgress)
          .set({
            postsIngestedTotal: sql`${redditBackfillProgress.postsIngestedTotal} + ${postsSaved}`,
            updatedAt: new Date(),
          })
          .where(eq(redditBackfillProgress.subreddit, sub));
      }
      return { listingUsed: true, postsSaved };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`live list r/${sub}: ${msg}`);
      await db
        .update(redditBackfillProgress)
        .set({ lastError: msg.slice(0, 2000), updatedAt: new Date() })
        .where(eq(redditBackfillProgress.subreddit, sub));
      return { listingUsed: true, postsSaved: 0 };
    }
  }

  if (row.phase === 'top' && !row.topComplete) {
    try {
      const { items, after } = await redditService.fetchListingPageRaw(sub, 'top', {
        timeframe: 'all',
        limit: 100,
        after: row.afterTop,
      });
      const topDone = !after;

      await db
        .update(redditBackfillProgress)
        .set({
          afterTop: after,
          topComplete: topDone,
          phase: topDone ? 'new_history' : 'top',
          afterNew: topDone ? null : row.afterNew,
          listingCallsTotal: sql`${redditBackfillProgress.listingCallsTotal} + 1`,
          lastChunkAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(redditBackfillProgress.subreddit, sub));

      for (const raw of items) {
        if (!qualifiesHistory(raw, cfg.since, now, cfg.minScore, cfg.minComments)) continue;
        try {
          await redditService.ingestPostFromRaw(raw);
          postsSaved++;
        } catch (e) {
          errors.push(`top r/${sub} ${raw.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (postsSaved > 0) {
        await db
          .update(redditBackfillProgress)
          .set({
            postsIngestedTotal: sql`${redditBackfillProgress.postsIngestedTotal} + ${postsSaved}`,
            updatedAt: new Date(),
          })
          .where(eq(redditBackfillProgress.subreddit, sub));
      }
      return { listingUsed: true, postsSaved };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`top r/${sub}: ${msg}`);
      await db
        .update(redditBackfillProgress)
        .set({ lastError: msg.slice(0, 2000), updatedAt: new Date() })
        .where(eq(redditBackfillProgress.subreddit, sub));
      return { listingUsed: true, postsSaved: 0 };
    }
  }

  if (row.phase === 'new_history' && !row.newHistoryComplete) {
    try {
      const { items, after } = await redditService.fetchListingPageRaw(sub, 'new', {
        limit: 100,
        after: row.afterNew,
      });

      if (!items.length) {
        await db
          .update(redditBackfillProgress)
          .set({
            newHistoryComplete: true,
            phase: 'live',
            liveStartedAt: new Date(),
            afterNew: null,
            listingCallsTotal: sql`${redditBackfillProgress.listingCallsTotal} + 1`,
            lastChunkAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(redditBackfillProgress.subreddit, sub));
        return { listingUsed: true, postsSaved: 0 };
      }

      const pageNewestUtc = items[0]!.created_utc * 1000;
      const beforeWindow = pageNewestUtc < cfg.since.getTime();
      const noMorePages = !after;
      const newDone = beforeWindow || noMorePages;

      await db
        .update(redditBackfillProgress)
        .set({
          afterNew: newDone ? null : after,
          newHistoryComplete: newDone,
          phase: newDone ? 'live' : 'new_history',
          liveStartedAt: newDone ? new Date() : row.liveStartedAt,
          listingCallsTotal: sql`${redditBackfillProgress.listingCallsTotal} + 1`,
          lastChunkAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(redditBackfillProgress.subreddit, sub));

      for (const raw of items) {
        if (new Date(raw.created_utc * 1000) < cfg.since) continue;
        if (!qualifiesHistory(raw, cfg.since, now, cfg.minScore, cfg.minComments)) continue;
        try {
          await redditService.ingestPostFromRaw(raw);
          postsSaved++;
        } catch (e) {
          errors.push(`new r/${sub} ${raw.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (postsSaved > 0) {
        await db
          .update(redditBackfillProgress)
          .set({
            postsIngestedTotal: sql`${redditBackfillProgress.postsIngestedTotal} + ${postsSaved}`,
            updatedAt: new Date(),
          })
          .where(eq(redditBackfillProgress.subreddit, sub));
      }
      return { listingUsed: true, postsSaved };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`new r/${sub}: ${msg}`);
      await db
        .update(redditBackfillProgress)
        .set({ lastError: msg.slice(0, 2000), updatedAt: new Date() })
        .where(eq(redditBackfillProgress.subreddit, sub));
      return { listingUsed: true, postsSaved: 0 };
    }
  }

  return { listingUsed: false, postsSaved: 0 };
}

export async function runBackfillChunk(options: BackfillChunkOptions = {}): Promise<BackfillChunkResult> {
  const cfg = await ensureBackfillConfig();
  const subreddits = options.subreddits?.length ? options.subreddits : DEFAULT_SUBS;
  await ensureProgressRows(subreddits);

  await db
    .update(redditBackfillProgress)
    .set({ phase: 'new_history' })
    .where(
      and(eq(redditBackfillProgress.topComplete, true), eq(redditBackfillProgress.phase, 'top'))
    );
  await db
    .update(redditBackfillProgress)
    .set({ phase: 'live' })
    .where(
      and(
        eq(redditBackfillProgress.newHistoryComplete, true),
        eq(redditBackfillProgress.phase, 'new_history')
      )
    );

  const maxListing = Math.max(1, options.maxListingRequests ?? 8);
  const maxComments = Math.max(0, options.maxCommentFetches ?? 4);
  const baseDelay = Math.max(1500, options.delayBetweenRequestsMs ?? 2600);
  const jitterMax = Math.max(0, options.requestJitterMs ?? 500);
  const delayComm = Math.max(300, options.delayBetweenCommentMs ?? 2200);
  const fetchComments = options.fetchComments ?? true;
  const processSentiment = options.processSentiment ?? false;
  const sentimentBatch = Math.min(200, Math.max(10, options.sentimentBatchSize ?? 30));

  const now = new Date();
  const errors: string[] = [];
  let listingCalls = 0;
  let commentCalls = 0;
  let postsIngestedThisChunk = 0;
  let commentsFetched = 0;

  const rows = await db
    .select()
    .from(redditBackfillProgress)
    .where(inArray(redditBackfillProgress.subreddit, subreddits));

  const sorted = [...rows].sort(phaseSort);

  let rr = 0;
  while (listingCalls < maxListing) {
    let progressed = false;
    for (let k = 0; k < sorted.length; k++) {
      const idx = (rr + k) % sorted.length;
      const row = sorted[idx]!;
      const step = await listingStep(row, cfg, now, errors);
      if (step.listingUsed) {
        listingCalls++;
        postsIngestedThisChunk += step.postsSaved;
        progressed = true;
        rr = (idx + 1) % sorted.length;
        await jitterDelay(baseDelay, jitterMax);
        const refreshed = await db
          .select()
          .from(redditBackfillProgress)
          .where(eq(redditBackfillProgress.subreddit, row.subreddit))
          .limit(1);
        if (refreshed[0]) sorted[idx] = refreshed[0]!;
        break;
      }
    }
    if (!progressed) break;
  }

  if (fetchComments && commentCalls < maxComments && listingCalls > 0) {
    const recentPosts = await db
      .select({ id: redditPosts.id, numComments: redditPosts.numComments })
      .from(redditPosts)
      .where(inArray(redditPosts.subreddit, subreddits))
      .orderBy(desc(redditPosts.fetchedAt))
      .limit(60);

    for (const p of recentPosts) {
      if (commentCalls >= maxComments) break;
      const n = p.numComments ?? 0;
      if (n < cfg.minComments) continue;
      const have = await countCommentsForPost(p.id);
      if (have > 0) continue;
      try {
        const saved = await redditService.fetchPostComments(p.id);
        commentsFetched += saved.length;
        commentCalls++;
        await jitterDelay(delayComm, 300);
      } catch (e) {
        errors.push(`comments ${p.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  if (processSentiment && (listingCalls > 0 || commentCalls > 0)) {
    try {
      await redditSentimentAnalyzer.processUnanalyzedPosts(sentimentBatch);
      await redditSentimentAnalyzer.processUnanalyzedComments(Math.ceil(sentimentBatch * 1.1));
    } catch (e) {
      errors.push(`sentiment: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const finalRows = await db
    .select()
    .from(redditBackfillProgress)
    .where(inArray(redditBackfillProgress.subreddit, subreddits));

  const allHistoryComplete = finalRows.every(
    r => r.topComplete && r.newHistoryComplete && r.phase === 'live'
  );
  const idle = listingCalls === 0;

  const subs = finalRows.map(r => ({
    subreddit: r.subreddit,
    phase: r.phase,
    topComplete: r.topComplete,
    newHistoryComplete: r.newHistoryComplete,
    liveStartedAt: r.liveStartedAt,
    listingCallsTotal: r.listingCallsTotal,
    postsIngestedTotal: r.postsIngestedTotal,
  }));

  return {
    since: cfg.since.toISOString(),
    minScore: cfg.minScore,
    minComments: cfg.minComments,
    listingCallsThisChunk: listingCalls,
    commentCallsThisChunk: commentCalls,
    postsIngestedThisChunk,
    commentsFetched,
    allHistoryComplete,
    idle,
    errors,
    subs,
  };
}

export async function getBackfillStatus(subreddits?: string[]): Promise<{
  config: { since: string; minScore: number; minComments: number };
  subs: BackfillChunkResult['subs'];
  allHistoryComplete: boolean;
}> {
  const cfg = await ensureBackfillConfig();
  const subsList = subreddits?.length ? subreddits : DEFAULT_SUBS;
  await ensureProgressRows(subsList);

  const rows = await db
    .select()
    .from(redditBackfillProgress)
    .where(inArray(redditBackfillProgress.subreddit, subsList));

  const resultSubs = rows.map(r => ({
    subreddit: r.subreddit,
    phase: r.phase,
    topComplete: r.topComplete,
    newHistoryComplete: r.newHistoryComplete,
    liveStartedAt: r.liveStartedAt,
    listingCallsTotal: r.listingCallsTotal,
    postsIngestedTotal: r.postsIngestedTotal,
  }));

  const allHistoryComplete = rows.every(
    r => r.topComplete && r.newHistoryComplete && r.phase === 'live'
  );

  return {
    config: {
      since: cfg.since.toISOString(),
      minScore: cfg.minScore,
      minComments: cfg.minComments,
    },
    subs: resultSubs,
    allHistoryComplete,
  };
}

/** @deprecated One-shot bulk run — prefer runBackfillChunk in a loop. */
export async function runSmartHistoricalBackfill(
  options: BackfillChunkOptions & { maxChunks?: number } = {}
): Promise<{
  chunks: number;
  listingCallsTotal: number;
}> {
  const maxChunks = Math.min(5000, Math.max(1, options.maxChunks ?? 200));
  let chunks = 0;
  let listingTotal = 0;
  for (let i = 0; i < maxChunks; i++) {
    const r = await runBackfillChunk(options);
    listingTotal += r.listingCallsThisChunk;
    chunks++;
  }
  return { chunks, listingCallsTotal: listingTotal };
}
