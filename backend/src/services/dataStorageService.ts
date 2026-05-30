// Comprehensive Data Storage Service
// This service handles persistent storage of all API data to reduce dependency on API limits

import { createHash } from 'crypto';
import { eq, desc, and, gte, lte, sql, or } from 'drizzle-orm';
import {
  historicalPrices,
  apiResponseCache,
  newsArticles,
  portfolioEntries,
  sentimentScores
} from '../db/schema';
import { db } from '../db/connection.js';

/** Normalize row counts from raw `db.execute` / postgres-js (shape is not always a plain array). */
function rowsAffectedByExecute(raw: unknown): number {
  if (raw == null) return 0;
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.rowCount === 'number' && o.rowCount >= 0) return o.rowCount;
    if (Array.isArray(o.rows)) return o.rows.length;
    if ('length' in o && typeof o.length === 'number') return o.length;
  }
  return 0;
}

/** Stable SHA-256 hex of sorted-key JSON so key ordering never causes cache misses */
function hashParams(params: Record<string, any>): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  return createHash('sha256').update(sorted).digest('hex');
}

export interface StoredQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
  marketCap?: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  timestamp: Date;
  source: string;
}

export interface StoredNewsArticle {
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
  sentimentScore?: number;
  relevanceScore?: number;
}

export interface CacheEntry {
  userId?: string;
  endpoint: string;
  parameters: Record<string, any>;
  response: any;
  source: string;
  ttl: number; // Time to live in seconds
}

export class DataStorageService {
  private readonly PUBLIC_CACHE_USER = 'public';

  private readonly DEFAULT_CACHE_TTL = {
    quotes: 60, // 1 minute
    historical: 86400, // 24 hours
    news: 3600, // 1 hour
    company: 604800, // 1 week
    earnings: 86400, // 24 hours
    reddit: 1800, // 30 minutes
  };

  // ==================== CACHING LAYER ====================

  async getCachedResponse(endpoint: string, params: Record<string, any>, source: string, userId?: string): Promise<any> {
    try {
      const ph = hashParams(params);
      const cacheUserId = userId ?? this.PUBLIC_CACHE_USER;
      const result = await db
        .select()
        .from(apiResponseCache)
        .where(
          and(
            eq(apiResponseCache.userId, cacheUserId),
            eq(apiResponseCache.endpoint, endpoint),
            eq(apiResponseCache.paramHash, ph),
            eq(apiResponseCache.source, source),
            gte(apiResponseCache.expiresAt, new Date())
          )
        )
        .limit(1);

      if (result.length > 0) {
        const cachedItem = result[0];
        if (!cachedItem) return null;

        await db
          .update(apiResponseCache)
          .set({
            hitCount: sql`${apiResponseCache.hitCount} + 1`,
            lastAccessed: new Date(),
          })
          .where(eq(apiResponseCache.id, cachedItem.id));

        return cachedItem.response;
      }

      return null;
    } catch (error) {
      console.error('Error getting cached response:', error);
      return null;
    }
  }

  async setCachedResponse(entry: CacheEntry): Promise<void> {
    try {
      const ph = hashParams(entry.parameters);
      const expiresAt = new Date(Date.now() + entry.ttl * 1000);
      const cacheUserId = entry.userId ?? this.PUBLIC_CACHE_USER;

      await db
        .insert(apiResponseCache)
        .values({
          userId: cacheUserId,
          endpoint: entry.endpoint,
          parameters: entry.parameters,
          paramHash: ph,
          response: entry.response,
          source: entry.source,
          expiresAt,
          hitCount: 0,
          lastAccessed: new Date(),
        })
        .onConflictDoUpdate({
          target: [apiResponseCache.userId, apiResponseCache.endpoint, apiResponseCache.paramHash, apiResponseCache.source],
          set: {
            parameters: entry.parameters,
            response: entry.response,
            expiresAt,
            hitCount: sql`${apiResponseCache.hitCount} + 1`,
            lastAccessed: new Date(),
          },
        });
    } catch (error) {
      console.error('Error setting cached response:', error);
    }
  }

  async clearExpiredCache(): Promise<number> {
    try {
      const result = await db
        .delete(apiResponseCache)
        .where(lte(apiResponseCache.expiresAt, new Date()))
        .returning({ id: apiResponseCache.id });

      return result.length;
    } catch (error) {
      console.error('Error clearing expired cache:', error);
      return 0;
    }
  }

  // ==================== STOCK DATA STORAGE ====================

  async storeHistoricalPrice(data: {
    symbol: string;
    date: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number | undefined;
    adjustedClose?: number | undefined;
    source: string;
    timeframe?: string | undefined;
  }): Promise<void> {
    try {
      await db.insert(historicalPrices)
        .values({
          symbol: data.symbol.toUpperCase(),
          date: data.date,
          open: data.open.toString(),
          high: data.high.toString(),
          low: data.low.toString(),
          close: data.close.toString(),
          volume: data.volume || 0,
          adjustedClose: data.adjustedClose?.toString() || data.close.toString(),
          source: data.source,
          timeframe: data.timeframe || 'daily'
        })
        .onConflictDoUpdate({
          target: [historicalPrices.symbol, historicalPrices.date, historicalPrices.timeframe],
          set: {
            open: data.open.toString(),
            high: data.high.toString(),
            low: data.low.toString(),
            close: data.close.toString(),
            volume: data.volume || 0,
            adjustedClose: data.adjustedClose?.toString() || data.close.toString()
          }
        });
    } catch (error) {
      console.error('Error storing historical price:', error);
    }
  }

  async getLatestPrice(symbol: string): Promise<{
    symbol: string;
    price: number;
    open: number;
    high: number;
    low: number;
    volume: number;
    date: Date;
    source: string;
  } | null> {
    try {
      const result = await db
        .select()
        .from(historicalPrices)
        .where(eq(historicalPrices.symbol, symbol.toUpperCase()))
        .orderBy(desc(historicalPrices.date))
        .limit(1);

      if (result.length === 0) return null;

      const row = result[0];
      if (!row) return null;

      return {
        symbol: row.symbol,
        price: parseFloat(row.close),
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        volume: row.volume || 0,
        date: row.date,
        source: row.source
      };
    } catch (error) {
      console.error('Error getting latest price:', error);
      return null;
    }
  }

  async getStoredHistoricalPrices(
    symbol: string,
    startDate?: Date,
    endDate?: Date,
    timeframe: string = 'daily'
  ): Promise<any[]> {
    try {
      const conditions = [
        eq(historicalPrices.symbol, symbol.toUpperCase()),
        eq(historicalPrices.timeframe, timeframe)
      ];

      if (startDate) {
        conditions.push(gte(historicalPrices.date, startDate));
      }

      if (endDate) {
        conditions.push(lte(historicalPrices.date, endDate));
      }

      const result = await db
        .select()
        .from(historicalPrices)
        .where(and(...conditions))
        .orderBy(desc(historicalPrices.date));

      return result.map(row => ({
        symbol: row.symbol,
        date: row.date,
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
        volume: row.volume,
        adjustedClose: row.adjustedClose ? parseFloat(row.adjustedClose) : parseFloat(row.close),
        source: row.source
      }));
    } catch (error) {
      console.error('Error getting stored historical prices:', error);
      return [];
    }
  }

  // ==================== NEWS STORAGE ====================

  async storeNewsArticle(article: StoredNewsArticle): Promise<void> {
    try {
      const newsData: any = {
        title: article.title,
        url: article.url,
        source: article.source,
        publishedAt: article.publishedAt,
        isProcessed: true
      };

      if (article.summary) newsData.summary = article.summary;
      if (article.content) newsData.content = article.content;
      if (article.imageUrl) newsData.imageUrl = article.imageUrl;
      if (article.author) newsData.author = article.author;
      if (article.category) newsData.category = article.category;
      if (article.symbols) newsData.symbols = article.symbols;
      if (article.sentiment) newsData.sentiment = article.sentiment;
      if (article.sentimentScore !== undefined) newsData.sentimentScore = article.sentimentScore.toString();
      if (article.relevanceScore !== undefined) newsData.relevanceScore = article.relevanceScore.toString();

      await db.insert(newsArticles)
        .values(newsData)
        .onConflictDoUpdate({
          target: [newsArticles.url],
          set: newsData
        });
    } catch (error) {
      console.error('Error storing news article:', error);
    }
  }

  async getStoredNews(
    symbols?: string[],
    category?: string,
    limit: number = 50,
    hours: number = 24
  ): Promise<any[]> {
    try {
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      let query = db
        .select()
        .from(newsArticles)
        .where(gte(newsArticles.publishedAt, since))
        .$dynamic();

      if (category) {
        query = query.where(
          and(
            gte(newsArticles.publishedAt, since),
            eq(newsArticles.category, category)
          )
        ) as any;
      }

      if (symbols && symbols.length > 0) {
        // Search for any of the symbols in the symbols JSON array
        const symbolConditions = symbols.map(symbol =>
          sql`${newsArticles.symbols}::text LIKE '%"${symbol}"%'`
        );
        query = query.where(
          and(
            gte(newsArticles.publishedAt, since),
            category ? eq(newsArticles.category, category) : sql`1=1`,
            or(...symbolConditions)
          )
        ) as any;
      }

      const result = await (query as any)
        .orderBy(desc(newsArticles.publishedAt))
        .limit(limit);

      return result.map((row: any) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        content: row.content,
        url: row.url,
        imageUrl: row.imageUrl,
        source: row.source,
        author: row.author,
        publishedAt: row.publishedAt,
        category: row.category,
        symbols: row.symbols,
        sentiment: row.sentiment,
        sentimentScore: row.sentimentScore ? parseFloat(row.sentimentScore) : null,
        relevanceScore: row.relevanceScore ? parseFloat(row.relevanceScore) : null
      }));
    } catch (error) {
      console.error('Error getting stored news:', error);
      return [];
    }
  }

  // ==================== PORTFOLIO SYNC ====================

  async updatePortfolioWithLatestPrices(): Promise<void> {
    try {
      const portfolio = await db
        .select()
        .from(portfolioEntries);

      for (const entry of portfolio) {
        const latestPrice = await this.getLatestPrice(entry.symbol);

        if (latestPrice) {
          const quantity = parseFloat(entry.quantity);
          const averageCost = parseFloat(entry.averageCost);
          const currentPrice = latestPrice.price;
          const totalValue = quantity * currentPrice;
          const gainLoss = totalValue - (quantity * averageCost);
          const gainLossPercent = ((currentPrice - averageCost) / averageCost) * 100;

          await db
            .update(portfolioEntries)
            .set({
              currentPrice: currentPrice.toString(),
              totalValue: totalValue.toString(),
              gainLoss: gainLoss.toString(),
              gainLossPercent: gainLossPercent.toString(),
              updatedAt: new Date()
            })
            .where(eq(portfolioEntries.id, entry.id));
        }
      }
    } catch (error) {
      console.error('Error updating portfolio with latest prices:', error);
    }
  }

  // ==================== SENTIMENT DATA STORAGE ====================

  async storeSentimentScore(data: {
    symbol: string;
    date: Date;
    source: string;
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
    averageSentiment: number;
    confidence: number;
    timeframe?: string;
  }): Promise<void> {
    try {
      await db.insert(sentimentScores)
        .values({
          symbol: data.symbol.toUpperCase(),
          date: data.date,
          source: data.source,
          bullishCount: data.bullishCount,
          bearishCount: data.bearishCount,
          neutralCount: data.neutralCount,
          totalMentions: data.bullishCount + data.bearishCount + data.neutralCount,
          averageSentiment: data.averageSentiment.toString(),
          weightedSentiment: data.averageSentiment.toString(),
          confidenceScore: data.confidence.toString(),
          timeframe: data.timeframe || 'daily'
        })
        .onConflictDoUpdate({
          target: [sentimentScores.symbol, sentimentScores.date, sentimentScores.timeframe, sentimentScores.source],
          set: {
            bullishCount: data.bullishCount,
            bearishCount: data.bearishCount,
            neutralCount: data.neutralCount,
            totalMentions: data.bullishCount + data.bearishCount + data.neutralCount,
            averageSentiment: data.averageSentiment.toString(),
            weightedSentiment: data.averageSentiment.toString(),
            confidenceScore: data.confidence.toString(),
            updatedAt: new Date()
          }
        });
    } catch (error) {
      console.error('Error storing sentiment score:', error);
    }
  }

  // ==================== DATA VALIDATION & INTEGRITY ====================

  async validateStoredData(): Promise<{
    totalRecords: number;
    missingPrices: string[];
    oldestData: Date | null;
    newestData: Date | null;
    cacheHitRatio: number;
  }> {
    try {
      // Count total historical price records
      const totalResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(historicalPrices);

      const totalRecords = totalResult[0] ? (Number(totalResult[0].count) || 0) : 0;

      // Find symbols without recent prices (older than 2 days)
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const portfolioSymbols = await db
        .select({ symbol: portfolioEntries.symbol })
        .from(portfolioEntries);

      const missingPrices: string[] = [];
      for (const { symbol } of portfolioSymbols) {
        const recent = await db
          .select()
          .from(historicalPrices)
          .where(
            and(
              eq(historicalPrices.symbol, symbol),
              gte(historicalPrices.date, twoDaysAgo)
            )
          )
          .limit(1);

        if (recent.length === 0) {
          missingPrices.push(symbol);
        }
      }

      // Get data age range
      const ageResult = await db
        .select({
          oldest: sql<Date>`MIN(date)`,
          newest: sql<Date>`MAX(date)`
        })
        .from(historicalPrices);

      const oldestData = ageResult[0]?.oldest || null;
      const newestData = ageResult[0]?.newest || null;

      // Calculate cache hit ratio
      const cacheStats = await db
        .select({
          totalHits: sql<number>`SUM(hit_count)`,
          totalEntries: sql<number>`COUNT(*)`
        })
        .from(apiResponseCache);

      const totalHits = cacheStats[0] ? (Number(cacheStats[0].totalHits) || 0) : 0;
      const totalEntries = cacheStats[0] ? (Number(cacheStats[0].totalEntries) || 0) : 0;
      const cacheHitRatio = totalEntries > 0 ? totalHits / totalEntries : 0;

      return {
        totalRecords,
        missingPrices,
        oldestData,
        newestData,
        cacheHitRatio
      };
    } catch (error) {
      console.error('Error validating stored data:', error);
      return {
        totalRecords: 0,
        missingPrices: [],
        oldestData: null,
        newestData: null,
        cacheHitRatio: 0
      };
    }
  }

  // ==================== MAINTENANCE OPERATIONS ====================

  async performMaintenance(): Promise<{
    expiredCacheCleared: number;
    duplicatesRemoved: number;
    portfolioUpdated: boolean;
  }> {
    try {
      // Clear expired cache
      const expiredCacheCleared = await this.clearExpiredCache();

      // Remove duplicate historical prices (keep latest id for each symbol+date+timeframe)
      const duplicateResult = await db.execute(sql`
        DELETE FROM historical_prices
        WHERE id IN (
          SELECT h1.id
          FROM historical_prices h1
          JOIN historical_prices h2
            ON h1.symbol = h2.symbol
           AND h1.date   = h2.date
           AND h1.timeframe = h2.timeframe
           AND h1.id < h2.id
        )
        RETURNING id
      `);

      const duplicatesRemoved = rowsAffectedByExecute(duplicateResult);

      // Update portfolio with latest prices
      await this.updatePortfolioWithLatestPrices();

      return {
        expiredCacheCleared,
        duplicatesRemoved,
        portfolioUpdated: true
      };
    } catch (error) {
      console.error('Error performing maintenance:', error);
      return {
        expiredCacheCleared: 0,
        duplicatesRemoved: 0,
        portfolioUpdated: false
      };
    }
  }

  // ==================== UTILITY METHODS ====================

  getCacheTTL(type: keyof typeof this.DEFAULT_CACHE_TTL): number {
    return this.DEFAULT_CACHE_TTL[type];
  }

  async getStorageStats(): Promise<{
    historicalPrices: number;
    newsArticles: number;
    cachedResponses: number;
    sentimentScores: number;
  }> {
    try {
      const [pricesCount, newsCount, cacheCount, sentimentCount] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` }).from(historicalPrices),
        db.select({ count: sql<number>`COUNT(*)` }).from(newsArticles),
        db.select({ count: sql<number>`COUNT(*)` }).from(apiResponseCache),
        db.select({ count: sql<number>`COUNT(*)` }).from(sentimentScores)
      ]);

      return {
        historicalPrices: Number(pricesCount[0]?.count) || 0,
        newsArticles: Number(newsCount[0]?.count) || 0,
        cachedResponses: Number(cacheCount[0]?.count) || 0,
        sentimentScores: Number(sentimentCount[0]?.count) || 0
      };
    } catch (error) {
      console.error('Error getting storage stats:', error);
      return {
        historicalPrices: 0,
        newsArticles: 0,
        cachedResponses: 0,
        sentimentScores: 0
      };
    }
  }
}

export const dataStorageService = new DataStorageService();