import { redditService } from './redditService';
import { redditSentimentAnalyzer } from './redditSentimentAnalyzer.js';
import { EventEmitter } from 'events';
import { db } from '../db/connection.js';
import { redditPosts, redditComments, redditApiCalls, subredditConfigs } from '../db/schema.js';
import { eq, gte, sql, and, desc, isNull, or, gt } from 'drizzle-orm';

/** Normalize legacy jsonb (string[] or StockMention-shaped objects) to tickers */
function normalizeDetectedStockSymbols(raw: unknown): string[] {
  if (!raw || !Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push(item.trim().toUpperCase());
      continue;
    }
    if (item && typeof item === 'object' && 'symbol' in item) {
      const sym = (item as { symbol: unknown }).symbol;
      if (typeof sym === 'string' && sym.trim()) out.push(sym.trim().toUpperCase());
    }
  }
  return [...new Set(out)];
}

export interface RedditFetchOptions {
  subreddits: string[];
  sort: 'hot' | 'new' | 'top' | 'rising';
  limit: number;
  timeframe?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
  fetchComments: boolean;
  processSentiment: boolean;
  shouldStop?: () => boolean;
  /** When set, Reddit OAuth uses this user's API keys from Account → API keys. */
  userId?: string;
}

export interface RedditFetchResult {
  postsFound: number;
  postsNew: number;
  commentsFound: number;
  commentsNew: number;
  sentimentItemsProcessed: number;
  errors: string[];
}

export class RedditOrchestrator extends EventEmitter {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  // Check if automated fetching is running
  isFetchingRunning(): boolean {
    return this.isRunning;
  }

  // Fetch and process Reddit data for multiple subreddits
  async fetchAndProcess(options: RedditFetchOptions): Promise<RedditFetchResult> {
    const result: RedditFetchResult = {
      postsFound: 0,
      postsNew: 0,
      commentsFound: 0,
      commentsNew: 0,
      sentimentItemsProcessed: 0,
      errors: [],
    };

    for (const subreddit of options.subreddits) {
      try {
        // Check if we can fetch this subreddit (rate limiting)
        const canFetch = await redditService.canFetchSubreddit(subreddit);
        if (!canFetch) {
          result.errors.push(`Skipping ${subreddit} due to rate limiting`);
          continue;
        }

        if (options.shouldStop && options.shouldStop()) {
          result.errors.push('Fetching stopped by user');
          break;
        }

        console.log(`Fetching posts from r/${subreddit}...`);

        // Fetch posts
        const posts = await redditService.fetchSubredditPosts(
          subreddit,
          options.sort,
          options.limit,
          options.timeframe,
          options.userId
        );

        result.postsFound += posts.length;

        // Count new posts (those just created)
        const newPosts = posts.filter(post => {
          const timeDiff = Date.now() - post.fetchedAt.getTime();
          return timeDiff < 60000; // Created in the last minute
        });
        result.postsNew += newPosts.length;

        // Fetch comments for each post if requested
        if (options.fetchComments) {
          for (const post of posts) {
            try {
              console.log(`Fetching comments for post ${post.id}...`);
              const comments = await redditService.fetchPostComments(post.id, options.userId);
              result.commentsFound += comments.length;

              // Count new comments
              const newComments = comments.filter(comment => {
                const timeDiff = Date.now() - comment.fetchedAt.getTime();
                return timeDiff < 60000;
              });
              result.commentsNew += newComments.length;

              // Small delay between comment fetches to be respectful
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
              result.errors.push(`Failed to fetch comments for post ${post.id}: ${error}`);
            }
          }
        }

        // Update last fetched time for this subreddit
        await redditService.updateSubredditLastFetched(subreddit);

        console.log(`Completed r/${subreddit}: ${posts.length} posts`);
      } catch (error) {
        result.errors.push(`Failed to fetch r/${subreddit}: ${error}`);
      }
    }

    // Run sentiment analysis on newly fetched content
    if (options.processSentiment) {
      try {
        console.log('Running FinBERT sentiment analysis on new content...');
        const processed = await this.processPendingSentiment(50);
        result.sentimentItemsProcessed = processed;
      } catch (error) {
        result.errors.push(`Failed to process sentiment items: ${error}`);
      }
    }

    return result;
  }

  // Process sentiment analysis jobs using the FinBERT-powered analyzer.
  // The analyzer tries the Python ML service first and falls back to keyword-based
  // scoring when the service is unreachable, so this always produces results.
  // Both posts and comments are processed; returned count is posts + comments.
  async processPendingSentiment(batchSize: number = 20): Promise<number> {
    try {
      const postBatch = Math.ceil(batchSize * 0.6);
      const commentBatch = Math.ceil(batchSize * 0.8);

      const [postResult, commentResult] = await Promise.all([
        redditSentimentAnalyzer.processUnanalyzedPosts(postBatch),
        redditSentimentAnalyzer.processUnanalyzedComments(commentBatch),
      ]);

      const total = postResult.processed + commentResult.processed;
      if (total > 0) {
        console.log(`✅ Sentiment processed — posts: ${postResult.processed}, comments: ${commentResult.processed}, failed: ${postResult.failed + commentResult.failed}`);
      }
      return total;
    } catch (error) {
      console.error('Failed to process sentiment items:', error);
      return 0;
    }
  }

  async startAutomatedFetching(intervalMinutes: number = 15, userId?: string): Promise<void> {
    if (this.isRunning) {
      console.log('Automated fetching is already running');
      return;
    }

    this.isRunning = true;
    console.log(`Starting automated Reddit fetching every ${intervalMinutes} minutes`);

    try {
      // Initialize default subreddits
      await redditService.initializeDefaultSubreddits();

      // Check if stopped during init
      if (!this.isRunning) return;

      // Define default fetch options
      const defaultOptions: RedditFetchOptions = {
        subreddits: ['investing', 'stocks', 'wallstreetbets', 'SecurityAnalysis', 'ValueInvesting'],
        sort: 'hot',
        limit: 25,
        fetchComments: true,
        processSentiment: true,
        shouldStop: () => !this.isRunning,
        ...(userId ? { userId } : {}),
      };

      // Set up interval
      this.intervalId = setInterval(async () => {
        if (!this.isRunning) return;
        await this.runAutomatedCycle(defaultOptions);
      }, intervalMinutes * 60 * 1000);

      // Run immediately (fire and forget)
      this.runAutomatedCycle(defaultOptions).catch(err => {
        console.error('Error in initial automated cycle:', err);
      });

    } catch (error) {
      this.isRunning = false;
      console.error('Failed to start automated fetching:', error);
      throw error;
    }
  }

  // Stop automated fetching
  stopAutomatedFetching(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('Stopped automated Reddit fetching');
  }

  // Run one cycle of automated fetching
  private async runAutomatedCycle(options: RedditFetchOptions): Promise<void> {
    try {
      console.log('Starting automated Reddit fetch cycle...');

      // Fetch and process Reddit data
      const fetchResult = await this.fetchAndProcess(options);

      // Process unanalyzed Reddit rows (FinBERT + keyword fallback)
      const sentimentProcessed = await this.processPendingSentiment();

      console.log('Automated cycle completed:', {
        postsFound: fetchResult.postsFound,
        postsNew: fetchResult.postsNew,
        commentsFound: fetchResult.commentsFound,
        commentsNew: fetchResult.commentsNew,
        sentimentItemsProcessed: fetchResult.sentimentItemsProcessed,
        sentimentProcessed,
        errors: fetchResult.errors.length,
      });

      if (fetchResult.errors.length > 0) {
        console.warn('Errors during fetch cycle:', fetchResult.errors);
      }
    } catch (error) {
      console.error('Error in automated cycle:', error);
    }
  }

  // Get comprehensive statistics
  async getStats() {
    try {
      // Basic counts
      const totalPosts = await db.select({ count: sql`count(*)`.mapWith(Number) }).from(redditPosts).then(result => result[0]?.count || 0);
      const totalComments = await db.select({ count: sql`count(*)`.mapWith(Number) }).from(redditComments).then(result => result[0]?.count || 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const postsToday = await db.select({ count: sql`count(*)`.mapWith(Number) })
        .from(redditPosts)
        .where(gte(redditPosts.fetchedAt, today))
        .then(result => result[0]?.count || 0);

      const commentsToday = await db.select({ count: sql`count(*)`.mapWith(Number) })
        .from(redditComments)
        .where(gte(redditComments.fetchedAt, today))
        .then(result => result[0]?.count || 0);

      // Subreddit breakdown
      const subredditStats = await db.select({
        subreddit: redditPosts.subreddit,
        count: sql`count(*)`.mapWith(Number)
      })
        .from(redditPosts)
        .groupBy(redditPosts.subreddit)
        .limit(10);

      // Sentiment Aggregation
      const sentimentStats = await db.select({
        avgScore: sql<number>`avg(cast(${redditPosts.sentimentScore} as float))`,
        positive: sql<number>`sum(case when cast(${redditPosts.sentimentScore} as float) > 0.1 then 1 else 0 end)`,
        negative: sql<number>`sum(case when cast(${redditPosts.sentimentScore} as float) < -0.1 then 1 else 0 end)`,
        neutral: sql<number>`sum(case when cast(${redditPosts.sentimentScore} as float) between -0.1 and 0.1 then 1 else 0 end)`,
        unanalyzed: sql<number>`sum(case when ${redditPosts.sentimentScore} is null then 1 else 0 end)`
      }).from(redditPosts);

      const stats = sentimentStats[0] || { avgScore: 0, positive: 0, negative: 0, neutral: 0, unanalyzed: 0 };

      // Get subreddit configs
      const activeSubreddits = await db.select().from(subredditConfigs).where(eq(subredditConfigs.isActive, true));

      return {
        totalPosts,
        totalComments,
        postsToday,
        commentsToday,
        subredditBreakdown: subredditStats,
        averageScore: Number(stats.avgScore || 0).toFixed(2),
        sentimentDistribution: {
          positive: Number(stats.positive || 0),
          negative: Number(stats.negative || 0),
          neutral: Number(stats.neutral || 0),
          unanalyzed: Number(stats.unanalyzed || 0)
        },
        activeSubreddits: activeSubreddits.length,
        lastUpdate: new Date()
      };
    } catch (error) {
      console.error('Error getting Reddit stats:', error);
      return {
        totalPosts: 0,
        totalComments: 0,
        postsToday: 0,
        commentsToday: 0,
        subredditBreakdown: [],
        averageScore: 0,
        sentimentDistribution: { positive: 0, negative: 0, neutral: 0, unanalyzed: 0 },
        activeSubreddits: 0,
        lastUpdate: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Get trending topics based on recent posts
  async getTrendingTopics(hours: number = 24, limit: number = 10): Promise<Array<{
    keyword: string;
    mentions: number;
    averageSentiment: number;
    subreddits: string[];
  }>> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    try {
      // Get recent posts with sentiment using Drizzle
      const posts = await db.select({
        title: redditPosts.title,
        content: redditPosts.content,
        subreddit: redditPosts.subreddit,
        sentimentScore: redditPosts.sentimentScore,
      })
        .from(redditPosts)
        .where(and(
          gte(redditPosts.fetchedAt, since),
          sql`${redditPosts.sentimentScore} IS NOT NULL`
        ));

      // Extract keywords and calculate trends
      const keywordStats = new Map<string, {
        mentions: number;
        totalSentiment: number;
        subreddits: Set<string>;
      }>();

      // Common stock symbols and financial terms to track
      const trackingKeywords = [
        'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX',
        'SPY', 'QQQ', 'VTI', 'BTC', 'ETH', 'bitcoin', 'ethereum',
        'inflation', 'fed', 'interest rates', 'recession', 'bull market',
        'bear market', 'earnings', 'dividend', 'IPO', 'merger'
      ];

      for (const post of posts) {
        const text = `${post.title} ${post.content || ''}`.toLowerCase();

        for (const keyword of trackingKeywords) {
          if (text.includes(keyword.toLowerCase())) {
            const current = keywordStats.get(keyword) || {
              mentions: 0,
              totalSentiment: 0,
              subreddits: new Set(),
            };

            current.mentions++;
            current.totalSentiment += Number(post.sentimentScore) || 0;
            current.subreddits.add(post.subreddit);

            keywordStats.set(keyword, current);
          }
        }
      }

      // Convert to array and sort by mentions
      const trending = Array.from(keywordStats.entries())
        .map(([keyword, stats]) => ({
          keyword,
          mentions: stats.mentions,
          averageSentiment: stats.totalSentiment / stats.mentions,
          subreddits: Array.from(stats.subreddits),
        }))
        .filter(item => item.mentions >= 2) // Minimum 2 mentions
        .sort((a, b) => b.mentions - a.mentions)
        .slice(0, limit);

      return trending;
    } catch (error) {
      console.error('Error getting trending topics:', error);
      return [];
    }
  }

  // Health check
  async healthCheck() {
    try {
      // Test database connection
      await db.execute(sql`SELECT 1`);

      // Get recent API calls
      const recentCalls = await db.select({ count: sql`count(*)`.mapWith(Number) })
        .from(redditApiCalls)
        .where(gte(redditApiCalls.calledAt, new Date(Date.now() - 5 * 60 * 1000)))
        .then(result => result[0]?.count || 0);

      const [unanalyzedPosts, unanalyzedComments] = await Promise.all([
        db.select({ count: sql`count(*)`.mapWith(Number) })
          .from(redditPosts)
          .where(isNull(redditPosts.sentimentScore))
          .then(result => result[0]?.count || 0),
        db.select({ count: sql`count(*)`.mapWith(Number) })
          .from(redditComments)
          .where(isNull(redditComments.sentimentScore))
          .then(result => result[0]?.count || 0),
      ]);

      return {
        status: 'healthy',
        database: 'connected',
        recentApiCalls: recentCalls,
        pendingSentimentItems: unanalyzedPosts + unanalyzedComments,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      };
    }
  }

  /**
   * Get recent posts for monitoring
   */
  async getRecentPosts(limit: number = 50) {
    try {
      const posts = await db.select()
        .from(redditPosts)
        .orderBy(desc(redditPosts.fetchedAt))
        .limit(limit);

      return posts;
    } catch (error) {
      console.error('Error getting recent posts:', error);
      return [];
    }
  }

  /**
   * Get quality posts (high score or positive sentiment), optionally scoped by time and subreddit.
   */
  async getQualityPosts(
    limit: number = 20,
    options?: { hours?: number; subreddit?: string; minScore?: number }
  ) {
    try {
      const minScore = options?.minScore ?? 50;
      const clauses = [
        or(
          gt(redditPosts.score, minScore),
          sql`CAST(${redditPosts.sentimentScore} AS FLOAT) > 0.5`
        )!,
      ];

      if (options?.hours != null && options.hours > 0) {
        const since = new Date(Date.now() - options.hours * 60 * 60 * 1000);
        clauses.push(gte(redditPosts.fetchedAt, since));
      }

      if (options?.subreddit) {
        clauses.push(eq(redditPosts.subreddit, options.subreddit));
      }

      const posts = await db.select()
        .from(redditPosts)
        .where(and(...clauses))
        .orderBy(desc(redditPosts.score))
        .limit(limit);

      return posts;
    } catch (error) {
      console.error('Error getting quality posts:', error);
      return [];
    }
  }

  /**
   * Get recommended stocks based on sentiment analysis
   */
  async getRecommendedStocks(
    limit: number = 5,
    hours: number = 24,
    options?: { minScore?: number; subreddit?: string }
  ): Promise<Array<{
    symbol: string;
    score: number;
    mentions: number;
    sentiment: 'positive' | 'negative' | 'neutral';
    reason: string;
  }>> {
    try {
      const hoursSafe = Number.isFinite(hours) && hours > 0 ? hours : 24;
      const since = new Date(Date.now() - hoursSafe * 60 * 60 * 1000);
      const minScore = options?.minScore ?? 50;

      const clauses = [
        or(
          gt(redditPosts.score, minScore),
          sql`CAST(${redditPosts.sentimentScore} AS FLOAT) > 0.5`
        )!,
        gte(redditPosts.fetchedAt, since),
        sql`${redditPosts.detectedStocks} IS NOT NULL`,
      ];
      if (options?.subreddit) {
        clauses.push(eq(redditPosts.subreddit, options.subreddit));
      }

      const posts = await db.select({
        detectedStocks: redditPosts.detectedStocks,
        sentimentScore: redditPosts.sentimentScore,
      })
        .from(redditPosts)
        .where(and(...clauses));

      const stockStats = new Map<string, { totalScore: number; count: number }>();

      for (const post of posts) {
        const stocks = normalizeDetectedStockSymbols(post.detectedStocks);
        const sentiment = Number(post.sentimentScore) || 0;

        for (const stock of stocks) {
          const current = stockStats.get(stock) || { totalScore: 0, count: 0 };
          current.totalScore += sentiment;
          current.count += 1;
          stockStats.set(stock, current);
        }
      }

      // Convert to array and filter/sort
      const recommendations = Array.from(stockStats.entries())
        .map(([symbol, stats]) => {
          const avgScore = stats.totalScore / stats.count;
          return {
            symbol,
            score: avgScore,
            mentions: stats.count,
            sentiment: avgScore > 0.1 ? 'positive' : avgScore < -0.1 ? 'negative' : 'neutral' as 'positive' | 'negative' | 'neutral',
            reason: avgScore > 0.5 ? 'Strong Bullish Sentiment' :
              avgScore > 0.1 ? 'Positive Sentiment' :
                avgScore < -0.5 ? 'Strong Bearish Signal' :
                  avgScore < -0.1 ? 'Negative Sentiment' : 'Mixed Signals'
          };
        })
        .filter(item => item.mentions >= 2) // Minimum threshold
        .sort((a, b) => b.score - a.score) // Sort by highest sentiment
        .slice(0, limit);

      return recommendations;
    } catch (error) {
      console.error('Error getting recommended stocks:', error);
      return [];
    }
  }

  /**
   * Get detailed sentiment analytics (time-windowed overview and top posts)
   */
  async getSentimentAnalytics(
    hours: number = 24,
    filters?: { minScore: number; subreddit?: string }
  ) {
    try {
      return await redditSentimentAnalyzer.getSentimentAnalytics(hours, filters);
    } catch (error) {
      console.error('Error getting sentiment analytics:', error);
      return null;
    }
  }

  /**
   * Get stock and sector sentiment analytics
   */
  async getStockSectorSentiment(
    hours: number = 24,
    filters?: { minScore: number; subreddit?: string }
  ) {
    try {
      // Delegate to the sentiment analyzer which properly queries sentiment_scores table
      const { redditSentimentAnalyzer } = await import('./redditSentimentAnalyzer.js');
      return await redditSentimentAnalyzer.getStockSectorSentiment(hours, filters);
    } catch (error) {
      console.error('Error getting stock/sector sentiment:', error);
      return null;
    }
  }
}

export const redditOrchestrator = new RedditOrchestrator(); 