// Enhanced API Service with Data Persistence
// Wraps all API services to provide caching and data storage capabilities

import { finnhubAPI } from './finnhubApi';
import { alphaVantageAPI } from './alphaVantageApi';
import { dataStorageService } from './dataStorageService';
import { getFinnhubClientForUser, getNewsCredentialsForUser } from './credentialResolver.js';
import { fetchNewsDataArticles } from './newsDataService.js';
import { tradingService } from './tradingService.js';
import { db } from '../db/connection.js';
import { historicalPrices, redditPosts } from '../db/schema.js';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';

export interface EnhancedQuoteRequest {
  symbol: string;
  source?: 'finnhub' | 'alphavantage' | 'auto';
  preferCache?: boolean;
  maxAge?: number; // Max age in minutes
}

export interface EnhancedHistoricalRequest {
  symbol: string;
  interval: 'daily' | 'weekly' | 'monthly';
  startDate?: Date;
  endDate?: Date;
  source?: 'alphavantage' | 'finnhub' | 'auto';
  preferCache?: boolean;
}

export interface EnhancedNewsRequest {
  symbols?: string[];
  category?: string;
  limit?: number;
  hours?: number;
  sources?: string[];
  preferCache?: boolean;
}

type NewsSource = 'finnhub' | 'alphavantage' | 'newsdata';

export class EnhancedApiService {

  // ==================== ENHANCED QUOTE SERVICE ====================

  async getQuote(request: EnhancedQuoteRequest): Promise<any> {
    const { symbol, source = 'auto', preferCache = true, maxAge = 1 } = request;
    const cacheKey = `quote_${symbol.toLowerCase()}`;
    const params = { symbol };

    // Check cache first if preferred
    if (preferCache) {
      const cached = await dataStorageService.getCachedResponse(
        cacheKey,
        params,
        source
      );

      if (cached) {
        console.log(`Using cached quote for ${symbol}`);
        return cached;
      }

      // Check stored historical data for latest price
      const storedPrice = await dataStorageService.getLatestPrice(symbol);
      if (storedPrice) {
        const ageInMinutes = (Date.now() - storedPrice.date.getTime()) / (1000 * 60);
        if (ageInMinutes <= maxAge) {
          console.log(`Using stored price for ${symbol} (age: ${ageInMinutes.toFixed(1)} minutes)`);
          return await this.formatQuoteResponse(storedPrice, storedPrice.source);
        }
      }
    }

    // Fetch from API
    let quote;
    let actualSource = source;

    try {
      if (source === 'finnhub' || source === 'auto') {
        try {
          console.log(`Fetching fresh quote for ${symbol} from Finnhub`);
          const finnhubQuote = await finnhubAPI.getQuote(symbol);
          quote = finnhubAPI.normalizeQuote(finnhubQuote, symbol);
          actualSource = 'finnhub';
        } catch (error) {
          if (source === 'finnhub') throw error;
          console.log(`Finnhub failed for ${symbol}, trying Alpha Vantage`);
        }
      }

      if (!quote && (source === 'alphavantage' || source === 'auto')) {
        console.log(`Fetching fresh quote for ${symbol} from Alpha Vantage`);
        quote = await alphaVantageAPI.getQuote(symbol);
        actualSource = 'alphavantage';
      }

      if (!quote) {
        throw new Error(`Failed to fetch quote for ${symbol} from all sources`);
      }

      // Store the quote as historical price
      await dataStorageService.storeHistoricalPrice({
        symbol: quote.symbol,
        date: new Date(),
        open: quote.open,
        high: quote.high,
        low: quote.low,
        close: quote.price,
        volume: quote.volume,
        source: actualSource
      });

      // Cache the response
      await dataStorageService.setCachedResponse({
        endpoint: cacheKey,
        parameters: params,
        response: quote,
        source: actualSource,
        ttl: dataStorageService.getCacheTTL('quotes')
      });

      return quote;
    } catch (error) {
      console.error(`Error fetching quote for ${symbol}:`, error);

      // Fallback to any stored data if API fails
      const fallbackPrice = await dataStorageService.getLatestPrice(symbol);
      if (fallbackPrice) {
        console.log(`Using fallback stored price for ${symbol}`);
        return await this.formatQuoteResponse(fallbackPrice, fallbackPrice.source + '_cached');
      }

      throw error;
    }
  }

  private async formatQuoteResponse(storedPrice: any, source: string): Promise<any> {
    // Look up the prior trading day's close from historicalPrices for a real previousClose
    let previousClose: number = storedPrice.open ?? storedPrice.price;

    try {
      const [priorDay] = await db
        .select({ close: historicalPrices.close })
        .from(historicalPrices)
        .where(
          and(
            eq(historicalPrices.symbol, storedPrice.symbol),
            lt(historicalPrices.date, storedPrice.date ?? new Date()),
            eq(historicalPrices.timeframe, 'daily')
          )
        )
        .orderBy(desc(historicalPrices.date))
        .limit(1);

      if (priorDay) previousClose = parseFloat(priorDay.close);
    } catch {
      // Non-fatal; fall back to open price
    }

    const price: number = storedPrice.price ?? parseFloat(storedPrice.close ?? '0');
    const change = price - previousClose;
    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

    return {
      symbol: storedPrice.symbol,
      price,
      open: storedPrice.open,
      high: storedPrice.high,
      low: storedPrice.low,
      volume: storedPrice.volume,
      previousClose,
      change,
      changePercent,
      lastUpdated: (storedPrice.date instanceof Date
        ? storedPrice.date
        : new Date(storedPrice.date)
      ).toISOString().split('T')[0],
      source,
      cached: true,
    };
  }

  // ==================== ENHANCED HISTORICAL DATA SERVICE ====================

  async getHistoricalData(request: EnhancedHistoricalRequest): Promise<any[]> {
    const {
      symbol,
      interval,
      startDate,
      endDate,
      source = 'auto',
      preferCache = true
    } = request;

    const cacheKey = `historical_${symbol.toLowerCase()}_${interval}`;
    const params = { symbol, interval, startDate: startDate?.toISOString(), endDate: endDate?.toISOString() };

    // Check stored data first
    if (preferCache) {
      const storedData = await dataStorageService.getStoredHistoricalPrices(
        symbol,
        startDate,
        endDate,
        interval
      );

      if (storedData.length > 0) {
        // Check if we have recent enough data
        const latestDate = new Date(Math.max(...storedData.map(d => d.date.getTime())));
        const daysSinceUpdate = (Date.now() - latestDate.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceUpdate <= 1) { // Data is less than 1 day old
          console.log(`Using stored historical data for ${symbol} (${storedData.length} records)`);
          return storedData.reverse(); // Return chronologically
        }
      }
    }

    // Fetch from API
    let historicalData;
    let actualSource = source;

    try {
      if (source === 'alphavantage' || source === 'auto') {
        try {
          console.log(`Fetching fresh historical data for ${symbol} from Alpha Vantage`);
          historicalData = await alphaVantageAPI.getTimeSeries(symbol, interval);
          actualSource = 'alphavantage';
        } catch (error) {
          if (source === 'alphavantage') throw error;
          console.log(`Alpha Vantage failed for ${symbol}, trying Finnhub`);
        }
      }

      if (!historicalData && (source === 'finnhub' || source === 'auto')) {
        // Finnhub doesn't have a direct equivalent, so we'll use their quote data
        // to create a single data point
        console.log(`Fetching current price from Finnhub for ${symbol}`);
        const quote = await finnhubAPI.getQuote(symbol);
        historicalData = [{
          date: new Date(quote.t * 1000).toISOString().split('T')[0],
          open: quote.o,
          high: quote.h,
          low: quote.l,
          close: quote.c,
          volume: 0 // Finnhub quote doesn't include volume
        }];
        actualSource = 'finnhub';
      }

      if (!historicalData || historicalData.length === 0) {
        throw new Error(`No historical data available for ${symbol}`);
      }

      // Store all historical data points
      for (const dataPoint of historicalData) {
        await dataStorageService.storeHistoricalPrice({
          symbol: symbol,
          date: new Date(dataPoint.date ?? new Date()),
          open: dataPoint.open,
          high: dataPoint.high,
          low: dataPoint.low,
          close: dataPoint.close,
          volume: dataPoint.volume,
          source: actualSource,
          timeframe: interval
        });
      }

      // Cache the response
      await dataStorageService.setCachedResponse({
        endpoint: cacheKey,
        parameters: params,
        response: historicalData,
        source: actualSource,
        ttl: dataStorageService.getCacheTTL('historical')
      });

      return historicalData;
    } catch (error) {
      console.error(`Error fetching historical data for ${symbol}:`, error);

      // Fallback to any stored data
      const fallbackData = await dataStorageService.getStoredHistoricalPrices(symbol, startDate, endDate, interval);
      if (fallbackData.length > 0) {
        console.log(`Using fallback stored historical data for ${symbol} (${fallbackData.length} records)`);
        return fallbackData.reverse();
      }

      throw error;
    }
  }

  // ==================== ENHANCED NEWS SERVICE ====================

  async getNews(request: EnhancedNewsRequest, userId?: string): Promise<any[]> {
    const {
      symbols = [],
      category,
      limit = 50,
      hours = 24,
      sources = ['finnhub', 'newsdata', 'alphavantage'],
      preferCache = true
    } = request;

    const cacheKey = 'news_aggregated';
    const params = { symbols, category, limit, hours };

    // Check stored news first
    if (preferCache) {
      const storedNews = await dataStorageService.getStoredNews(symbols, category, limit, hours);
      if (storedNews.length > 0) {
        console.log(`Using stored news (${storedNews.length} articles)`);
        return storedNews;
      }
    }

    const allNews: any[] = [];
    const finnhubClient = userId
      ? (await getFinnhubClientForUser(userId)) ?? finnhubAPI
      : finnhubAPI;

    // Fetch from multiple sources
    for (const source of sources as NewsSource[]) {
      try {
        const newsData: any[] = [];

        if (source === 'finnhub') {
          if (symbols.length > 0) {
            // Get company-specific news for each symbol
            for (const symbol of symbols) {
              try {
                const companyNews = await finnhubClient.getCompanyNews(symbol);
                newsData.push(...companyNews.map((article: any) => ({
                  ...article,
                  source: 'Finnhub',
                  symbols: [symbol],
                  category: category || 'company'
                })));
              } catch (error) {
                console.error(`Error fetching Finnhub news for ${symbol}:`, error);
              }
            }
          } else {
            // Get general market news
            const generalNews = await finnhubClient.getGeneralNews(category || 'general');
            newsData.push(...generalNews.map((article: any) => ({
              ...article,
              source: 'Finnhub',
              category: category || 'general'
            })));
          }
        } else if (source === 'newsdata') {
          const newsCreds = userId ? await getNewsCredentialsForUser(userId) : null;
          const apiKey = newsCreds?.apiKey;

          if (apiKey) {
            if (symbols.length > 0) {
              for (const symbol of symbols) {
                try {
                  const articles = await fetchNewsDataArticles(apiKey, {
                    symbol,
                    limit: Math.ceil(limit / symbols.length),
                    category,
                  });
                  newsData.push(...articles);
                } catch (error) {
                  console.error(`Error fetching NewsData.io news for ${symbol}:`, error);
                }
              }
            } else {
              try {
                const articles = await fetchNewsDataArticles(apiKey, { limit, category });
                newsData.push(...articles);
              } catch (error) {
                console.error('Error fetching NewsData.io news:', error);
              }
            }
          }
        }

        // Store all news articles
        for (const article of newsData) {
          await dataStorageService.storeNewsArticle({
            title: article.headline || article.title,
            summary: article.summary,
            content: article.content,
            url: article.url,
            imageUrl: article.image,
            source: article.source,
            author: article.source,
            publishedAt: new Date(article.datetime ? article.datetime * 1000 : article.publishedAt || Date.now()),
            category: article.category,
            symbols: article.symbols || []
          });
        }

        allNews.push(...newsData);
      } catch (error) {
        console.error(`Error fetching news from ${source}:`, error);
      }
    }

    // Cache the response
    if (allNews.length > 0) {
      await dataStorageService.setCachedResponse({
        endpoint: cacheKey,
        parameters: params,
        response: allNews,
        source: 'aggregated',
        ttl: dataStorageService.getCacheTTL('news')
      });
    }

    // Sort by date and limit
    const sortedNews = allNews
      .sort((a, b) => {
        const dateA = new Date(a.datetime ? a.datetime * 1000 : a.publishedAt || 0);
        const dateB = new Date(b.datetime ? b.datetime * 1000 : b.publishedAt || 0);
        return dateB.getTime() - dateA.getTime();
      })
      .slice(0, limit);

    return sortedNews;
  }

  // ==================== ENHANCED REDDIT SERVICE ====================

  async getRedditSentiment(symbols: string[], hours: number = 24): Promise<any> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Build per-symbol sentiment from posts that mention each symbol via
    // the detectedStocks JSONB column. Falls back to overall aggregate when no
    // symbol-specific posts are found (e.g. before sentiment analysis has run).
    const results: Record<string, any> = {};

    try {
      for (const symbol of symbols) {
        // Cache key is per-symbol + hours to avoid cross-symbol contamination
        const cacheKey = `reddit_sentiment_${symbol}`;
        const params = { symbol, hours };

        const cached = await dataStorageService.getCachedResponse(cacheKey, params, 'reddit');
        if (cached) {
          results[symbol] = cached;
          continue;
        }

        // Query posts that mention this specific symbol in their detectedStocks array
        const symbolPosts = await db
          .select({
            sentimentScore: redditPosts.sentimentScore,
            confidenceScore: redditPosts.confidenceScore,
          })
          .from(redditPosts)
          .where(
            and(
              gte(redditPosts.fetchedAt, since),
              sql`${redditPosts.sentimentScore} IS NOT NULL`,
              sql`${redditPosts.detectedStocks} @> ${JSON.stringify([symbol])}::jsonb`
            )
          );

        // Fallback: if no symbol-specific posts found, use all analyzed posts
        const sourcePosts = symbolPosts.length > 0
          ? symbolPosts
          : await db
              .select({
                sentimentScore: redditPosts.sentimentScore,
                confidenceScore: redditPosts.confidenceScore,
              })
              .from(redditPosts)
              .where(
                and(
                  gte(redditPosts.fetchedAt, since),
                  sql`${redditPosts.sentimentScore} IS NOT NULL`
                )
              )
              .limit(200);

        const scores = sourcePosts
          .map(p => parseFloat(p.sentimentScore as string))
          .filter(s => !isNaN(s));

        const symbolSentiment = {
          symbol,
          totalPosts: sourcePosts.length,
          symbolSpecific: symbolPosts.length > 0,
          averageSentiment: scores.length > 0
            ? scores.reduce((a, b) => a + b, 0) / scores.length
            : 0,
          bullishCount: scores.filter(s => s > 0.1).length,
          bearishCount: scores.filter(s => s < -0.1).length,
          neutralCount: scores.filter(s => s >= -0.1 && s <= 0.1).length,
          confidence: (() => {
            const cs = sourcePosts
              .map(p => parseFloat(p.confidenceScore as string))
              .filter(s => !isNaN(s));
            return cs.length > 0 ? cs.reduce((a, b) => a + b, 0) / cs.length : 0.5;
          })(),
          timestamp: new Date(),
        };

        // Persist to sentimentScores for backtest / analytics use
        await dataStorageService.storeSentimentScore({
          symbol,
          date: new Date(),
          source: 'reddit',
          bullishCount: symbolSentiment.bullishCount,
          bearishCount: symbolSentiment.bearishCount,
          neutralCount: symbolSentiment.neutralCount,
          averageSentiment: symbolSentiment.averageSentiment,
          confidence: symbolSentiment.confidence,
        });

        await dataStorageService.setCachedResponse({
          endpoint: cacheKey,
          parameters: params,
          response: symbolSentiment,
          source: 'reddit',
          ttl: dataStorageService.getCacheTTL('reddit'),
        });

        results[symbol] = symbolSentiment;
      }

      return symbols.length === 1 ? results[symbols[0]!] : results;
    } catch (error) {
      console.error('Error fetching Reddit sentiment:', error);
      throw error;
    }
  }

  // ==================== ENHANCED TRADING DATA SERVICE ====================

  async syncTradingData(userId: string): Promise<any> {
    try {
      console.log('Syncing user trading data with Alpaca...');

      await tradingService.syncAccountData(userId);
      await tradingService.syncOrders(userId, 100);
      await tradingService.syncExecutions(userId);
      const account = await tradingService.getAccountInfo(userId);
      const positions = await tradingService.getPositions(userId);
      const orders = await tradingService.getOrders(userId, { limit: 100 });

      // Cache account data
      await dataStorageService.setCachedResponse({
        userId,
        endpoint: 'alpaca_account',
        parameters: {},
        response: account,
        source: 'alpaca',
        ttl: 300 // 5 minutes
      });

      // Cache positions
      await dataStorageService.setCachedResponse({
        userId,
        endpoint: 'alpaca_positions',
        parameters: {},
        response: positions,
        source: 'alpaca',
        ttl: 60 // 1 minute
      });

      // Cache recent orders
      await dataStorageService.setCachedResponse({
        userId,
        endpoint: 'alpaca_orders',
        parameters: { status: 'all', limit: 100 },
        response: orders,
        source: 'alpaca',
        ttl: 30 // 30 seconds
      });

      return {
        account,
        positions,
        orders: orders.slice(0, 10) // Return only 10 most recent orders
      };
    } catch (error) {
      console.error('Error syncing trading data:', error);

      // Try to return cached data if API fails
      const cachedAccount = await dataStorageService.getCachedResponse('alpaca_account', {}, 'alpaca', userId);
      const cachedPositions = await dataStorageService.getCachedResponse('alpaca_positions', {}, 'alpaca', userId);
      const cachedOrders = await dataStorageService.getCachedResponse('alpaca_orders', { status: 'all', limit: 100 }, 'alpaca', userId);

      if (cachedAccount || cachedPositions || cachedOrders) {
        console.log('Using cached trading data');
        return {
          account: cachedAccount,
          positions: cachedPositions || [],
          orders: cachedOrders?.slice(0, 10) || [],
          cached: true
        };
      }

      throw error;
    }
  }

  // ==================== BULK DATA OPERATIONS ====================

  async refreshAllPortfolioData(symbols: string[]): Promise<{
    success: number;
    failed: number;
    errors: string[];
  }> {
    const results = { success: 0, failed: 0, errors: [] as string[] };

    console.log(`Starting bulk refresh for ${symbols.length} symbols...`);

    // Process symbols in batches to respect rate limits
    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);

      await Promise.all(batch.map(async (symbol) => {
        try {
          // Get quote and historical data
          await this.getQuote({ symbol, preferCache: false });
          await this.getHistoricalData({
            symbol,
            interval: 'daily',
            preferCache: false
          });

          results.success++;
          console.log(`Refreshed data for ${symbol}`);
        } catch (error) {
          results.failed++;
          const errorMsg = `${symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          results.errors.push(errorMsg);
          console.error(`Failed to refresh ${symbol}:`, error);
        }
      }));

      // Wait between batches to respect rate limits
      if (i + batchSize < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Update all portfolio entries with latest prices
    await dataStorageService.updatePortfolioWithLatestPrices();

    console.log(`Bulk refresh completed: ${results.success} success, ${results.failed} failed`);
    return results;
  }

  // ==================== STATUS AND MAINTENANCE ====================

  async getServiceStatus(): Promise<{
    dataStorage: any;
    cache: any;
    apis: any;
  }> {
    const storageStats = await dataStorageService.getStorageStats();
    const validationResults = await dataStorageService.validateStoredData();

    return {
      dataStorage: {
        ...storageStats,
        ...validationResults,
        lastUpdate: new Date()
      },
      cache: {
        hitRatio: validationResults.cacheHitRatio,
        totalEntries: storageStats.cachedResponses
      },
      apis: {
        alpaca: 'connected', // Could add actual health checks
        finnhub: 'connected',
        alphavantage: 'connected',
        reddit: 'connected'
      }
    };
  }

  async performMaintenance(): Promise<any> {
    console.log('Starting enhanced API service maintenance...');
    return await dataStorageService.performMaintenance();
  }
}

export const enhancedApiService = new EnhancedApiService();