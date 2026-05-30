// Enhanced Data Service for Frontend
// Uses the new cached API endpoints for improved performance and reliability

import { apiClient } from './apiClient';
import { apiUrl } from '../utils/apiUrl';

/** Generic JSON object returned by some data/scheduler endpoints */
type JsonObject = Record<string, unknown>;

interface EnhancedQuoteResponse {
  success: boolean;
  data: {
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
    lastUpdated: string;
    source: string;
    cached?: boolean;
  };
  cached?: boolean;
  timestamp: string;
}

interface BulkQuoteResponse {
  success: boolean;
  total: number;
  successful: number;
  failed: number;
  results: Array<{
    symbol: string;
    success: boolean;
    data: EnhancedQuoteResponse['data'] | null;
    error: string | null;
  }>;
  timestamp: string;
}

interface NewsResponse {
  success: boolean;
  total: number;
  filters: {
    symbols?: string[];
    category?: string;
    hours: number;
    sources: string[];
  };
  data: Array<{
    title?: string;
    headline?: string;
    summary?: string;
    url: string;
    imageUrl?: string;
    image?: string;
    source: string;
    publishedAt?: string;
    datetime?: number;
    category?: string;
    symbols?: string[];
  }>;
  timestamp: string;
}

interface NewsDailyTrendsResponse {
  success: boolean;
  data: Array<{
    dateLabel: string;
    dateISO: string;
    bullish: number;
    bearish: number;
    neutral: number;
    avgSentiment: number;
    analyzedCount: number;
  }>;
}

interface SystemStatus {
  success: boolean;
  status: {
    dataStorage: {
      historicalPrices: number;
      newsArticles: number;
      cachedResponses: number;
      sentimentScores: number;
      totalRecords: number;
      missingPrices: string[];
      cacheHitRatio: number;
    };
    cache: {
      hitRatio: number;
      totalEntries: number;
    };
    apis: {
      alpaca: string;
      finnhub: string;
      alphavantage: string;
      reddit: string;
    };
  };
  timestamp: string;
}

class EnhancedDataService {
  private url(path: string): string {
    return apiUrl(path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`);
  }

  // ==================== STOCK QUOTES ====================

  async getQuote(
    symbol: string, 
    options: {
      source?: 'auto' | 'finnhub' | 'alphavantage';
      maxAge?: number;
      preferCache?: boolean;
    } = {}
  ): Promise<EnhancedQuoteResponse> {
    const { source = 'auto', maxAge = 1, preferCache = true } = options;
    
    const params = new URLSearchParams({
      source,
      maxAge: maxAge.toString(),
      preferCache: preferCache.toString()
    });

    const enc = encodeURIComponent(symbol);
    return apiClient.get<EnhancedQuoteResponse>(this.url(`/api/data/quote/${enc}?${params}`));
  }

  async getBulkQuotes(
    symbols: string[], 
    options: {
      source?: 'auto' | 'finnhub' | 'alphavantage';
      preferCache?: boolean;
    } = {}
  ): Promise<BulkQuoteResponse> {
    const { source = 'auto', preferCache = true } = options;

    return apiClient.post<BulkQuoteResponse>(this.url('/api/data/quotes'), {
      symbols,
      source,
      preferCache
    });
  }

  // ==================== HISTORICAL DATA ====================

  async getHistoricalData(
    symbol: string,
    options: {
      interval?: 'daily' | 'weekly' | 'monthly';
      startDate?: string;
      endDate?: string;
      source?: 'auto' | 'alphavantage' | 'finnhub';
      preferCache?: boolean;
    } = {}
  ): Promise<JsonObject> {
    const { 
      interval = 'daily', 
      startDate, 
      endDate, 
      source = 'auto', 
      preferCache = true 
    } = options;

    const params = new URLSearchParams({
      interval,
      source,
      preferCache: preferCache.toString()
    });

    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    const enc = encodeURIComponent(symbol);
    return apiClient.get<JsonObject>(this.url(`/api/data/historical/${enc}?${params}`));
  }

  // ==================== NEWS ====================

  async getNews(options: {
    symbols?: string[];
    category?: string;
    limit?: number;
    hours?: number;
    sources?: string[];
    preferCache?: boolean;
  } = {}): Promise<NewsResponse> {
    const { 
      symbols = [], 
      category, 
      limit = 25, 
      hours = 24, 
      sources = ['finnhub', 'newsdata', 'alphavantage'], 
      preferCache = true 
    } = options;

    const params = new URLSearchParams({
      limit: limit.toString(),
      hours: hours.toString(),
      sources: sources.join(','),
      preferCache: preferCache.toString()
    });

    if (symbols.length > 0) {
      params.append('symbols', symbols.join(','));
    }
    if (category) {
      params.append('category', category);
    }

    return apiClient.get<NewsResponse>(this.url(`/api/data/news?${params}`));
  }

  /** Live headlines from configured news providers (Finnhub, NewsData, etc.). */
  async getNewsArticles(options: {
    category?: string;
    limit?: number;
    hours?: number;
    preferCache?: boolean;
  } = {}): Promise<{ success: boolean; total: number; data: NewsResponse['data'] }> {
    const { category, limit = 25, hours = 24, preferCache = true } = options;
    const params = new URLSearchParams({
      limit: String(limit),
      hours: String(hours),
      preferCache: String(preferCache),
    });
    if (category && category !== 'general') {
      params.append('category', category);
    }
    return apiClient.get(this.url(`/api/news/articles?${params}`));
  }

  /** Aggregate sentiment analytics for stored analyzed articles. */
  async getNewsSentimentAnalytics(hours = 24): Promise<{
    success: boolean;
    data: {
      totalAnalyzed: number;
      averageSentiment: number;
      stockSentiments: Array<{
        symbol: string;
        sentiment: number;
        mentions: number;
        articles: number;
      }>;
    };
  }> {
    return apiClient.get(this.url(`/api/news/sentiment/analytics?hours=${hours}`));
  }

  async analyzeNewsSentiment(batchSize = 50): Promise<{ success: boolean; data: { processed: number } }> {
    return apiClient.post(this.url('/api/news/sentiment/analyze'), { batchSize });
  }

  /** Stored news DB aggregates (requires auth): daily bullish / neutral / bearish counts and mean score by UTC date. */
  async getNewsDailySentimentTrends(options?: {
    days?: number;
    category?: string;
  }): Promise<NewsDailyTrendsResponse> {
    const { days = 7, category } = options ?? {};
    const params = new URLSearchParams({ days: String(days) });
    if (category && category.trim() !== '' && category !== 'general') {
      params.append('category', category.trim());
    }

    return apiClient.get<NewsDailyTrendsResponse>(
      this.url(`/api/news/sentiment/trends/daily?${params}`)
    );
  }

  // ==================== SENTIMENT ====================

  async getRedditSentiment(
    symbols: string[] = ['SPY', 'QQQ'], 
    hours: number = 24
  ): Promise<JsonObject> {
    const params = new URLSearchParams({
      symbols: symbols.join(','),
      hours: hours.toString()
    });

    return apiClient.get<JsonObject>(this.url(`/api/data/sentiment/reddit?${params}`));
  }

  // ==================== TRADING DATA ====================

  async syncTradingData(): Promise<JsonObject> {
    return apiClient.get(this.url('/api/data/trading/sync'));
  }

  // ==================== PORTFOLIO MANAGEMENT ====================

  async refreshPortfolio(symbols: string[]): Promise<JsonObject> {
    return apiClient.post(this.url('/api/data/portfolio/refresh'), { symbols });
  }

  // ==================== SYSTEM MONITORING ====================

  async getSystemStatus(): Promise<SystemStatus> {
    return apiClient.get<SystemStatus>(this.url('/api/data/status'));
  }

  async getSchedulerStatus(): Promise<JsonObject> {
    return apiClient.get(this.url('/api/data/scheduler/status'));
  }

  async getUsageAnalytics(hours: number = 24): Promise<JsonObject> {
    return apiClient.get(this.url(`/api/data/analytics/usage?hours=${hours}`));
  }

  async validateData(): Promise<JsonObject> {
    return apiClient.get(this.url('/api/data/validate'));
  }

  // ==================== MANUAL TRIGGERS ====================

  async triggerMarketUpdate(): Promise<JsonObject> {
    return apiClient.post(this.url('/api/data/scheduler/trigger/market'));
  }

  /** Fetch new headlines using the logged-in user's NewsData.io / Finnhub keys */
  async refreshNewsArticles(params?: {
    limit?: number;
    hours?: number;
    category?: string;
    symbols?: string[];
  }): Promise<{ success: boolean; total: number; data: unknown[] }> {
    return apiClient.post(this.url('/api/news/refresh'), params ?? {});
  }

  async triggerSentimentUpdate(): Promise<JsonObject> {
    return apiClient.post(this.url('/api/data/scheduler/trigger/sentiment'));
  }

  async triggerFullRefresh(): Promise<JsonObject> {
    return apiClient.post(this.url('/api/data/scheduler/trigger/full'));
  }

  async performMaintenance(): Promise<JsonObject> {
    return apiClient.post(this.url('/api/data/maintenance'));
  }

  // ==================== UTILITY METHODS ====================

  // Check if data is fresh enough (within specified minutes)
  isDataFresh(lastUpdated: string, maxAgeMinutes: number = 5): boolean {
    const lastUpdate = new Date(lastUpdated);
    const now = new Date();
    const ageMinutes = (now.getTime() - lastUpdate.getTime()) / (1000 * 60);
    return ageMinutes <= maxAgeMinutes;
  }

  // Format price with appropriate decimal places
  formatPrice(price: number): string {
    return price.toFixed(2);
  }

  // Format percentage change
  formatPercentage(percent: number): string {
    const sign = percent >= 0 ? '+' : '';
    return `${sign}${percent.toFixed(2)}%`;
  }

  // Get cache status indicator
  getCacheStatus(cached: boolean, lastUpdated: string): {
    icon: string;
    color: string;
    text: string;
  } {
    if (cached) {
      const fresh = this.isDataFresh(lastUpdated, 1);
      return {
        icon: '⚡',
        color: fresh ? 'green' : 'orange', 
        text: fresh ? 'Cached (Fresh)' : 'Cached'
      };
    }
    return {
      icon: '🔄',
      color: 'blue',
      text: 'Live API'
    };
  }
}

// Create singleton instance
export const enhancedDataService = new EnhancedDataService();
export default enhancedDataService;