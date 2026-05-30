// Enhanced Reddit Scraper for High-Quality Posts and Comments
// Focuses on posts with 50+ upvotes within 24h and their top comments

import { redditService, RedditPost, RedditComment } from './redditService.js';
import { db } from '../db/connection.js';
import { redditPosts, redditComments } from '../db/schema.js';
import { and, gte, sql, desc } from 'drizzle-orm';

export interface ScrapingCriteria {
  minUpvotes: number;
  maxAgeHours: number;
  subreddits: string[];
  excludeNsfw: boolean;
  excludeStickied: boolean;
  minComments: number;
  maxPosts: number;
}

export interface ScrapingResult {
  postsScraped: number;
  commentsScraped: number;
  filteredOut: {
    lowUpvotes: number;
    tooOld: number;
    nsfw: number;
    stickied: number;
    noPhoto: number;
  };
  errors: string[];
  executionTime: number;
}

export class EnhancedRedditScraper {
  private readonly defaultCriteria: ScrapingCriteria = {
    minUpvotes: 50,
    maxAgeHours: 24,
    subreddits: [
      'investing', 'stocks', 'wallstreetbets', 'SecurityAnalysis',
      'ValueInvesting', 'financialindependence', 'personalfinance',
      'cryptocurrency', 'ethereum', 'bitcoin'
    ],
    excludeNsfw: true,
    excludeStickied: true,
    minComments: 5,
    maxPosts: 100
  };

  // Main scraping function with quality filters
  async scrapeQualityPosts(customCriteria?: Partial<ScrapingCriteria>): Promise<ScrapingResult> {
    const startTime = Date.now();
    const criteria = { ...this.defaultCriteria, ...customCriteria };

    const result: ScrapingResult = {
      postsScraped: 0,
      commentsScraped: 0,
      filteredOut: {
        lowUpvotes: 0,
        tooOld: 0,
        nsfw: 0,
        stickied: 0,
        noPhoto: 0
      },
      errors: [],
      executionTime: 0
    };

    console.log('🔍 Starting enhanced Reddit scraping with criteria:', criteria);

    for (const subreddit of criteria.subreddits) {
      try {
        await this.scrapeSubredditQuality(subreddit, criteria, result);

        // Rate limiting between subreddits
        await this.delay(2000);
      } catch (error) {
        const errorMsg = `Failed to scrape r/${subreddit}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(errorMsg);
        console.error('❌', errorMsg);
      }
    }

    result.executionTime = Date.now() - startTime;

    console.log('✅ Scraping completed:', {
      posts: result.postsScraped,
      comments: result.commentsScraped,
      time: `${(result.executionTime / 1000).toFixed(1)}s`,
      errors: result.errors.length
    });

    return result;
  }

  // Scrape quality posts from a specific subreddit
  private async scrapeSubredditQuality(
    subreddit: string,
    criteria: ScrapingCriteria,
    result: ScrapingResult
  ): Promise<void> {
    console.log(`📊 Scraping r/${subreddit}...`);

    // Check if we can fetch this subreddit (rate limiting)
    const canFetch = await redditService.canFetchSubreddit(subreddit);
    if (!canFetch) {
      result.errors.push(`Rate limited for r/${subreddit}`);
      return;
    }

    // Fetch hot posts first (most likely to meet criteria)
    const hotPosts = await redditService.fetchSubredditPosts(subreddit, 'hot', 50);
    const qualityPosts = this.filterQualityPosts(hotPosts, criteria, result);

    // If we need more posts, try 'top' posts from today
    if (qualityPosts.length < 10) {
      const topPosts = await redditService.fetchSubredditPosts(subreddit, 'top', 25, 'day');
      const additionalQuality = this.filterQualityPosts(topPosts, criteria, result);
      qualityPosts.push(...additionalQuality);
    }

    // Remove duplicates and limit
    const uniquePosts = this.removeDuplicatePosts(qualityPosts);
    const limitedPosts = uniquePosts.slice(0, Math.ceil(criteria.maxPosts / criteria.subreddits.length));

    // Process each quality post
    for (const post of limitedPosts) {
      try {
        await this.processQualityPost(post, criteria, result);
        await this.delay(1500); // Rate limiting between posts
      } catch (error) {
        result.errors.push(`Failed to process post ${post.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Update subreddit last fetched time
    await redditService.updateSubredditLastFetched(subreddit);
    console.log(`✅ r/${subreddit}: ${limitedPosts.length} quality posts processed`);
  }

  // Filter posts based on quality criteria
  private filterQualityPosts(
    posts: RedditPost[],
    criteria: ScrapingCriteria,
    result: ScrapingResult
  ): RedditPost[] {
    const now = Date.now();
    const maxAge = criteria.maxAgeHours * 60 * 60 * 1000;

    return posts.filter(post => {
      // Check age
      const postAge = now - post.created.getTime();
      if (postAge > maxAge) {
        result.filteredOut.tooOld++;
        return false;
      }

      // Check upvotes
      if (post.score < criteria.minUpvotes) {
        result.filteredOut.lowUpvotes++;
        return false;
      }

      // Check NSFW
      if (criteria.excludeNsfw && post.isNsfw) {
        result.filteredOut.nsfw++;
        return false;
      }

      // Check stickied
      if (criteria.excludeStickied && post.isStickied) {
        result.filteredOut.stickied++;
        return false;
      }

      // Check minimum comments
      if (post.numComments < criteria.minComments) {
        return false;
      }

      // Exclude image/video posts (we want text content)
      if (this.isMediaPost(post)) {
        result.filteredOut.noPhoto++;
        return false;
      }

      return true;
    });
  }

  // Check if post is primarily media content
  private isMediaPost(post: RedditPost): boolean {
    const mediaExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mov'];
    const mediaDomains = ['i.redd.it', 'v.redd.it', 'imgur.com', 'youtube.com', 'youtu.be', 'tiktok.com'];

    if (post.url) {
      // Check file extension
      const hasMediaExtension = mediaExtensions.some(ext =>
        post.url!.toLowerCase().includes(ext)
      );

      // Check domain
      const hasMediaDomain = mediaDomains.some(domain =>
        post.url!.includes(domain)
      );

      return hasMediaExtension || hasMediaDomain;
    }

    return false;
  }

  // Process a quality post and its top comments
  private async processQualityPost(
    post: RedditPost,
    criteria: ScrapingCriteria,
    result: ScrapingResult
  ): Promise<void> {
    result.postsScraped++;

    console.log(`📝 Processing: "${post.title.substring(0, 50)}..." (${post.score} upvotes, ${post.numComments} comments)`);

    // Fetch and process comments
    try {
      const comments = await redditService.fetchPostComments(post.id);
      const qualityComments = this.filterQualityComments(comments, post);

      result.commentsScraped += qualityComments.length;

      if (qualityComments.length > 0) {
        console.log(`  💬 Processed ${qualityComments.length} quality comments`);
      }
    } catch (error) {
      result.errors.push(`Failed to fetch comments for post ${post.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Filter comments for quality and relevance
  private filterQualityComments(comments: RedditComment[], _post: RedditPost): RedditComment[] {
    return comments.filter(comment => {
      // Skip deleted/removed comments
      if (!comment.content || comment.content === '[deleted]' || comment.content === '[removed]') {
        return false;
      }

      // Skip very short comments (less than 20 characters)
      if (comment.content.length < 20) {
        return false;
      }

      // Skip comments with negative score
      if (comment.score < 1) {
        return false;
      }

      // Skip bot comments
      if (this.isBotComment(comment)) {
        return false;
      }

      // Skip comments that are too deep in thread (less engagement)
      if (comment.depth > 3) {
        return false;
      }

      return true;
    })
      .sort((a, b) => b.score - a.score) // Sort by score descending
      .slice(0, 20); // Limit to top 20 comments per post
  }

  // Detect bot comments
  private isBotComment(comment: RedditComment): boolean {
    const botIndicators = [
      'bot', 'Bot', 'BOT',
      'AutoModerator',
      'I am a bot',
      'This action was performed automatically'
    ];

    return botIndicators.some(indicator =>
      comment.author.includes(indicator) ||
      comment.content.includes(indicator)
    );
  }

  // Remove duplicate posts
  private removeDuplicatePosts(posts: RedditPost[]): RedditPost[] {
    const seen = new Set<string>();
    return posts.filter(post => {
      if (seen.has(post.id)) {
        return false;
      }
      seen.add(post.id);
      return true;
    });
  }

  // Get scraped posts with analytics
  async getScrapedPostsWithAnalytics(
    hours: number = 24,
    limit: number = 50
  ): Promise<{
    posts: RedditPost[];
    analytics: {
      totalPosts: number;
      totalComments: number;
      averageScore: number;
      topSubreddits: Array<{ subreddit: string; count: number }>;
      sentimentDistribution: {
        positive: number;
        negative: number;
        neutral: number;
        unanalyzed: number;
      };
    };
  }> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Get posts from the last 24 hours with quality criteria
    const posts = await db.select()
      .from(redditPosts)
      .where(and(
        gte(redditPosts.fetchedAt, since),
        gte(redditPosts.score, 50)
      ))
      .orderBy(desc(redditPosts.score))
      .limit(limit);

    // Get analytics
    const totalComments = await db.select({ count: sql<number>`count(*)` })
      .from(redditComments)
      .where(gte(redditComments.fetchedAt, since));

    const subredditStats = await db.select({
      subreddit: redditPosts.subreddit,
      count: sql<number>`count(*)`
    })
      .from(redditPosts)
      .where(and(
        gte(redditPosts.fetchedAt, since),
        gte(redditPosts.score, 50)
      ))
      .groupBy(redditPosts.subreddit)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const sentimentStats = await db.select({
      sentimentLabel: redditPosts.sentimentLabel,
      count: sql<number>`count(*)`
    })
      .from(redditPosts)
      .where(and(
        gte(redditPosts.fetchedAt, since),
        gte(redditPosts.score, 50)
      ))
      .groupBy(redditPosts.sentimentLabel);

    // Calculate analytics
    const totalPostsCount = posts.length;
    const totalCommentsCount = Number(totalComments[0]?.count) || 0;
    const averageScore = posts.length > 0
      ? Math.round(posts.reduce((sum, post) => sum + post.score, 0) / posts.length)
      : 0;

    const sentimentDistribution = {
      positive: 0,
      negative: 0,
      neutral: 0,
      unanalyzed: 0
    };

    sentimentStats.forEach(stat => {
      const count = Number(stat.count);
      if (!stat.sentimentLabel) {
        sentimentDistribution.unanalyzed += count;
      } else if (stat.sentimentLabel.includes('positive')) {
        sentimentDistribution.positive += count;
      } else if (stat.sentimentLabel.includes('negative')) {
        sentimentDistribution.negative += count;
      } else {
        sentimentDistribution.neutral += count;
      }
    });

    return {
      posts: posts.map(post => ({
        ...post,
        upvoteRatio: post.upvoteRatio ? parseFloat(post.upvoteRatio.toString()) : 0,
        sentimentScore: post.sentimentScore ? parseFloat(post.sentimentScore.toString()) : null,
        confidenceScore: post.confidenceScore ? parseFloat(post.confidenceScore.toString()) : null,
      })) as RedditPost[],
      analytics: {
        totalPosts: totalPostsCount,
        totalComments: totalCommentsCount,
        averageScore,
        topSubreddits: subredditStats.map(stat => ({
          subreddit: stat.subreddit,
          count: Number(stat.count)
        })),
        sentimentDistribution
      }
    };
  }

  // Start automated quality scraping
  async startAutomatedScraping(intervalMinutes: number = 30): Promise<void> {
    console.log(`🚀 Starting automated quality Reddit scraping every ${intervalMinutes} minutes`);

    // Run immediately
    await this.scrapeQualityPosts();

    // Set up interval
    setInterval(async () => {
      try {
        await this.scrapeQualityPosts();
      } catch (error) {
        console.error('Error in automated scraping:', error);
      }
    }, intervalMinutes * 60 * 1000);
  }

  // Utility function for delays
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const enhancedRedditScraper = new EnhancedRedditScraper();