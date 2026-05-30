// Ensure environment variables are loaded
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

const BASE_URL = 'https://finnhub.io/api/v1';
const DEFAULT_FINNHUB_KEY = 'demo';

export interface FinnhubQuote {
  c: number; // Current price
  d: number; // Change
  dp: number; // Percent change
  h: number; // High price of the day
  l: number; // Low price of the day
  o: number; // Open price of the day
  pc: number; // Previous close price
  t: number; // Timestamp
}

export interface FinnhubCompanyProfile {
  country: string;
  currency: string;
  exchange: string;
  ipo: string;
  marketCapitalization: number;
  name: string;
  phone: string;
  shareOutstanding: number;
  ticker: string;
  weburl: string;
  logo: string;
  finnhubIndustry: string;
}

export interface FinnhubNews {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export interface FinnhubMetrics {
  "10DayAverageTradingVolume": number;
  "13WeekPriceReturnDaily": number;
  "26WeekPriceReturnDaily": number;
  "3MonthAverageTradingVolume": number;
  "52WeekHigh": number;
  "52WeekHighDate": string;
  "52WeekLow": number;
  "52WeekLowDate": string;
  "52WeekPriceReturnDaily": number;
  "5DayPriceReturnDaily": number;
  beta: number;
}

export interface FinnhubRecommendation {
  buy: number;
  hold: number;
  period: string;
  sell: number;
  strongBuy: number;
  strongSell: number;
  symbol: string;
}

export interface FinnhubEarnings {
  actual: number;
  estimate: number;
  period: string;
  quarter: number;
  surprise: number;
  surprisePercent: number;
  symbol: string;
  year: number;
}

export interface FinnhubEarningsCalendarEntry {
  date: string;
  epsActual?: number | null;
  epsEstimate?: number | null;
  hour?: string | null;
  quarter?: number | null;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
  symbol: string;
  year?: number | null;
}

// Normalized interfaces for consistency with Alpha Vantage
export interface NormalizedQuote {
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
  source: 'alphavantage' | 'finnhub' | 'database';
}

export interface NormalizedCompanyInfo {
  symbol: string;
  name: string;
  description?: string;
  sector?: string;
  industry: string;
  marketCap: number;
  country?: string;
  currency?: string;
  exchange?: string;
  website?: string;
  logo?: string;
  source: 'alphavantage' | 'finnhub';
}

export class FinnhubAPI {
  constructor(private readonly apiKey: string = DEFAULT_FINNHUB_KEY) {}

  private async makeRequest(endpoint: string, params: Record<string, string> = {}) {
    const url = new URL(`${BASE_URL}${endpoint}`);
    url.searchParams.append('token', this.apiKey);
    
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      
      // Check for API error messages
      if (data.error) {
        throw new Error(data.error);
      }
      
      return data;
    } catch (error) {
      console.error('Finnhub API Error:', error);
      throw error;
    }
  }

  async getQuote(symbol: string): Promise<FinnhubQuote> {
    const data = await this.makeRequest('/quote', { symbol: symbol.toUpperCase() });
    return data;
  }

  async getCompanyProfile(symbol: string): Promise<FinnhubCompanyProfile> {
    const data = await this.makeRequest('/stock/profile2', { symbol: symbol.toUpperCase() });
    return data;
  }

  async getCompanyNews(symbol: string, from?: string, to?: string): Promise<FinnhubNews[]> {
    const params: Record<string, string> = { symbol: symbol.toUpperCase() };
    
    if (from) params.from = from;
    if (to) params.to = to;
    
    // Default to last 7 days if no dates provided
    if (!from && !to) {
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 7);
      
      params.from = fromDate.toISOString().split('T')[0] || '';
      params.to = toDate.toISOString().split('T')[0] || '';
    }
    
    const data = await this.makeRequest('/company-news', params);
    return data;
  }

  async getGeneralNews(category: string = 'general'): Promise<FinnhubNews[]> {
    const data = await this.makeRequest('/news', { category });
    return data;
  }

  async getBasicFinancials(symbol: string): Promise<FinnhubMetrics> {
    const data = await this.makeRequest('/stock/metric', { 
      symbol: symbol.toUpperCase(),
      metric: 'all'
    });
    return data.metric;
  }

  async getRecommendationTrends(symbol: string): Promise<FinnhubRecommendation[]> {
    const data = await this.makeRequest('/stock/recommendation', { symbol: symbol.toUpperCase() });
    return data;
  }

  async getEarnings(
    symbol: string,
    options?: { limit?: number }
  ): Promise<FinnhubEarnings[]> {
    const params: Record<string, string> = { symbol: symbol.toUpperCase() };
    if (options?.limit !== undefined && Number.isFinite(options.limit)) {
      params.limit = String(Math.max(1, Math.floor(options.limit)));
    }
    const data = await this.makeRequest('/stock/earnings', params);
    return Array.isArray(data) ? data : [];
  }

  async getEarningsCalendar(params: {
    from: string;
    to: string;
    symbol?: string;
  }): Promise<FinnhubEarningsCalendarEntry[]> {
    const requestParams: Record<string, string> = {
      from: params.from,
      to: params.to,
    };

    if (params.symbol) {
      requestParams.symbol = params.symbol.toUpperCase();
    }

    const data = await this.makeRequest('/calendar/earnings', requestParams);
    return Array.isArray(data?.earningsCalendar)
      ? data.earningsCalendar as FinnhubEarningsCalendarEntry[]
      : [];
  }

  async searchSymbols(query: string): Promise<Array<{symbol: string, description: string, displaySymbol: string, type: string}>> {
    const data = await this.makeRequest('/search', { q: query });
    return data.result || [];
  }

  // Utility methods to normalize data for consistency with Alpha Vantage
  normalizeQuote(finnhubQuote: FinnhubQuote, symbol: string): NormalizedQuote {
    const dateStr = new Date(finnhubQuote.t * 1000).toISOString().split('T')[0];
    return {
      symbol: symbol.toUpperCase(),
      price: finnhubQuote.c,
      change: finnhubQuote.d,
      changePercent: finnhubQuote.dp,
      previousClose: finnhubQuote.pc,
      open: finnhubQuote.o,
      high: finnhubQuote.h,
      low: finnhubQuote.l,
      lastUpdated: dateStr || new Date().toISOString().split('T')[0] || '',
      source: 'finnhub'
    };
  }

  normalizeCompanyInfo(profile: FinnhubCompanyProfile): NormalizedCompanyInfo {
    return {
      symbol: profile.ticker,
      name: profile.name,
      industry: profile.finnhubIndustry || 'Unknown',
      marketCap: profile.marketCapitalization * 1000000, // Finnhub returns in millions
      country: profile.country,
      currency: profile.currency,
      exchange: profile.exchange,
      website: profile.weburl,
      logo: profile.logo,
      source: 'finnhub'
    };
  }

  // Market data aggregation methods
  async getMarketStatus(): Promise<{isOpen: boolean, session: string}> {
    try {
      const data = await this.makeRequest('/stock/market-status', { exchange: 'US' });
      return {
        isOpen: data.isOpen,
        session: data.session
      };
    } catch {
      return { isOpen: false, session: 'unknown' };
    }
  }

  async getMarketHolidays(): Promise<Array<{eventName: string, atDate: string, tradingHour: string}>> {
    try {
      const data = await this.makeRequest('/stock/market-holiday', { exchange: 'US' });
      return data.data || [];
    } catch {
      return [];
    }
  }
}

/** Legacy singleton (server .env) — prefer getFinnhubClientForUser(userId) in request handlers. */
export const finnhubAPI = new FinnhubAPI(DEFAULT_FINNHUB_KEY); 