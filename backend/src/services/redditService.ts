// Reddit API Service for fetching posts and performing sentiment analysis
// Uses snoowrap OAuth when credentials are present; falls back to the public
// read-only JSON API so the service is still functional without a Reddit app.

import { db } from '../db/connection.js';
import { redditPosts, redditComments, redditApiCalls, subredditConfigs } from '../db/schema.js';
import { eq, sql, gte, desc } from 'drizzle-orm';
import { getSnoowrapClient, getSnoowrapClientForUser } from './snoowrapClient.js';

// Local type definitions for Reddit entities
export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  content: string | null;
  author: string;
  score: number;
  upvoteRatio: number;
  numComments: number;
  created: Date;
  url: string | null;
  domain: string | null;
  flair: string | null;
  isStickied: boolean;
  isLocked: boolean;
  isNsfw: boolean;
  permalink: string;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  confidenceScore: number | null;
  fetchedAt: Date;
  lastUpdated: Date;
}

export interface RedditComment {
  id: string;
  postId: string;
  parentId: string | null;
  author: string;
  content: string;
  score: number;
  created: Date;
  edited: Date | null;
  isStickied: boolean;
  depth: number;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  confidenceScore: number | null;
  fetchedAt: Date;
  lastUpdated: Date;
}

export interface RedditApiCall {
  id: number;
  endpoint: string;
  method: string;
  parameters: any;
  responseCode: number;
  responseTime: number;
  rateLimited: boolean;
  errorMessage: string | null;
  postId: string | null;
  postsCount: number | null;
  commentsCount: number | null;
  calledAt: Date;
}

export interface SubredditConfig {
  id: number;
  name: string;
  displayName: string;
  description: string | null;
  isActive: boolean;
  fetchPosts: boolean;
  fetchComments: boolean;
  maxPostAge: number;
  maxCommentAge: number;
  lastFetched: Date | null;
  fetchInterval: number;
  enableSentiment: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Types for Reddit API responses
/** Raw Reddit submission payload from JSON API / snoowrap — safe to persist via ingestPostFromRaw. */
export interface RedditPostData {
  id: string;
  subreddit: string;
  title: string;
  selftext?: string;
  author: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  created_utc: number;
  url?: string;
  domain?: string;
  link_flair_text?: string;
  stickied: boolean;
  locked: boolean;
  over_18: boolean;
  permalink: string;
}

interface RedditCommentData {
  id: string;
  parent_id: string;
  author: string;
  body: string;
  score: number;
  created_utc: number;
  edited?: number | boolean;
  stickied: boolean;
  depth: number;
  replies?: {
    data?: {
      children: Array<{ data: RedditCommentData }>;
    };
  };
}


export class RedditService {
  private readonly baseUrl = 'https://oauth.reddit.com'; // OAuth base for authenticated requests
  private readonly fallbackBaseUrl = 'https://www.reddit.com'; // Unauthenticated fallback
  private readonly userAgent =
    process.env.REDDIT_USER_AGENT || 'InwestApp/1.0 (investment-sentiment-analysis)';
  private readonly rateLimitDelay = 1100; // ~1 req/s unauthenticated; snoowrap handles its own throttle
  private lastRequestTime = 0;

  // Rate limiting for unauthenticated fallback
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.rateLimitDelay) {
      await new Promise(resolve =>
        setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest)
      );
    }

    this.lastRequestTime = Date.now();
  }

  // Unauthenticated JSON API fallback — used when snoowrap is unavailable.
  private async makeApiCall(
    endpoint: string,
    params: Record<string, any> = {}
  ): Promise<{ data: any; apiCall: { id: number } }> {
    await this.waitForRateLimit();

    const startTime = Date.now();
    const url = new URL(`${this.fallbackBaseUrl}${endpoint}.json`);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value.toString());
      }
    });

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
        },
      });

      const responseTime = Date.now() - startTime;

      // Validate content-type before parsing — Reddit may return HTML on errors
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(
          `Reddit API returned non-JSON response (${response.status}): ${contentType}`
        );
      }

      const responseData = await response.json();

      const apiCallResult = await db.insert(redditApiCalls)
        .values({
          endpoint,
          parameters: params,
          responseCode: response.status,
          responseTime,
          rateLimited: response.status === 429,
          errorMessage: response.ok ? null : `HTTP ${response.status}: ${response.statusText}`,
          postsCount: this.countPosts(responseData),
          commentsCount: this.countComments(responseData),
        })
        .returning();

      if (!response.ok) {
        throw new Error(`Reddit API error: ${response.status} ${response.statusText}`);
      }

      return {
        data: responseData,
        apiCall: { id: apiCallResult[0]?.id || 0 },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      await db.insert(redditApiCalls).values({
        endpoint,
        parameters: params,
        responseCode: 0,
        responseTime,
        rateLimited: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  // Map a snoowrap Submission object to our internal RedditPostData shape
  // so the rest of the class stays unchanged.
  private mapSnoowrapPost(s: any): RedditPostData {
    return {
      id: s.id,
      subreddit: s.subreddit_name_prefixed?.replace('r/', '') || s.subreddit || '',
      title: s.title || '',
      selftext: s.selftext || '',
      author: typeof s.author === 'string' ? s.author : (s.author?.name ?? '[deleted]'),
      score: s.score ?? 0,
      upvote_ratio: s.upvote_ratio ?? 0,
      num_comments: s.num_comments ?? 0,
      created_utc: s.created_utc ?? 0,
      url: s.url || undefined,
      domain: s.domain || undefined,
      link_flair_text: s.link_flair_text || undefined,
      stickied: s.stickied ?? false,
      locked: s.locked ?? false,
      over_18: s.over_18 ?? false,
      permalink: s.permalink || `/${s.id}`,
    };
  }

  // Map a snoowrap Comment to our internal RedditCommentData shape.
  // Note: snoowrap manages the comment tree itself; `replies` is intentionally omitted
  // from the mapped shape and the tree is flattened separately.
  private mapSnoowrapComment(c: any): RedditCommentData {
    return {
      id: c.id,
      parent_id: c.parent_id || '',
      author: typeof c.author === 'string' ? c.author : (c.author?.name ?? '[deleted]'),
      body: c.body || '',
      score: c.score ?? 0,
      created_utc: c.created_utc ?? 0,
      edited: c.edited || false,
      stickied: c.stickied ?? false,
      depth: c.depth ?? 0,
    };
  }

  // Recursively flatten snoowrap comment tree into a flat array.
  private flattenSnoowrapComments(comments: any[]): RedditCommentData[] {
    const flat: RedditCommentData[] = [];
    for (const c of comments) {
      if (!c || !c.body || c.body === '[deleted]' || c.body === '[removed]') continue;
      flat.push(this.mapSnoowrapComment(c));
      if (Array.isArray(c.replies)) {
        flat.push(...this.flattenSnoowrapComments(c.replies));
      }
    }
    return flat;
  }

  // Count posts in response
  private countPosts(data: any): number {
    if (!data?.data?.children) return 0;
    return data.data.children.filter((child: any) => 
      child.data && !child.data.body // Posts don't have body, comments do
    ).length;
  }

  // Count comments in response
  private countComments(data: any): number {
    if (!data?.data?.children) return 0;
    return data.data.children.filter((child: any) => 
      child.data && child.data.body // Comments have body
    ).length;
  }

  // Check if post exists in database
  private async postExists(postId: string): Promise<boolean> {
    const existing = await db.select({ id: redditPosts.id })
      .from(redditPosts)
      .where(eq(redditPosts.id, postId))
      .limit(1);
    return existing.length > 0;
  }

  // Check if comment exists in database
  private async commentExists(commentId: string): Promise<boolean> {
    const existing = await db.select({ id: redditComments.id })
      .from(redditComments)
      .where(eq(redditComments.id, commentId))
      .limit(1);
    return existing.length > 0;
  }

  // Save post to database - simplified to avoid complex Drizzle operations
  private async savePost(postData: RedditPostData, _apiCallId: number): Promise<RedditPost> {
    const exists = await this.postExists(postData.id);
    
    const postObject: RedditPost = {
      id: postData.id,
      subreddit: postData.subreddit,
      title: postData.title,
      content: postData.selftext || null,
      author: postData.author,
      score: postData.score,
      upvoteRatio: postData.upvote_ratio,
      numComments: postData.num_comments,
      created: new Date(postData.created_utc * 1000),
      url: postData.url || null,
      domain: postData.domain || null,
      flair: postData.link_flair_text || null,
      isStickied: postData.stickied,
      isLocked: postData.locked,
      isNsfw: postData.over_18,
      permalink: postData.permalink,
      sentimentScore: null,
      sentimentLabel: null,
      confidenceScore: null,
      fetchedAt: new Date(),
      lastUpdated: new Date(),
    };
    
    if (exists) {
      // Update existing post
      await db.update(redditPosts)
        .set({
          score: postData.score,
          upvoteRatio: postData.upvote_ratio.toString(), // Convert to string for decimal field
          numComments: postData.num_comments,
          lastUpdated: new Date(),
        })
        .where(eq(redditPosts.id, postData.id));
      return { ...postObject, lastUpdated: new Date() };
    }

    // Create new post
    await db.insert(redditPosts)
      .values({
        id: postData.id,
        subreddit: postData.subreddit,
        title: postData.title,
        content: postData.selftext || null,
        author: postData.author,
        score: postData.score,
        upvoteRatio: postData.upvote_ratio.toString(), // Convert to string for decimal field
        numComments: postData.num_comments,
        created: new Date(postData.created_utc * 1000),
        url: postData.url || null,
        domain: postData.domain || null,
        flair: postData.link_flair_text || null,
        isStickied: postData.stickied,
        isLocked: postData.locked,
        isNsfw: postData.over_18,
        permalink: postData.permalink,
        fetchedAt: new Date(),
        lastUpdated: new Date(),
      });

    return postObject;
  }

  // Save comment to database - simplified
  private async saveComment(
    commentData: RedditCommentData,
    postId: string,
    postCreatedAt: Date
  ): Promise<RedditComment | null> {
    const commentCreatedAt = new Date(commentData.created_utc * 1000);
    const daysDiff = (commentCreatedAt.getTime() - postCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
    
    // Skip comments added more than 2 days after the post
    if (daysDiff > 2) {
      return null;
    }

    const exists = await this.commentExists(commentData.id);
    
    // Extract parent ID (remove prefix if present)
    let parentId: string | null = commentData.parent_id;
    if (parentId.startsWith('t1_')) {
      parentId = parentId.substring(3);
    } else if (parentId.startsWith('t3_')) {
      parentId = null; // Top-level comment (parent is the post)
    }

    const commentObject: RedditComment = {
      id: commentData.id,
      postId,
      parentId,
      author: commentData.author,
      content: commentData.body,
      score: commentData.score,
      created: commentCreatedAt,
      edited: typeof commentData.edited === 'number' ? new Date(commentData.edited * 1000) : null,
      isStickied: commentData.stickied,
      depth: commentData.depth,
      sentimentScore: null,
      sentimentLabel: null,
      confidenceScore: null,
      fetchedAt: new Date(),
      lastUpdated: new Date(),
    };
    
    if (exists) {
      // Update existing comment
      await db.update(redditComments)
        .set({
          score: commentData.score,
          lastUpdated: new Date(),
        })
        .where(eq(redditComments.id, commentData.id));
      return { ...commentObject, lastUpdated: new Date() };
    }

    // Create new comment
    await db.insert(redditComments)
      .values({
        id: commentData.id,
        postId,
        parentId,
        author: commentData.author,
        content: commentData.body,
        score: commentData.score,
        created: commentCreatedAt,
        edited: typeof commentData.edited === 'number' ? new Date(commentData.edited * 1000) : null,
        isStickied: commentData.stickied,
        depth: commentData.depth,
        fetchedAt: new Date(),
        lastUpdated: new Date(),
      });

    return commentObject;
  }

  // Recursively save comments and replies
  private async saveCommentsRecursively(
    comments: RedditCommentData[],
    postId: string,
    postCreatedAt: Date
  ): Promise<RedditComment[]> {
    const savedComments: RedditComment[] = [];

    for (const commentData of comments) {
      if (!commentData.body || commentData.body === '[deleted]' || commentData.body === '[removed]') {
        continue;
      }

      const savedComment = await this.saveComment(commentData, postId, postCreatedAt);
      if (savedComment) {
        savedComments.push(savedComment);
      }

      // Process replies
      if (commentData.replies?.data?.children) {
        const replies = commentData.replies.data.children
          .map(child => child.data)
          .filter(data => data.body);
        
        const savedReplies = await this.saveCommentsRecursively(replies, postId, postCreatedAt);
        savedComments.push(...savedReplies);
      }
    }

    return savedComments;
  }

  // Fetch posts from a subreddit — uses snoowrap OAuth when credentials are
  // present; falls back to unauthenticated JSON API otherwise.
  async fetchSubredditPosts(
    subreddit: string,
    sort: 'hot' | 'new' | 'top' | 'rising' = 'hot',
    limit: number = 25,
    timeframe?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all',
    userId?: string
  ): Promise<RedditPost[]> {
    const startTime = Date.now();
    let rawPostDataList: RedditPostData[] = [];

    // --- Attempt snoowrap (OAuth) ---
    const client = userId
      ? await getSnoowrapClientForUser(userId)
      : await getSnoowrapClient();
    if (client) {
      try {
        const sub = (client as any).getSubreddit(subreddit);
        const opts: Record<string, any> = { limit };
        if (sort === 'top' && timeframe) opts.time = timeframe;

        let listing: any[];
        if (sort === 'hot') listing = await sub.getHot(opts);
        else if (sort === 'new') listing = await sub.getNew(opts);
        else if (sort === 'top') listing = await sub.getTop(opts);
        else listing = await sub.getRising(opts);

        rawPostDataList = (listing as any[]).map(s => this.mapSnoowrapPost(s));

        await db.insert(redditApiCalls).values({
          endpoint: `/r/${subreddit}/${sort}`,
          parameters: { limit, ...(timeframe ? { t: timeframe } : {}) },
          responseCode: 200,
          responseTime: Date.now() - startTime,
          rateLimited: false,
          errorMessage: null,
          postsCount: rawPostDataList.length,
          commentsCount: 0,
        });
      } catch (snoowrapError) {
        console.warn(
          `[Reddit] snoowrap fetch failed for r/${subreddit}, falling back to JSON API:`,
          snoowrapError instanceof Error ? snoowrapError.message : snoowrapError
        );
        rawPostDataList = []; // trigger fallback
      }
    }

    // --- Unauthenticated JSON API fallback ---
    if (rawPostDataList.length === 0 && !client) {
      const endpoint = `/r/${subreddit}/${sort}`;
      const params: Record<string, any> = { limit };
      if (timeframe && sort === 'top') params.t = timeframe;

      const { data } = await this.makeApiCall(endpoint, params);
      rawPostDataList = (data?.data?.children ?? [])
        .map((child: any) => child.data as RedditPostData)
        .filter((p: RedditPostData) => p.id);
    }

    const posts: RedditPost[] = [];
    for (const postData of rawPostDataList) {
      if (postData.id) {
        const saved = await this.savePost(postData, 0);
        posts.push(saved);
      }
    }

    return posts;
  }

  /**
   * One page of `/r/{sub}/top` or `/new` without persisting (for historical backfill).
   * Uses the same unauthenticated JSON API + rate limiting as `makeApiCall`.
   */
  async fetchListingPageRaw(
    subreddit: string,
    kind: 'top' | 'new',
    options: {
      limit?: number;
      /** top only */
      timeframe?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
      after?: string | null;
      before?: string | null;
    } = {}
  ): Promise<{
    items: RedditPostData[];
    after: string | null;
    before: string | null;
  }> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 100);
    const params: Record<string, string | number> = { limit };
    if (kind === 'top' && options.timeframe) params.t = options.timeframe;
    if (options.after) params.after = options.after;
    if (options.before) params.before = options.before;

    const endpoint = `/r/${subreddit}/${kind}`;
    const { data } = await this.makeApiCall(endpoint, params);
    const children = data?.data?.children ?? [];
    const items: RedditPostData[] = [];
    for (const child of children) {
      const d = child?.data as RedditPostData | undefined;
      if (d?.id) items.push(d);
    }
    return {
      items,
      after: data?.data?.after ?? null,
      before: data?.data?.before ?? null,
    };
  }

  /** Upsert a single post from API payload (used by backfill; avoids duplicate fetch path). */
  async ingestPostFromRaw(postData: RedditPostData): Promise<RedditPost> {
    return this.savePost(postData, 0);
  }

  // Fetch comments for a specific post — uses snoowrap when available.
  async fetchPostComments(postId: string, userId?: string): Promise<RedditComment[]> {
    try {
      const postResult = await db
        .select({ created: redditPosts.created, permalink: redditPosts.permalink })
        .from(redditPosts)
        .where(eq(redditPosts.id, postId))
        .limit(1);

      if (postResult.length === 0) {
        throw new Error(`Post ${postId} not found in database`);
      }

      const post = postResult[0];
      if (!post?.created) {
        throw new Error(`Post ${postId} missing creation date`);
      }

      // --- snoowrap path ---
      const client = userId
        ? await getSnoowrapClientForUser(userId)
        : await getSnoowrapClient();
      if (client) {
        try {
          const submission = await (client as any).getSubmission(postId).expandReplies({
            limit: 500,
            depth: 10,
          });
          const rawComments = this.flattenSnoowrapComments(
            Array.isArray(submission.comments) ? submission.comments : []
          );
          return await this.saveCommentsRecursively(rawComments, postId, post.created);
        } catch (snoowrapError) {
          console.warn(
            `[Reddit] snoowrap comment fetch failed for post ${postId}, falling back:`,
            snoowrapError instanceof Error ? snoowrapError.message : snoowrapError
          );
        }
      }

      // --- unauthenticated JSON API fallback ---
      if (!post?.permalink) {
        throw new Error(`Post ${postId} missing permalink for fallback fetch`);
      }

      const { data } = await this.makeApiCall(post.permalink, {
        limit: 500,
        depth: 10,
        sort: 'top',
      });

      if (!Array.isArray(data) || data.length < 2) return [];

      const commentsData = data[1];
      if (!commentsData?.data?.children) return [];

      const comments = commentsData.data.children
        .map((child: any) => child.data)
        .filter((d: any) => d.body);

      return await this.saveCommentsRecursively(comments, postId, post.created);
    } catch (error) {
      console.error(`Error fetching comments for post ${postId}:`, error);
      return [];
    }
  }

  // Get subreddit configuration
  async getSubredditConfig(subreddit: string): Promise<SubredditConfig | null> {
    const result = await db.select()
      .from(subredditConfigs)
      .where(eq(subredditConfigs.name, subreddit))
      .limit(1);
    
    return result.length > 0 ? result[0] as SubredditConfig : null;
  }

  // Update subreddit last fetched time
  async updateSubredditLastFetched(subreddit: string): Promise<void> {
    await db.update(subredditConfigs)
      .set({ lastFetched: new Date() })
      .where(eq(subredditConfigs.name, subreddit));
  }

  // Check if subreddit can be fetched (rate limiting)
  async canFetchSubreddit(subreddit: string): Promise<boolean> {
    const config = await this.getSubredditConfig(subreddit);
    
    if (!config || !config.isActive) {
      return false;
    }

    if (!config.lastFetched) {
      return true;
    }

    const timeSinceLastFetch = Date.now() - config.lastFetched.getTime();
    return timeSinceLastFetch >= (config.fetchInterval * 1000);
  }

  // Get posts with sentiment analysis - simplified to avoid complex joins
  async getPostsWithSentiment(
    subreddit?: string,
    limit: number = 50,
    sortBy: 'created' | 'score' | 'sentimentScore' = 'created'
  ): Promise<RedditPost[]> {
    try {
      let query = db.select().from(redditPosts);
      
      if (subreddit) {
        query = query.where(eq(redditPosts.subreddit, subreddit)) as any;
      }

      // Apply sorting
      if (sortBy === 'created') {
        query = query.orderBy(desc(redditPosts.created)) as any;
      } else if (sortBy === 'score') {
        query = query.orderBy(desc(redditPosts.score)) as any;
      } else if (sortBy === 'sentimentScore') {
        query = query.orderBy(desc(redditPosts.sentimentScore)) as any;
      }

      const result = await (query as any).limit(limit);
      
      // Convert the result to match RedditPost interface
      return result.map((row: any) => ({
        ...row,
        upvoteRatio: row.upvoteRatio ? parseFloat(row.upvoteRatio) : 0,
        sentimentScore: row.sentimentScore ? parseFloat(row.sentimentScore) : null,
        confidenceScore: row.confidenceScore ? parseFloat(row.confidenceScore) : null,
      })) as RedditPost[];
    } catch (error) {
      console.error('Error fetching posts with sentiment:', error);
      return [];
    }
  }

  // Get API call statistics - simplified
  async getApiStats(hours: number = 24): Promise<{
    totalCalls: number;
    successfulCalls: number;
    rateLimitedCalls: number;
    averageResponseTime: number;
    postsRetrieved: number;
    commentsRetrieved: number;
  }> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const statsResult = await db.select({
      totalCalls: sql<number>`COUNT(*)`,
      successfulCalls: sql<number>`COUNT(*) FILTER (WHERE response_code >= 200 AND response_code < 300)`,
      rateLimitedCalls: sql<number>`COUNT(*) FILTER (WHERE rate_limited = TRUE)`,
      averageResponseTime: sql<number>`AVG(response_time)`,
      postsRetrieved: sql<number>`SUM(COALESCE(posts_count, 0))`,
      commentsRetrieved: sql<number>`SUM(COALESCE(comments_count, 0))`,
    })
    .from(redditApiCalls)
    .where(gte(redditApiCalls.calledAt, since));

    const stats = statsResult[0];
    return {
      totalCalls: Number(stats?.totalCalls) || 0,
      successfulCalls: Number(stats?.successfulCalls) || 0,
      rateLimitedCalls: Number(stats?.rateLimitedCalls) || 0,
      averageResponseTime: Math.round(Number(stats?.averageResponseTime)) || 0,
      postsRetrieved: Number(stats?.postsRetrieved) || 0,
      commentsRetrieved: Number(stats?.commentsRetrieved) || 0,
    };
  }

  // Initialize default subreddit configurations
  async initializeDefaultSubreddits(): Promise<void> {
    const defaultSubreddits = [
      { name: 'investing', displayName: 'r/investing', description: 'Investment discussion and advice' },
      { name: 'stocks', displayName: 'r/stocks', description: 'Stock market discussion' },
      { name: 'wallstreetbets', displayName: 'r/wallstreetbets', description: 'High-risk trading discussion' },
      { name: 'SecurityAnalysis', displayName: 'r/SecurityAnalysis', description: 'Fundamental analysis' },
      { name: 'ValueInvesting', displayName: 'r/ValueInvesting', description: 'Value investing strategies' },
      { name: 'financialindependence', displayName: 'r/financialindependence', description: 'FIRE movement' },
      { name: 'personalfinance', displayName: 'r/personalfinance', description: 'Personal finance advice' },
    ];

    for (const subreddit of defaultSubreddits) {
      await db.insert(subredditConfigs)
        .values(subreddit)
        .onConflictDoUpdate({ 
          target: [subredditConfigs.name], 
          set: { 
            displayName: subreddit.displayName,
            description: subreddit.description
          }
        });
    }
  }
}

export const redditService = new RedditService(); 