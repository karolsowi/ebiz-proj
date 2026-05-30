import { createHash } from 'crypto';
import { eq, desc, asc, and, gte, lte, sql, inArray } from 'drizzle-orm';

function hashParams(params: Record<string, any>): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  return createHash('sha256').update(sorted).digest('hex');
}
import { db } from '../db/connection';
import {
  portfolioEntries,
  historicalPrices,
  apiResponseCache,
  newsArticles,
  redditPosts,
  sentimentScores,
  watchlist,
  importHistory,
  schema
} from '../db/schema';

// Portfolio Management
export class PortfolioService {
  // Add or update portfolio entry
  async addOrUpdateEntry(entry: {
    symbol: string;
    name?: string;
    quantity: string;
    averageCost: string;
    currentPrice?: string;
    sector?: string;
    industry?: string;
    assetType?: string;
    source?: string;
    notes?: string;
  }, userId: string) {
    const whereClause = and(eq(portfolioEntries.symbol, entry.symbol), eq(portfolioEntries.userId, userId));
    const existingEntry = await db
      .select()
      .from(portfolioEntries)
      .where(whereClause)
      .limit(1);
    const values = { ...entry, userId };

    if (existingEntry.length > 0) {
      // Update existing entry
      return await db
        .update(portfolioEntries)
        .set({
          ...values,
          updatedAt: new Date(),
        })
        .where(whereClause)
        .returning();
    } else {
      // Insert new entry
      return await db
        .insert(portfolioEntries)
        .values(values)
        .returning();
    }
  }

  // Get all portfolio entries
  async getAllEntries(userId: string) {
    return await db
      .select()
      .from(portfolioEntries)
      .where(eq(portfolioEntries.userId, userId))
      .orderBy(desc(portfolioEntries.updatedAt));
  }

  // Get portfolio entry by symbol
  async getEntryBySymbol(symbol: string, userId: string) {
    const whereClause = and(eq(portfolioEntries.symbol, symbol), eq(portfolioEntries.userId, userId));
    return await db
      .select()
      .from(portfolioEntries)
      .where(whereClause)
      .limit(1);
  }

  // Delete portfolio entry
  async deleteEntry(symbol: string, userId: string) {
    return await db
      .delete(portfolioEntries)
      .where(and(eq(portfolioEntries.symbol, symbol), eq(portfolioEntries.userId, userId)))
      .returning();
  }

  // Get portfolio summary
  async getPortfolioSummary(userId: string) {
    const result = await db
      .select({
        totalValue: sql<number>`SUM(CAST(${portfolioEntries.totalValue} AS DECIMAL))`,
        totalGainLoss: sql<number>`SUM(CAST(${portfolioEntries.gainLoss} AS DECIMAL))`,
        entryCount: sql<number>`COUNT(*)`,
      })
      .from(portfolioEntries)
      .where(eq(portfolioEntries.userId, userId));

    return result[0];
  }
}

// Historical Price Management
export class PriceService {
  // Store historical price data
  async storePriceData(priceData: {
    symbol: string;
    date: Date;
    open: string;
    high: string;
    low: string;
    close: string;
    volume?: number;
    adjustedClose?: string;
    dividendAmount?: string;
    splitCoefficient?: string;
    source: string;
    timeframe?: string;
  }) {
    return await db
      .insert(historicalPrices)
      .values(priceData)
      .onConflictDoUpdate({
        target: [historicalPrices.symbol, historicalPrices.date, historicalPrices.timeframe],
        set: {
          open: priceData.open,
          high: priceData.high,
          low: priceData.low,
          close: priceData.close,
          volume: priceData.volume ?? null,
          adjustedClose: priceData.adjustedClose ?? null,
          dividendAmount: priceData.dividendAmount ?? null,
          splitCoefficient: priceData.splitCoefficient ?? null,
          source: priceData.source,
        },
      })
      .returning();
  }

  // Get historical prices for a symbol
  async getPriceHistory(symbol: string, startDate?: Date, endDate?: Date, timeframe = 'daily') {
    const conditions = [
      eq(historicalPrices.symbol, symbol),
      eq(historicalPrices.timeframe, timeframe)
    ];

    if (startDate) {
      conditions.push(gte(historicalPrices.date, startDate));
    }

    if (endDate) {
      conditions.push(lte(historicalPrices.date, endDate));
    }

    return await db
      .select()
      .from(historicalPrices)
      .where(and(...conditions))
      .orderBy(desc(historicalPrices.date));
  }

  /** One query per chunk — used to prefetch OHLC for full-universe backtest days. */
  async getDailyPriceBarsForSymbols(
    symbols: string[],
    startDate: Date,
    endDate: Date
  ) {
    const normalized = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (normalized.length === 0) return [];

    const chunkSize = 250;
    const rows: (typeof historicalPrices.$inferSelect)[] = [];

    for (let offset = 0; offset < normalized.length; offset += chunkSize) {
      const chunk = normalized.slice(offset, offset + chunkSize);
      const batch = await db
        .select()
        .from(historicalPrices)
        .where(
          and(
            inArray(historicalPrices.symbol, chunk),
            eq(historicalPrices.timeframe, 'daily'),
            gte(historicalPrices.date, startDate),
            lte(historicalPrices.date, endDate)
          )
        );
      rows.push(...batch);
    }

    return rows;
  }

  // Get latest price for a symbol
  async getLatestPrice(symbol: string) {
    return await db
      .select()
      .from(historicalPrices)
      .where(eq(historicalPrices.symbol, symbol))
      .orderBy(desc(historicalPrices.date))
      .limit(1);
  }

  // Get the first available price on or after a target date within a bounded lookahead window.
  async getPriceOnOrAfter(
    symbol: string,
    targetDate: Date,
    timeframe = 'daily',
    maxLookaheadDays = 5
  ) {
    const endDate = new Date(targetDate);
    endDate.setUTCDate(endDate.getUTCDate() + Math.max(0, maxLookaheadDays));

    return await db
      .select()
      .from(historicalPrices)
      .where(and(
        eq(historicalPrices.symbol, symbol),
        eq(historicalPrices.timeframe, timeframe),
        gte(historicalPrices.date, targetDate),
        lte(historicalPrices.date, endDate)
      ))
      .orderBy(asc(historicalPrices.date))
      .limit(1);
  }

  // Bulk insert price data
  async bulkInsertPrices(pricesData: any[]) {
    return await db
      .insert(historicalPrices)
      .values(pricesData)
      .onConflictDoNothing()
      .returning();
  }
}

// API Response Caching
export class CacheService {
  // Store API response in cache
  async cacheResponse(
    endpoint: string,
    parameters: Record<string, any>,
    response: any,
    source: string,
    expirationMinutes = 60,
    userId = 'public'
  ) {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + expirationMinutes);
    const ph = hashParams(parameters);

    return await db
      .insert(apiResponseCache)
      .values({
        userId,
        endpoint,
        parameters,
        paramHash: ph,
        response,
        source,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [apiResponseCache.userId, apiResponseCache.endpoint, apiResponseCache.paramHash, apiResponseCache.source],
        set: {
          response,
          expiresAt,
          hitCount: sql`${apiResponseCache.hitCount} + 1`,
          lastAccessed: new Date(),
        },
      })
      .returning();
  }

  // Get cached response
  async getCachedResponse(endpoint: string, parameters: Record<string, any>, userId = 'public') {
    const ph = hashParams(parameters);
    const result = await db
      .select()
      .from(apiResponseCache)
      .where(
        and(
          eq(apiResponseCache.userId, userId),
          eq(apiResponseCache.endpoint, endpoint),
          eq(apiResponseCache.paramHash, ph),
          gte(apiResponseCache.expiresAt, new Date())
        )
      )
      .limit(1);

    if (result.length > 0) {
      // Update hit count and last accessed
      await db
        .update(apiResponseCache)
        .set({
          hitCount: sql`${apiResponseCache.hitCount} + 1`,
          lastAccessed: new Date(),
        })
        .where(eq(apiResponseCache.id, result[0]!.id));

      return result[0];
    }

    return null;
  }

  // Clean expired cache entries
  async cleanExpiredCache() {
    return await db
      .delete(apiResponseCache)
      .where(lte(apiResponseCache.expiresAt, new Date()))
      .returning();
  }

  // Get cache statistics
  async getCacheStats() {
    const result = await db
      .select({
        totalEntries: sql<number>`COUNT(*)`,
        totalHits: sql<number>`SUM(${apiResponseCache.hitCount})`,
        expiredEntries: sql<number>`COUNT(*) FILTER (WHERE ${apiResponseCache.expiresAt} < NOW())`,
      })
      .from(apiResponseCache);

    return result[0];
  }
}

// News and Sentiment Management
export class NewsService {
  // Store news article
  async storeNewsArticle(article: {
    title: string;
    summary?: string;
    content?: string;
    url: string;
    imageUrl?: string;
    source: string;
    author?: string;
    publishedAt: Date;
    category?: string;
    symbols?: string[];
    sentiment?: string;
    sentimentScore?: string;
    relevanceScore?: string;
  }) {
    return await db
      .insert(newsArticles)
      .values(article)
      .onConflictDoUpdate({
        target: [newsArticles.url],
        set: {
          title: article.title,
          summary: article.summary ?? null,
          content: article.content ?? null,
          sentiment: article.sentiment ?? null,
          sentimentScore: article.sentimentScore ?? null,
          relevanceScore: article.relevanceScore ?? null,
        },
      })
      .returning();
  }

  // Get news articles by symbol
  async getNewsBySymbol(symbol: string, limit = 50) {
    return await db
      .select()
      .from(newsArticles)
      .where(sql`${newsArticles.symbols} ? ${symbol}`)
      .orderBy(desc(newsArticles.publishedAt))
      .limit(limit);
  }

  // Get recent news
  async getRecentNews(limit = 100, category?: string) {
    if (category) {
      return await db
        .select()
        .from(newsArticles)
        .where(eq(newsArticles.category, category))
        .orderBy(desc(newsArticles.publishedAt))
        .limit(limit);
    }

    return await db
      .select()
      .from(newsArticles)
      .orderBy(desc(newsArticles.publishedAt))
      .limit(limit);
  }

  // Store Reddit post
  async storeRedditPost(post: {
    id: string;
    subreddit: string;
    title: string;
    content?: string;
    author?: string;
    score: number;
    upvoteRatio?: string;
    numComments: number;
    url?: string;
    domain?: string;
    flair?: string;
    isStickied?: boolean;
    isLocked?: boolean;
    isNsfw?: boolean;
    permalink: string;
    created: Date;
    sentimentScore?: string;
    sentimentLabel?: string;
    confidenceScore?: string;
  }) {
    return await db
      .insert(redditPosts)
      .values(post)
      .onConflictDoUpdate({
        target: [redditPosts.id],
        set: {
          score: post.score,
          numComments: post.numComments,
          sentimentScore: post.sentimentScore ?? null,
          sentimentLabel: post.sentimentLabel ?? null,
          confidenceScore: post.confidenceScore ?? null,
          lastUpdated: new Date(),
        },
      })
      .returning();
  }

  // Get Reddit posts by subreddit
  async getRedditPostsBySubreddit(subreddit: string, limit = 50) {
    return await db
      .select()
      .from(redditPosts)
      .where(eq(redditPosts.subreddit, subreddit))
      .orderBy(desc(redditPosts.created))
      .limit(limit);
  }
}

// Sentiment Analysis
export class SentimentService {
  // Store sentiment score
  async storeSentimentScore(sentiment: {
    symbol: string;
    date: Date;
    timeframe?: string;
    source: string;
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
    totalMentions: number;
    averageSentiment?: string;
    weightedSentiment?: string;
    confidenceScore?: string;
  }) {
    return await db
      .insert(sentimentScores)
      .values(sentiment)
      .onConflictDoUpdate({
        target: [sentimentScores.symbol, sentimentScores.date, sentimentScores.timeframe, sentimentScores.source],
        set: {
          bullishCount: sentiment.bullishCount,
          bearishCount: sentiment.bearishCount,
          neutralCount: sentiment.neutralCount,
          totalMentions: sentiment.totalMentions,
          averageSentiment: sentiment.averageSentiment ?? null,
          weightedSentiment: sentiment.weightedSentiment ?? null,
          confidenceScore: sentiment.confidenceScore ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
  }

  // Get sentiment history for a symbol
  async getSentimentHistory(symbol: string, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return await db
      .select()
      .from(sentimentScores)
      .where(
        and(
          eq(sentimentScores.symbol, symbol),
          gte(sentimentScores.date, startDate)
        )
      )
      .orderBy(desc(sentimentScores.date));
  }

  // Get aggregated sentiment for multiple symbols
  async getMultiSymbolSentiment(symbols: string[]) {
    return await db
      .select()
      .from(sentimentScores)
      .where(inArray(sentimentScores.symbol, symbols))
      .orderBy(desc(sentimentScores.date));
  }
}

// Watchlist Management
export class WatchlistService {
  // Add symbol to watchlist
  async addToWatchlist(userId: string, symbol: string, name?: string, notes?: string) {
    return await db
      .insert(watchlist)
      .values({
        userId,
        symbol,
        name: name ?? null,
        notes: notes ?? null
      })
      .onConflictDoNothing()
      .returning();
  }

  // Remove from watchlist
  async removeFromWatchlist(userId: string, symbol: string) {
    return await db
      .delete(watchlist)
      .where(and(eq(watchlist.userId, userId), eq(watchlist.symbol, symbol)))
      .returning();
  }

  // Get watchlist
  async getWatchlist(userId: string) {
    return await db
      .select()
      .from(watchlist)
      .where(eq(watchlist.userId, userId))
      .orderBy(desc(watchlist.addedAt));
  }

  // Update watchlist entry
  async updateWatchlistEntry(userId: string, symbol: string, updates: {
    name?: string;
    notes?: string;
    alertPrice?: string;
    alertEnabled?: boolean;
  }) {
    return await db
      .update(watchlist)
      .set(updates)
      .where(and(eq(watchlist.userId, userId), eq(watchlist.symbol, symbol)))
      .returning();
  }
}

// Import History Management
export class ImportService {
  // Record import attempt
  async recordImport(importData: {
    filename: string;
    fileSize?: number;
    importType: string;
    status?: string;
    metadata?: Record<string, any>;
  }) {
    return await db
      .insert(importHistory)
      .values(importData)
      .returning();
  }

  // Update import status
  async updateImportStatus(
    id: number,
    status: string,
    recordsProcessed?: number,
    recordsSuccessful?: number,
    recordsFailed?: number,
    errorLog?: any[]
  ) {
    const updateData: any = {
      status,
      completedAt: status === 'completed' || status === 'failed' ? new Date() : undefined,
    };

    if (recordsProcessed !== undefined) {
      updateData.recordsProcessed = recordsProcessed;
    }
    if (recordsSuccessful !== undefined) {
      updateData.recordsSuccessful = recordsSuccessful;
    }
    if (recordsFailed !== undefined) {
      updateData.recordsFailed = recordsFailed;
    }
    if (errorLog !== undefined) {
      updateData.errorLog = errorLog;
    }

    return await db
      .update(importHistory)
      .set(updateData)
      .where(eq(importHistory.id, id))
      .returning();
  }

  // Get import history
  async getImportHistory(limit = 50) {
    return await db
      .select()
      .from(importHistory)
      .orderBy(desc(importHistory.createdAt))
      .limit(limit);
  }
}

// Export service instances
export const portfolioService = new PortfolioService();
export const priceService = new PriceService();
export const cacheService = new CacheService();
export const newsService = new NewsService();
export const sentimentService = new SentimentService();
export const watchlistService = new WatchlistService();
export const importService = new ImportService();

// Generic Database Management (Viewer)
export class GenericDBService {
  // Get all available tables
  getTables() {
    return Object.keys(schema);
  }

  // Get data from a specific table
  async getTableData(tableName: string, options: {
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const table = (schema as any)[tableName];
    if (!table) {
      throw new Error(`Table ${tableName} not found`);
    }

    const { limit = 50, offset = 0, sortBy, sortOrder = 'asc' } = options;

    let query: any = db.select().from(table);

    if (sortBy && table[sortBy]) {
      if (sortOrder === 'desc') {
        query = query.orderBy(desc(table[sortBy]));
      } else {
        query = query.orderBy(asc(table[sortBy]));
      }
    } else {
      if (table.createdAt) {
        query = query.orderBy(desc(table.createdAt));
      } else if (table.id) {
        query = query.orderBy(desc(table.id));
      }
    }

    const data = await query.limit(limit).offset(offset);
    const totalResult = await db.select({ count: sql<number>`count(*)` }).from(table);
    const total = Number(totalResult[0]?.count || 0);

    return {
      tableName,
      data,
      pagination: {
        total,
        page: Math.floor(offset / limit) + 1,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }
}

export const genericDBService = new GenericDBService();

// Minimal database health / stats service (replaces the deleted database.ts stub)
export class DatabaseService {
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    await db.execute(sql`SELECT 1`);
    return { status: 'healthy', timestamp: new Date().toISOString() };
  }

  async getStats(): Promise<Record<string, number>> {
    const tables = Object.keys(schema);
    const counts: Record<string, number> = {};
    for (const tableName of tables) {
      try {
        const table = (schema as any)[tableName];
        const result = await db.select({ count: sql<number>`count(*)` }).from(table);
        counts[tableName] = Number(result[0]?.count || 0);
      } catch {
        counts[tableName] = -1;
      }
    }
    return counts;
  }

  async testTableConnections(): Promise<Array<{ table: string; status: string }>> {
    return Promise.all(
      Object.keys(schema).map(async (tableName) => {
        try {
          const table = (schema as any)[tableName];
          await db.select({ count: sql<number>`count(*)` }).from(table).limit(1);
          return { table: tableName, status: 'ok' };
        } catch (err) {
          return { table: tableName, status: err instanceof Error ? err.message : 'error' };
        }
      })
    );
  }
}

export const databaseService = new DatabaseService();

/** Distinct symbols from all users' portfolios and watchlists — for Stooq incremental EOD sync. */
export async function getTrackedSymbolsForPriceSync(): Promise<string[]> {
  const [portRows, wlRows] = await Promise.all([
    db.select({ symbol: portfolioEntries.symbol }).from(portfolioEntries),
    db.select({ symbol: watchlist.symbol }).from(watchlist),
  ]);
  const set = new Set<string>();
  for (const r of portRows) {
    const s = r.symbol?.trim().toUpperCase();
    if (s) set.add(s);
  }
  for (const r of wlRows) {
    const s = r.symbol?.trim().toUpperCase();
    if (s) set.add(s);
  }
  return [...set].sort();
}
