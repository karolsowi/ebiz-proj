// Frontend service for market data - makes API calls to backend
import { apiClient } from './apiClient';
import { enhancedDataService } from './enhancedDataService';
import { apiUrl } from '../utils/apiUrl';

export interface MarketDataResponse {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: string;
}

export interface NormalizedQuote {
  symbol: string;
  price: number;
  currentPrice: number;
  change: number;
  changePercent: number;
  volume: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  lastUpdated: string;
  timestamp: number;
  source: string;
}

export interface NormalizedCompanyInfo {
  symbol: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  country: string;
  currency: string;
  marketCap: number;
  peRatio: number;
  dividendYield: number;
  beta: number;
  eps: number;
  website: string;
  logo: string;
  exchange: string;
  source: string;
}

export interface MarketOverview {
  indices: {
    sp500: MarketDataResponse;
    nasdaq: MarketDataResponse;
    dow: MarketDataResponse;
  };
  topGainers: MarketDataResponse[];
  topLosers: MarketDataResponse[];
  mostActive: MarketDataResponse[];
}

export interface MarketMoversData {
  topGainers: Array<{symbol: string, price: string, changeAmount: string, changePercentage: string, volume: string, source: string}>;
  topLosers: Array<{symbol: string, price: string, changeAmount: string, changePercentage: string, volume: string, source: string}>;
  mostActivelyTraded: Array<{symbol: string, price: string, changeAmount: string, changePercentage: string, volume: string, source: string}>;
}

type RawMover = Record<string, unknown>;

function normalizeMoverRow(row: RawMover): MarketMoversData['topGainers'][number] {
  const pct = row.changePercentage ?? row.change_percentage ?? '0';
  const pctStr = String(pct);
  return {
    symbol: String(row.symbol ?? row.ticker ?? '').trim(),
    price: String(row.price ?? '0'),
    changeAmount: String(row.changeAmount ?? row.change_amount ?? '0'),
    changePercentage: pctStr.includes('%') ? pctStr : `${pctStr}%`,
    volume: String(row.volume ?? '0'),
    source: String(row.source ?? 'API'),
  };
}

function normalizeMoversPayload(data: unknown): MarketMoversData {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const mapList = (key: string) =>
    (Array.isArray(d[key]) ? d[key] as RawMover[] : []).map(normalizeMoverRow);

  return {
    topGainers: mapList('topGainers'),
    topLosers: mapList('topLosers'),
    mostActivelyTraded: mapList('mostActivelyTraded'),
  };
}

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment: number;
  symbols: string[];
  image?: string;
}

class MarketDataService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = apiUrl('/api/market');
  }

  async getQuote(symbol: string): Promise<NormalizedQuote> {
    try {
      // Try enhanced cached service first
      const enhancedResponse = await enhancedDataService.getQuote(symbol, { preferCache: true });
      if (enhancedResponse.success) {
        const data = enhancedResponse.data;
        return {
          symbol: data.symbol,
          price: data.price,
          currentPrice: data.price,
          change: data.change,
          changePercent: data.changePercent,
          volume: data.volume || 0,
          previousClose: data.previousClose,
          open: data.open,
          high: data.high,
          low: data.low,
          lastUpdated: data.lastUpdated,
          timestamp: Date.now(),
          source: data.cached ? `${data.source} (Cached)` : data.source
        };
      }
    } catch (enhancedError) {
      console.warn('Enhanced service failed, falling back to original API:', enhancedError);
    }

    // Fallback to original implementation
    try {
      const enc = encodeURIComponent(symbol);
      const data = await apiClient.get<{
        symbol?: string;
        price?: number;
        currentPrice?: number;
        change?: number;
        changePercent?: number;
        volume?: number;
        previousClose?: number;
        open?: number;
        high?: number;
        low?: number;
        timestamp?: string;
        source?: string;
      }>(`${this.baseUrl}/quote/${enc}`);
      const price = data.price ?? data.currentPrice ?? 150;
      const change = data.change ?? 2.5;
      return {
        symbol: data.symbol || symbol,
        price,
        currentPrice: price,
        change,
        changePercent: data.changePercent ?? 1.69,
        volume: data.volume ?? 1_000_000,
        previousClose: data.previousClose ?? price - change,
        open: data.open ?? price,
        high: data.high ?? price * 1.02,
        low: data.low ?? price * 0.98,
        lastUpdated: data.timestamp || new Date().toISOString(),
        timestamp: Date.now(),
        source: data.source || 'API',
      };
    } catch (error) {
      console.error('Error fetching quote:', error);
      // Return mock data for development
      return {
        symbol,
        price: 150.00,
        currentPrice: 150.00,
        change: 2.50,
        changePercent: 1.69,
        volume: 1000000,
        previousClose: 147.50,
        open: 148.00,
        high: 153.00,
        low: 147.00,
        lastUpdated: new Date().toISOString(),
        timestamp: Date.now(),
        source: 'Mock'
      };
    }
  }

  async getCompanyInfo(symbol: string): Promise<NormalizedCompanyInfo> {
    try {
      const enc = encodeURIComponent(symbol);
      return await apiClient.get<NormalizedCompanyInfo>(`${this.baseUrl}/company/${enc}`);
    } catch (error) {
      console.error('Error fetching company info:', error);
      // Return mock data for development
      return {
        symbol,
        name: `${symbol} Inc.`,
        description: `${symbol} is a technology company that develops and manufactures consumer electronics and software.`,
        sector: 'Technology',
        industry: 'Consumer Electronics',
        country: 'USA',
        currency: 'USD',
        marketCap: Math.floor(Math.random() * 1000000000000),
        peRatio: Math.random() * 20,
        dividendYield: Math.random() * 0.05,
        beta: Math.random() * 2,
        eps: Math.random() * 5,
        website: 'https://example.com',
        logo: 'https://example.com/logo.png',
        exchange: 'NASDAQ',
        source: 'Mock'
      };
    }
  }

  async getMarketMovers(): Promise<MarketMoversData> {
    try {
      const raw = await apiClient.get<unknown>(`${this.baseUrl}/movers`);
      return normalizeMoversPayload(raw);
    } catch (error) {
      console.error('Error fetching market movers:', error);
      // Return mock data for development
      return {
        topGainers: [
          { symbol: 'AAPL', price: '175.00', changeAmount: '8.50', changePercentage: '5.10%', volume: '80000000', source: 'Mock' },
          { symbol: 'MSFT', price: '320.00', changeAmount: '12.30', changePercentage: '4.00%', volume: '60000000', source: 'Mock' },
          { symbol: 'GOOGL', price: '140.00', changeAmount: '5.20', changePercentage: '3.85%', volume: '45000000', source: 'Mock' },
          { symbol: 'NVDA', price: '450.00', changeAmount: '15.80', changePercentage: '3.64%', volume: '70000000', source: 'Mock' },
          { symbol: 'TSLA', price: '180.00', changeAmount: '6.20', changePercentage: '3.56%', volume: '90000000', source: 'Mock' }
        ],
        topLosers: [
          { symbol: 'META', price: '310.00', changeAmount: '-15.20', changePercentage: '-4.68%', volume: '55000000', source: 'Mock' },
          { symbol: 'NFLX', price: '380.00', changeAmount: '-12.50', changePercentage: '-3.18%', volume: '25000000', source: 'Mock' },
          { symbol: 'AMD', price: '90.00', changeAmount: '-2.80', changePercentage: '-3.02%', volume: '65000000', source: 'Mock' },
          { symbol: 'INTC', price: '45.00', changeAmount: '-1.25', changePercentage: '-2.70%', volume: '40000000', source: 'Mock' },
          { symbol: 'AMZN', price: '125.00', changeAmount: '-3.20', changePercentage: '-2.50%', volume: '75000000', source: 'Mock' }
        ],
        mostActivelyTraded: [
          { symbol: 'TSLA', price: '180.00', changeAmount: '6.20', changePercentage: '3.56%', volume: '90000000', source: 'Mock' },
          { symbol: 'AAPL', price: '175.00', changeAmount: '8.50', changePercentage: '5.10%', volume: '80000000', source: 'Mock' },
          { symbol: 'AMZN', price: '125.00', changeAmount: '-3.20', changePercentage: '-2.50%', volume: '75000000', source: 'Mock' },
          { symbol: 'NVDA', price: '450.00', changeAmount: '15.80', changePercentage: '3.64%', volume: '70000000', source: 'Mock' },
          { symbol: 'AMD', price: '90.00', changeAmount: '-2.80', changePercentage: '-3.02%', volume: '65000000', source: 'Mock' }
        ]
      };
    }
  }

  async getNews(symbol?: string, limit: number = 20): Promise<NewsItem[]> {
    try {
      // Try enhanced news service first
      const enhancedResponse = await enhancedDataService.getNews({
        symbols: symbol ? [symbol] : undefined,
        limit,
        preferCache: true
      });
      
      if (enhancedResponse.success) {
        return enhancedResponse.data.map((article, index) => ({
          id: index.toString(),
          headline: article.headline || article.title || 'No title',
          summary: article.summary || 'No summary available',
          url: article.url,
          source: article.source,
          publishedAt: article.publishedAt || (article.datetime ? new Date(article.datetime * 1000).toISOString() : new Date().toISOString()),
          sentiment: 0.5, // Default neutral sentiment
          symbols: article.symbols || (symbol ? [symbol] : []),
          image: article.image || article.imageUrl
        }));
      }
    } catch (enhancedError) {
      console.warn('Enhanced news service failed, falling back to original API:', enhancedError);
    }

    // Fallback to original implementation
    try {
      const url = symbol 
        ? `${this.baseUrl}/news/${encodeURIComponent(symbol)}?limit=${limit}`
        : `${this.baseUrl}/news?limit=${limit}`;
      return await apiClient.get<NewsItem[]>(url);
    } catch (error) {
      console.error('Error fetching news:', error);
      // Return mock data for development
      return [
        {
          id: '1',
          headline: 'Market reaches new highs amid strong earnings',
          summary: 'The stock market continued its upward trajectory as companies report better-than-expected earnings.',
          url: 'https://example.com/news/1',
          source: 'Financial Times',
          publishedAt: new Date().toISOString(),
          sentiment: 0.7,
          symbols: symbol ? [symbol] : ['AAPL', 'MSFT', 'GOOGL']
        },
        {
          id: '2',
          headline: 'Tech stocks show mixed performance',
          summary: 'Technology stocks showed varied performance as investors weigh growth prospects.',
          url: 'https://example.com/news/2',
          source: 'Reuters',
          publishedAt: new Date(Date.now() - 3600000).toISOString(),
          sentiment: 0.1,
          symbols: symbol ? [symbol] : ['TSLA', 'NVDA', 'AMD']
        }
      ];
    }
  }

  async getUsageStats(): Promise<import('../types/api').UsageStats> {
    try {
      return await apiClient.get(`${this.baseUrl}/usage`);
    } catch (error) {
      console.error('Error fetching usage stats:', error);
      // Return mock data for development
      return {
        alphaVantageCallsToday: 45,
        alphaVantageLastCall: Date.now(),
        finnhubCallsToday: 12,
        finnhubLastCall: Date.now(),
        lastResetDate: new Date().toISOString().split('T')[0]
      };
    }
  }

  async getMarketStatus(): Promise<{isOpen: boolean, session: string}> {
    try {
      return await apiClient.get<{isOpen: boolean, session: string}>(`${this.baseUrl}/status`);
    } catch (error) {
      console.error('Error fetching market status:', error);
      // Return mock data for development
      const now = new Date();
      const currentHour = now.getHours();
      const isWeekend = now.getDay() === 0 || now.getDay() === 6;
      const isMarketHours = currentHour >= 9 && currentHour < 16;
      
      return {
        isOpen: !isWeekend && isMarketHours,
        session: isMarketHours ? 'regular' : 'closed'
      };
    }
  }

  async getMultipleQuotes(symbols: string[]): Promise<MarketDataResponse[]> {
    try {
      // Try enhanced bulk quotes service first
      const enhancedResponse = await enhancedDataService.getBulkQuotes(symbols, { preferCache: true });
      if (enhancedResponse.success) {
        return enhancedResponse.results
          .filter((result): result is typeof result & { success: true; data: NonNullable<typeof result.data> } =>
            result.success && result.data != null
          )
          .map((result) => ({
            symbol: result.data.symbol,
            price: result.data.price,
            change: result.data.change,
            changePercent: result.data.changePercent,
            volume: result.data.volume || 0,
            timestamp: result.data.lastUpdated,
          }));
      }
    } catch (enhancedError) {
      console.warn('Enhanced bulk quotes failed, falling back to original API:', enhancedError);
    }

    // Fallback to original implementation
    try {
      return await apiClient.post<MarketDataResponse[]>(`${this.baseUrl}/quotes`, { symbols });
    } catch (error) {
      console.error('Error fetching multiple quotes:', error);
      // Return mock data for development
      return symbols.map(symbol => ({
        symbol,
        price: Math.random() * 200 + 50,
        change: (Math.random() - 0.5) * 10,
        changePercent: (Math.random() - 0.5) * 5,
        volume: Math.floor(Math.random() * 10000000),
        timestamp: new Date().toISOString()
      }));
    }
  }

  async getMarketOverview(): Promise<MarketOverview> {
    try {
      return await apiClient.get<MarketOverview>(`${this.baseUrl}/overview`);
    } catch (error) {
      console.error('Error fetching market overview:', error);
      // Return mock data for development
      return {
        indices: {
          sp500: { symbol: 'SPY', price: 450.00, change: 5.25, changePercent: 1.18, volume: 50000000, timestamp: new Date().toISOString() },
          nasdaq: { symbol: 'QQQ', price: 380.00, change: -2.10, changePercent: -0.55, volume: 30000000, timestamp: new Date().toISOString() },
          dow: { symbol: 'DIA', price: 340.00, change: 1.80, changePercent: 0.53, volume: 20000000, timestamp: new Date().toISOString() }
        },
        topGainers: [
          { symbol: 'AAPL', price: 175.00, change: 8.50, changePercent: 5.10, volume: 80000000, timestamp: new Date().toISOString() },
          { symbol: 'MSFT', price: 320.00, change: 12.30, changePercent: 4.00, volume: 60000000, timestamp: new Date().toISOString() }
        ],
        topLosers: [
          { symbol: 'TSLA', price: 180.00, change: -15.20, changePercent: -7.80, volume: 90000000, timestamp: new Date().toISOString() },
          { symbol: 'NVDA', price: 450.00, change: -20.50, changePercent: -4.35, volume: 70000000, timestamp: new Date().toISOString() }
        ],
        mostActive: [
          { symbol: 'SPY', price: 450.00, change: 5.25, changePercent: 1.18, volume: 50000000, timestamp: new Date().toISOString() },
          { symbol: 'TSLA', price: 180.00, change: -15.20, changePercent: -7.80, volume: 90000000, timestamp: new Date().toISOString() }
        ]
      };
    }
  }

  async searchStocks(query: string): Promise<MarketDataResponse[]> {
    try {
      return await apiClient.get<MarketDataResponse[]>(
        `${this.baseUrl}/search?q=${encodeURIComponent(query)}`
      );
    } catch (error) {
      console.error('Error searching stocks:', error);
      // Return mock data for development
      return [
        { symbol: 'AAPL', price: 175.00, change: 2.50, changePercent: 1.45, volume: 80000000, timestamp: new Date().toISOString() },
        { symbol: 'MSFT', price: 320.00, change: -1.20, changePercent: -0.37, volume: 60000000, timestamp: new Date().toISOString() }
      ];
    }
  }

  async getHistoricalData(symbol: string, period: string = '1M'): Promise<Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>> {
    try {
      const enc = encodeURIComponent(symbol);
      return await apiClient.get<Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>>(`${this.baseUrl}/historical/${enc}?period=${period}`);
    } catch (error) {
      console.error('Error fetching historical data:', error);
      // Return mock data for development
      const mockData = [];
      const now = new Date();
      for (let i = 30; i >= 0; i--) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        mockData.push({
          date: date.toISOString().split('T')[0],
          open: 150 + Math.random() * 20,
          high: 155 + Math.random() * 25,
          low: 145 + Math.random() * 15,
          close: 150 + Math.random() * 20,
          volume: Math.floor(Math.random() * 10000000)
        });
      }
      return mockData;
    }
  }

  async getRedditSentimentHistory(symbol: string, days: number = 30): Promise<Array<{date: string, bullish: number, bearish: number, neutral: number}>> {
    try {
      const enc = encodeURIComponent(symbol);
      const result = await apiClient.get<{
        success?: boolean;
        data?: { history: Array<{ date: string; bullish: number; bearish: number; neutral: number }> };
      }>(`/api/reddit/sentiment/history?symbol=${enc}&days=${days}`);
      return result.success ? (result.data?.history ?? []) : [];
    } catch (error) {
      console.error('Error fetching Reddit sentiment history:', error);
      return [];
    }
  }
}

export const marketDataService = new MarketDataService();