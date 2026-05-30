import { Router, Request, Response } from 'express';
import { redditOrchestrator } from '../services/redditOrchestrator.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { integrationUserId, requireRedditCredentials } from './integrationRouteHelpers.js';
import {
  runBackfillChunk,
  getBackfillStatus,
  runSmartHistoricalBackfill,
  updateBackfillConfigIfProvided,
} from '../services/redditSmartBackfillService.js';

/** Shared time + quality filters for dashboard API calls */
function parseRedditDashboardQuery(req: Request): {
  hours: number;
  minScore: number;
  subreddit?: string;
} {
  const hoursRaw = parseInt(String(req.query.hours), 10);
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : 24;

  const minScoreRaw = parseInt(String(req.query.minScore), 10);
  const minScore =
    Number.isFinite(minScoreRaw) && minScoreRaw >= 0 ? minScoreRaw : 50;

  const subredditParam =
    typeof req.query.subreddit === 'string' && req.query.subreddit.trim() !== ''
      ? req.query.subreddit.trim()
      : undefined;
  const subreddit = subredditParam && subredditParam !== 'all' ? subredditParam : undefined;

  return { hours, minScore, ...(subreddit ? { subreddit } : {}) };
}

const router = Router();
router.use(requireAuth);

// Fetch and process Reddit data
router.post('/fetch', async (req: Request, res: Response) => {
  if (!(await requireRedditCredentials(req, res))) return;
  try {
    const options = { ...req.body, userId: integrationUserId(req) };
    const result = await redditOrchestrator.fetchAndProcess(options);
    res.json(result);
  } catch (error) {
    console.error('Error in /fetch:', error);
    res.status(500).json({
      error: 'Failed to fetch Reddit data',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get comprehensive statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await redditOrchestrator.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error in /stats:', error);
    res.status(500).json({
      error: 'Failed to get Reddit stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get trending topics
router.get('/trending', async (req: Request, res: Response) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const limit = parseInt(req.query.limit as string) || 10;
    const topics = await redditOrchestrator.getTrendingTopics(hours, limit);
    res.json(topics);
  } catch (error) {
    console.error('Error in /trending:', error);
    res.status(500).json({
      error: 'Failed to get trending topics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Health check
router.get('/health', async (req: Request, res: Response) => {
  try {
    const health = await redditOrchestrator.healthCheck();
    res.json(health);
  } catch (error) {
    console.error('Error in /health:', error);
    res.status(500).json({
      error: 'Failed to get health status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Incremental backfill status (persisted cursors per subreddit)
router.get('/backfill/status', async (req: Request, res: Response) => {
  try {
    const q = req.query.subreddits;
    const subreddits =
      typeof q === 'string' && q.trim() !== ''
        ? q.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;
    const data = await getBackfillStatus(subreddits);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error in /backfill/status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to read backfill status',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/** One bounded batch of Reddit API calls; safe to trigger often (e.g. on app open). */
router.post('/backfill/chunk', async (req: Request, res: Response) => {
  if (!(await requireRedditCredentials(req, res))) return;
  try {
    const body = req.body as Record<string, unknown>;
    const patch: Parameters<typeof updateBackfillConfigIfProvided>[0] = {};
    if (typeof body.since === 'string' && body.since.trim() !== '') patch.since = body.since.trim();
    if (typeof body.minScore === 'number') patch.minScore = body.minScore;
    if (typeof body.minComments === 'number') patch.minComments = body.minComments;
    if (Object.keys(patch).length > 0) await updateBackfillConfigIfProvided(patch);

    const opts: Parameters<typeof runBackfillChunk>[0] = {};
    if (Array.isArray(body.subreddits)) {
      const subreddits = (body.subreddits as unknown[]).filter(
        (s): s is string => typeof s === 'string' && s.length > 0
      );
      if (subreddits.length) opts.subreddits = subreddits;
    }
    if (typeof body.maxListingRequests === 'number') opts.maxListingRequests = body.maxListingRequests;
    if (typeof body.maxCommentFetches === 'number') opts.maxCommentFetches = body.maxCommentFetches;
    if (typeof body.delayBetweenRequestsMs === 'number') opts.delayBetweenRequestsMs = body.delayBetweenRequestsMs;
    if (typeof body.requestJitterMs === 'number') opts.requestJitterMs = body.requestJitterMs;
    if (typeof body.delayBetweenCommentMs === 'number') opts.delayBetweenCommentMs = body.delayBetweenCommentMs;
    if (typeof body.fetchComments === 'boolean') opts.fetchComments = body.fetchComments;
    if (typeof body.processSentiment === 'boolean') opts.processSentiment = body.processSentiment;
    if (typeof body.sentimentBatchSize === 'number') opts.sentimentBatchSize = body.sentimentBatchSize;

    const data = await runBackfillChunk(opts);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error in /backfill/chunk:', error);
    res.status(500).json({
      success: false,
      error: 'Backfill chunk failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Runs many consecutive chunks in one HTTP call (can time out). Prefer `/backfill/chunk`
 * from the client on a timer, or the CLI script with loops.
 */
router.post('/backfill/smart-history', async (req: Request, res: Response) => {
  if (!(await requireRedditCredentials(req, res))) return;
  try {
    const body = req.body as Record<string, unknown>;
    const patch: Parameters<typeof updateBackfillConfigIfProvided>[0] = {};
    if (typeof body.since === 'string' && body.since.trim() !== '') patch.since = body.since.trim();
    if (typeof body.minScore === 'number') patch.minScore = body.minScore;
    if (typeof body.minComments === 'number') patch.minComments = body.minComments;
    if (Object.keys(patch).length > 0) await updateBackfillConfigIfProvided(patch);

    const opts: Parameters<typeof runSmartHistoricalBackfill>[0] = {};
    if (Array.isArray(body.subreddits)) {
      const subreddits = (body.subreddits as unknown[]).filter(
        (s): s is string => typeof s === 'string' && s.length > 0
      );
      if (subreddits.length) opts.subreddits = subreddits;
    }
    if (typeof body.maxChunks === 'number') opts.maxChunks = body.maxChunks;
    if (typeof body.maxListingRequests === 'number') opts.maxListingRequests = body.maxListingRequests;
    if (typeof body.maxCommentFetches === 'number') opts.maxCommentFetches = body.maxCommentFetches;
    if (typeof body.delayBetweenRequestsMs === 'number') opts.delayBetweenRequestsMs = body.delayBetweenRequestsMs;
    if (typeof body.requestJitterMs === 'number') opts.requestJitterMs = body.requestJitterMs;
    if (typeof body.delayBetweenCommentMs === 'number') opts.delayBetweenCommentMs = body.delayBetweenCommentMs;
    if (typeof body.fetchComments === 'boolean') opts.fetchComments = body.fetchComments;
    if (typeof body.processSentiment === 'boolean') opts.processSentiment = body.processSentiment;
    if (typeof body.sentimentBatchSize === 'number') opts.sentimentBatchSize = body.sentimentBatchSize;

    const out = await runSmartHistoricalBackfill(opts);

    res.json({ success: true, data: out });
  } catch (error) {
    console.error('Error in /backfill/smart-history:', error);
    res.status(500).json({
      success: false,
      error: 'Smart historical backfill failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Process unanalyzed Reddit posts/comments with the FinBERT-backed analyzer
router.post('/sentiment/process', async (req: Request, res: Response) => {
  try {
    const { batchSize, limit } = req.body as { batchSize?: number; limit?: number };
    const requestedBatchSize = Number(batchSize ?? limit ?? 20);
    const processed = await redditOrchestrator.processPendingSentiment(requestedBatchSize);
    res.json({ processed, failed: 0, remaining: 0 });
  } catch (error) {
    console.error('Error in /sentiment/process:', error);
    res.status(500).json({
      error: 'Failed to process sentiment items',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Start automated fetching
router.post('/automated/start', async (req: Request, res: Response) => {
  if (!(await requireRedditCredentials(req, res))) return;
  try {
    const { intervalMinutes = 15 } = req.body;
    await redditOrchestrator.startAutomatedFetching(intervalMinutes, integrationUserId(req));
    res.json({ message: 'Automated fetching started', intervalMinutes });
  } catch (error) {
    console.error('Error in /automated/start:', error);
    res.status(500).json({
      error: 'Failed to start automated fetching',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Stop automated fetching
router.post('/automated/stop', async (req: Request, res: Response) => {
  try {
    redditOrchestrator.stopAutomatedFetching();
    res.json({ message: 'Automated fetching stopped' });
  } catch (error) {
    console.error('Error in /automated/stop:', error);
    res.status(500).json({
      error: 'Failed to stop automated fetching',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});


// Check automated fetching status
router.get('/automated/status', (req: Request, res: Response) => {
  try {
    const isRunning = redditOrchestrator.isFetchingRunning();
    res.json({ isRunning });
  } catch (error) {
    console.error('Error in /automated/status:', error);
    res.status(500).json({
      error: 'Failed to check automated fetching status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get quality posts (real implementation)
router.get('/posts/quality', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const { hours, minScore, subreddit } = parseRedditDashboardQuery(req);

    const posts = await redditOrchestrator.getQualityPosts(limit, {
      hours,
      ...(subreddit ? { subreddit } : {}),
      minScore,
    });

    const stats = await redditOrchestrator.getStats();
    const avgScore =
      posts.length > 0
        ? Math.round((posts.reduce((s, p) => s + (p.score ?? 0), 0) / posts.length) * 10) / 10
        : 0;

    res.json({
      success: true,
      data: {
        posts: posts,
        analytics: {
          totalPosts: posts.length,
          totalComments: posts.reduce((acc, p) => acc + (p.numComments ?? 0), 0),
          averageScore: avgScore,
          topSubreddits: stats.subredditBreakdown || [],
          sentimentDistribution: stats.sentimentDistribution || {
            positive: 0,
            negative: 0,
            neutral: 0,
            unanalyzed: 0
          }
        }
      }
    });
  } catch (error) {
    console.error('Error in /posts/quality:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get quality posts',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/recommendations', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;
    const { hours, minScore, subreddit } = parseRedditDashboardQuery(req);
    const recommendations = await redditOrchestrator.getRecommendedStocks(limit, hours, {
      minScore,
      ...(subreddit ? { subreddit } : {}),
    });

    res.json({
      success: true,
      data: recommendations
    });
  } catch (error) {
    console.error('Error in /recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recommendations',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Detailed Sentiment Analytics
router.get('/sentiment/analytics', async (req: Request, res: Response) => {
  try {
    const { hours, minScore, subreddit } = parseRedditDashboardQuery(req);
    const analytics = await redditOrchestrator.getSentimentAnalytics(hours, {
      minScore,
      ...(subreddit ? { subreddit } : {}),
    });

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error in /sentiment/analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sentiment analytics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Stock & Sector Sentiment
router.get('/sentiment/stocks', async (req: Request, res: Response) => {
  try {
    const { hours, minScore, subreddit } = parseRedditDashboardQuery(req);
    const data = await redditOrchestrator.getStockSectorSentiment(hours, {
      minScore,
      ...(subreddit ? { subreddit } : {}),
    });

    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('Error in /sentiment/stocks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get stock sentiment',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Historical Sentiment Time Series (for charting)
router.get('/sentiment/history', async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string || '').toUpperCase();
    const days = parseInt(req.query.days as string) || 30;

    if (!symbol) {
      res.status(400).json({
        success: false,
        error: 'symbol query parameter is required'
      });
      return;
    }

    const { redditSentimentAnalyzer } = await import('../services/redditSentimentAnalyzer.js');
    const history = await redditSentimentAnalyzer.getSentimentHistory(symbol, days);

    res.json({
      success: true,
      data: {
        symbol,
        days,
        history
      }
    });
  } catch (error) {
    console.error('Error in /sentiment/history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sentiment history',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as redditRouter };