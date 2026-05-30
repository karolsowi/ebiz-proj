import { AlphaVantageAPI } from './alphaVantageApi';
import { FinnhubAPI, NormalizedQuote, NormalizedCompanyInfo, FinnhubNews } from './finnhubApi';
import { getAlphaVantageClientForUser, getFinnhubClientForUser } from './credentialResolver.js';
import { getApiKeysOwnerUserId } from '../constants/integration.js';
import { priceService as dbMarketService, sentimentService } from './databaseService';

interface APIUsageStats {
  alphaVantageCallsToday: number;
  alphaVantageLastCall: number;
  finnhubCallsToday: number;
  finnhubLastCall: number;
  lastResetDate: string;
}

class MarketDataService {
  private usageStats!: APIUsageStats;
  private readonly ALPHA_VANTAGE_DAILY_LIMIT = 25;
  private readonly ALPHA_VANTAGE_MINUTE_LIMIT = 5;
  private readonly FINNHUB_DAILY_LIMIT = 60; // Free tier limit
  private readonly MIN_CALL_INTERVAL = 12000; // 12 seconds between calls

  constructor() {
    this.loadUsageStats();
  }

  private loadUsageStats() {
    // In Node.js, we'll use in-memory storage instead of localStorage
    const today = new Date().toDateString();

    if (!this.usageStats) {
      this.usageStats = {
        alphaVantageCallsToday: 0,
        alphaVantageLastCall: 0,
        finnhubCallsToday: 0,
        finnhubLastCall: 0,
        lastResetDate: today
      };
    }

    // Reset daily counters if it's a new day
    if (this.usageStats.lastResetDate !== today) {
      this.usageStats.alphaVantageCallsToday = 0;
      this.usageStats.finnhubCallsToday = 0;
      this.usageStats.lastResetDate = today;
    }
  }

  private saveUsageStats() {
    // In Node.js, we don't need to persist this data
    // It will reset when the server restarts, which is acceptable for rate limiting
  }

  private canUseAlphaVantage(): boolean {
    const now = Date.now();
    const timeSinceLastCall = now - this.usageStats.alphaVantageLastCall;

    return (
      this.usageStats.alphaVantageCallsToday < this.ALPHA_VANTAGE_DAILY_LIMIT &&
      timeSinceLastCall >= this.MIN_CALL_INTERVAL
    );
  }

  private canUseFinnhub(): boolean {
    const now = Date.now();
    const timeSinceLastCall = now - this.usageStats.finnhubLastCall;

    return (
      this.usageStats.finnhubCallsToday < this.FINNHUB_DAILY_LIMIT &&
      timeSinceLastCall >= 1000 // 1 second between Finnhub calls
    );
  }

  private recordAlphaVantageCall() {
    this.usageStats.alphaVantageCallsToday++;
    this.usageStats.alphaVantageLastCall = Date.now();
    this.saveUsageStats();
  }

  private recordFinnhubCall() {
    this.usageStats.finnhubCallsToday++;
    this.usageStats.finnhubLastCall = Date.now();
    this.saveUsageStats();
  }

  private async resolveMarketClients(userId?: string): Promise<{
    alphaVantage: AlphaVantageAPI | null;
    finnhub: FinnhubAPI | null;
  }> {
    const resolvedUserId = userId ?? getApiKeysOwnerUserId();
    const [alphaVantage, finnhub] = await Promise.all([
      getAlphaVantageClientForUser(resolvedUserId),
      getFinnhubClientForUser(resolvedUserId),
    ]);
    return { alphaVantage, finnhub };
  }

  async getQuote(symbol: string, useCache: boolean = true, userId?: string): Promise<NormalizedQuote> {
    // Check database cache first if enabled (skip in browser environment)
    if (useCache && typeof window === 'undefined') {
      try {
        const cachedData = await dbMarketService.getPriceHistory(symbol, undefined, undefined, 'daily');
        if (cachedData.length > 0) {
          const latest = cachedData[0];
          if (latest) {
            const ageMinutes = (Date.now() - latest.date.getTime()) / (1000 * 60);

            // Use cached data if less than 15 minutes old
            if (ageMinutes < 15) {
              return {
                symbol: latest.symbol,
                price: parseFloat(latest.close),
                change: 0, // Calculate if needed
                changePercent: 0, // Calculate if needed
                volume: Number(latest.volume || 0),
                previousClose: parseFloat(latest.open),
                open: parseFloat(latest.open),
                high: parseFloat(latest.high),
                low: parseFloat(latest.low),
                lastUpdated: latest.date ? latest.date.toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10),
                source: 'database'
              };
            }
          }
        }
      } catch (error) {
        console.warn('Database cache check failed:', error);
      }
    }

    let quote: NormalizedQuote | null = null;
    const { alphaVantage: alphaClient, finnhub: finnhubClient } =
      await this.resolveMarketClients(userId);

    // Try Alpha Vantage first (more comprehensive data)
    if (alphaClient && this.canUseAlphaVantage()) {
      try {
        this.recordAlphaVantageCall();
        const avQuote = await alphaClient.getQuote(symbol);
        quote = {
          symbol: avQuote.symbol,
          price: avQuote.price,
          change: avQuote.change,
          changePercent: avQuote.changePercent,
          volume: avQuote.volume,
          previousClose: avQuote.previousClose,
          open: avQuote.open,
          high: avQuote.high,
          low: avQuote.low,
          lastUpdated: avQuote.lastUpdated,
          source: 'alphavantage'
        };

        // Save to database (skip in browser environment)
        if (typeof window === 'undefined') {
          await this.saveQuoteToDatabase(quote);
        }
        return quote;
      } catch (error) {
        console.warn(`Alpha Vantage failed for ${symbol}, trying Finnhub:`, error);
      }
    }

    // Fallback to Finnhub
    if (finnhubClient && this.canUseFinnhub()) {
      try {
        this.recordFinnhubCall();
        const fhQuote = await finnhubClient.getQuote(symbol);
        quote = finnhubClient.normalizeQuote(fhQuote, symbol);

        // Save to database (skip in browser environment)
        if (typeof window === 'undefined') {
          await this.saveQuoteToDatabase(quote);
        }
        return quote;
      } catch (error) {
        console.error(`Both APIs failed for ${symbol}:`, error);
        throw new Error(`Unable to fetch quote for ${symbol}: Both APIs unavailable`);
      }
    }

    throw new Error(`API limits exceeded. Alpha Vantage: ${this.usageStats.alphaVantageCallsToday}/${this.ALPHA_VANTAGE_DAILY_LIMIT}, Finnhub: ${this.usageStats.finnhubCallsToday}/${this.FINNHUB_DAILY_LIMIT}`);
  }

  async getCompanyInfo(symbol: string, userId?: string): Promise<NormalizedCompanyInfo> {
    const { alphaVantage: alphaClient, finnhub: finnhubClient } =
      await this.resolveMarketClients(userId);

    // Try Alpha Vantage first for comprehensive company data
    if (alphaClient && this.canUseAlphaVantage()) {
      try {
        this.recordAlphaVantageCall();
        const overview = await alphaClient.getCompanyOverview(symbol);
        return {
          symbol: overview.symbol,
          name: overview.name,
          description: overview.description,
          sector: overview.sector,
          industry: overview.industry,
          marketCap: overview.marketCap,
          source: 'alphavantage'
        };
      } catch (error) {
        console.warn(`Alpha Vantage company info failed for ${symbol}, trying Finnhub:`, error);
      }
    }

    // Fallback to Finnhub
    if (finnhubClient && this.canUseFinnhub()) {
      try {
        this.recordFinnhubCall();
        const profile = await finnhubClient.getCompanyProfile(symbol);
        return finnhubClient.normalizeCompanyInfo(profile);
      } catch (error) {
        console.error(`Both APIs failed for company info ${symbol}:`, error);
        throw new Error(`Unable to fetch company info for ${symbol}: Both APIs unavailable`);
      }
    }

    throw new Error(`API limits exceeded for company info`);
  }

  async getMarketOverview(userId?: string): Promise<NormalizedQuote[]> {
    const indices = [
      { symbol: 'SPY', name: 'S&P 500' },
      { symbol: 'QQQ', name: 'Nasdaq 100' },
      { symbol: 'DIA', name: 'Dow Jones' },
      { symbol: 'IWM', name: 'Russell 2000' }
    ];

    const quotes: NormalizedQuote[] = [];

    for (const index of indices) {
      try {
        const quote = await this.getQuote(index.symbol, true, userId);
        quotes.push(quote);
        if (typeof window === 'undefined') {
          await new Promise(resolve => setTimeout(resolve, 1200));
        }
      } catch (error) {
        console.warn(`Failed to get market overview data for ${index.symbol}:`, error);
      }
    }

    return quotes;
  }

  async getMarketMovers(userId?: string): Promise<{
    topGainers: Array<{ symbol: string, price: string, changeAmount: string, changePercentage: string, volume: string, source: string }>,
    topLosers: Array<{ symbol: string, price: string, changeAmount: string, changePercentage: string, volume: string, source: string }>,
    mostActivelyTraded: Array<{ symbol: string, price: string, changeAmount: string, changePercentage: string, volume: string, source: string }>
  }> {
    const { alphaVantage: alphaClient, finnhub: finnhubClient } =
      await this.resolveMarketClients(userId);

    // Try Alpha Vantage first for market movers
    if (alphaClient && this.canUseAlphaVantage()) {
      try {
        this.recordAlphaVantageCall();
        const data = await alphaClient.getTopGainersLosers();
        return {
          topGainers: data.topGainers.map(item => ({ ...item, source: 'Alpha Vantage' })),
          topLosers: data.topLosers.map(item => ({ ...item, source: 'Alpha Vantage' })),
          mostActivelyTraded: data.mostActivelyTraded.map(item => ({ ...item, source: 'Alpha Vantage' }))
        };
      } catch (error) {
        console.warn('Alpha Vantage market movers failed, using fallback data:', error);
      }
    }

    // Fallback: Use Finnhub to get quotes for popular stocks and calculate movers
    if (finnhubClient && this.canUseFinnhub()) {
      try {
        const popularStocks = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'NVDA', 'META', 'NFLX', 'AMD', 'INTC'];
        const quotes: Array<{ symbol: string, quote: any }> = [];

        for (const symbol of popularStocks) {
          if (this.canUseFinnhub()) {
            try {
              this.recordFinnhubCall();
              const quote = await finnhubClient.getQuote(symbol);
              quotes.push({ symbol, quote });
              // Small delay between calls
              await new Promise(resolve => setTimeout(resolve, 1100));
            } catch (error) {
              console.warn(`Failed to get quote for ${symbol}:`, error);
            }
          }
        }

        // Sort by performance
        const sortedByGain = quotes
          .filter(item => item.quote.dp > 0)
          .sort((a, b) => b.quote.dp - a.quote.dp)
          .slice(0, 5);

        const sortedByLoss = quotes
          .filter(item => item.quote.dp < 0)
          .sort((a, b) => a.quote.dp - b.quote.dp)
          .slice(0, 5);

        const sortedByVolume = quotes
          .sort((a, b) => (b.quote.h - b.quote.l) - (a.quote.h - a.quote.l))
          .slice(0, 5);

        const formatQuote = (item: any) => ({
          symbol: item.symbol,
          price: item.quote.c.toFixed(2),
          changeAmount: item.quote.d.toFixed(2),
          changePercentage: `${item.quote.dp.toFixed(2)}%`,
          volume: Math.round(item.quote.h * 1000000).toString(), // Estimated volume
          source: 'Finnhub'
        });

        return {
          topGainers: sortedByGain.map(formatQuote),
          topLosers: sortedByLoss.map(formatQuote),
          mostActivelyTraded: sortedByVolume.map(formatQuote)
        };
      } catch (error) {
        console.error('Finnhub market movers fallback failed:', error);
      }
    }

    // Ultimate fallback: return empty arrays with message
    return {
      topGainers: [],
      topLosers: [],
      mostActivelyTraded: []
    };
  }

  async getNews(symbol?: string, userId?: string): Promise<FinnhubNews[]> {
    const { finnhub: finnhubClient } = await this.resolveMarketClients(userId);

    // Finnhub is better for news, so use it first
    if (finnhubClient && this.canUseFinnhub()) {
      try {
        this.recordFinnhubCall();
        let news: FinnhubNews[];

        if (symbol) {
          news = await finnhubClient.getCompanyNews(symbol);
        } else {
          news = await finnhubClient.getGeneralNews('general');
        }

        // Save news to database (skip in browser environment)
        if (typeof window === 'undefined') {
          await this.saveNewsToDatabase(news, symbol);
        }

        return news;
      } catch (error) {
        console.error('Finnhub news failed:', error);
      }
    }

    // Fallback: return sample news data
    return [];
  }

  async getMarketStatus(userId?: string): Promise<{ isOpen: boolean, session: string }> {
    const { finnhub: finnhubClient } = await this.resolveMarketClients(userId);

    if (finnhubClient && this.canUseFinnhub()) {
      try {
        this.recordFinnhubCall();
        return await finnhubClient.getMarketStatus();
      } catch (error) {
        console.error('Market status check failed:', error);
      }
    }

    // Fallback: basic market hours check
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    // Basic US market hours check (9:30 AM - 4:00 PM ET, Mon-Fri)
    const isWeekday = day >= 1 && day <= 5;
    const isMarketHours = hour >= 9 && hour < 16;

    return {
      isOpen: isWeekday && isMarketHours,
      session: isWeekday && isMarketHours ? 'market' : 'closed'
    };
  }

  getUsageStats(): APIUsageStats {
    return { ...this.usageStats };
  }

  resetDailyLimits() {
    this.usageStats.alphaVantageCallsToday = 0;
    this.usageStats.finnhubCallsToday = 0;
    this.usageStats.lastResetDate = new Date().toDateString();
    this.saveUsageStats();
  }

  // Save quote data to database
  private async saveQuoteToDatabase(quote: NormalizedQuote): Promise<void> {
    try {
      await dbMarketService.storePriceData({
        symbol: quote.symbol,
        date: new Date(),
        open: quote.open.toString(),
        high: quote.high.toString(),
        low: quote.low.toString(),
        close: quote.price.toString(),
        volume: quote.volume || 0,
        source: quote.source === 'database' ? 'Cache' : quote.source
      });
    } catch (error) {
      console.error('Error saving quote to database:', error);
      // Don't throw here - we still want to return the data even if save fails
    }
  }

  // Save news data to database
  private async saveNewsToDatabase(news: FinnhubNews[], symbol?: string): Promise<void> {
    try {
      for (const article of news) {
        await sentimentService.storeSentimentScore({
          symbol: symbol || 'GENERAL',
          date: new Date(article.datetime * 1000),
          source: article.source || 'Finnhub',
          bullishCount: 0,
          bearishCount: 0,
          neutralCount: 1,
          totalMentions: 1,
          averageSentiment: '0',
          weightedSentiment: '0',
          confidenceScore: '0.5'
        });
      }
    } catch (error) {
      console.error('Error saving news to database:', error);
    }
  }

  // Extract keywords from text
  private extractKeywordsFromText(text: string): string[] {
    const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !commonWords.includes(word));

    return [...new Set(words)].slice(0, 5);
  }
}

export const marketDataService = new MarketDataService();