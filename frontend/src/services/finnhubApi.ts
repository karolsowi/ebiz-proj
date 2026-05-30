// Frontend service for Finnhub API - makes API calls to backend
import { apiClient } from './apiClient';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface NormalizedQuote {
  symbol: string;
  currentPrice: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  volume: number;
  timestamp: number;
}

export interface NormalizedCompanyInfo {
  symbol: string;
  name: string;
  description: string;
  industry: string;
  sector: string;
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

class FinnhubApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${API_BASE_URL}/api/finnhub`;
  }

  async getQuote(symbol: string): Promise<NormalizedQuote> {
    try {
      return await apiClient.get<NormalizedQuote>(`${this.baseUrl}/quote/${symbol}`);
    } catch (error) {
      console.error('Error fetching Finnhub quote:', error);
      // Return mock data for development
      return {
        symbol,
        currentPrice: 150.00 + Math.random() * 50,
        change: (Math.random() - 0.5) * 10,
        changePercent: (Math.random() - 0.5) * 5,
        high: 155.00 + Math.random() * 20,
        low: 145.00 + Math.random() * 10,
        open: 148.00 + Math.random() * 15,
        previousClose: 147.50 + Math.random() * 10,
        volume: Math.floor(Math.random() * 10000000),
        timestamp: Date.now()
      };
    }
  }

  async getCompanyInfo(symbol: string): Promise<NormalizedCompanyInfo> {
    try {
      return await apiClient.get<NormalizedCompanyInfo>(`${this.baseUrl}/company/${symbol}`);
    } catch (error) {
      console.error('Error fetching company info:', error);
      // Return mock data for development
      return {
        symbol,
        name: `${symbol} Inc.`,
        description: `${symbol} is a technology company that develops and manufactures consumer electronics and software.`,
        industry: 'Technology',
        sector: 'Technology',
        country: 'US',
        currency: 'USD',
        marketCap: Math.floor(Math.random() * 1000000000000),
        peRatio: 15 + Math.random() * 20,
        dividendYield: Math.random() * 5,
        beta: 0.8 + Math.random() * 0.8,
        eps: 5 + Math.random() * 10,
        website: `https://www.${symbol.toLowerCase()}.com`,
        logo: `https://logo.clearbit.com/${symbol.toLowerCase()}.com`,
        exchange: 'NASDAQ'
      };
    }
  }

  async getNews(symbol?: string, limit: number = 20): Promise<NewsItem[]> {
    try {
      const url = symbol 
        ? `${this.baseUrl}/news/${symbol}?limit=${limit}`
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

  async getMarketNews(limit: number = 50): Promise<NewsItem[]> {
    return this.getNews(undefined, limit);
  }

  async searchSymbols(query: string): Promise<Array<{ symbol: string; description: string; type: string }>> {
    try {
      return await apiClient.get<Array<{ symbol: string; description: string; type: string }>>(`${this.baseUrl}/search?q=${encodeURIComponent(query)}`);
    } catch (error) {
      console.error('Error searching symbols:', error);
      // Return mock data for development
      return [
        { symbol: 'AAPL', description: 'Apple Inc', type: 'Common Stock' },
        { symbol: 'MSFT', description: 'Microsoft Corporation', type: 'Common Stock' },
        { symbol: 'GOOGL', description: 'Alphabet Inc Class A', type: 'Common Stock' }
      ].filter(item => 
        item.symbol.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase())
      );
    }
  }

  async getCandles(symbol: string, resolution: string = 'D', from?: number, to?: number): Promise<Record<string, unknown>> {
    try {
      const params = new URLSearchParams({
        resolution,
        ...(from && { from: from.toString() }),
        ...(to && { to: to.toString() })
      });
      return await apiClient.get<Record<string, unknown>>(`${this.baseUrl}/candles/${symbol}?${params}`);
    } catch (error) {
      console.error('Error fetching candles:', error);
      // Return mock data for development
      const mockData = {
        c: [] as number[], // close prices
        h: [] as number[], // high prices
        l: [] as number[], // low prices
        o: [] as number[], // open prices
        t: [] as number[], // timestamps
        v: [] as number[], // volumes
        s: 'ok'
      };
      
      const now = Date.now() / 1000;
      const basePrice = 150;
      
      for (let i = 30; i >= 0; i--) {
        const timestamp = now - (i * 24 * 60 * 60);
        const open = basePrice + (Math.random() - 0.5) * 20;
        const close = open + (Math.random() - 0.5) * 10;
        const high = Math.max(open, close) + Math.random() * 5;
        const low = Math.min(open, close) - Math.random() * 5;
        const volume = Math.floor(Math.random() * 10000000);
        
        mockData.t.push(timestamp);
        mockData.o.push(open);
        mockData.h.push(high);
        mockData.l.push(low);
        mockData.c.push(close);
        mockData.v.push(volume);
      }
      
      return mockData;
    }
  }
}

export const finnhubApi = new FinnhubApiService(); 