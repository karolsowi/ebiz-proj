// Frontend service for Alpha Vantage API - makes API calls to backend
import { apiClient } from './apiClient';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: string;
  volume: number;
  latestTradingDay: string;
  previousClose: number;
  open: number;
  high: number;
  low: number;
}

export interface CompanyOverview {
  symbol: string;
  name: string;
  description: string;
  cik: string;
  exchange: string;
  currency: string;
  country: string;
  sector: string;
  industry: string;
  address: string;
  fiscalYearEnd: string;
  latestQuarter: string;
  marketCapitalization: number;
  ebitda: number;
  peRatio: number;
  pegRatio: number;
  bookValue: number;
  dividendPerShare: number;
  dividendYield: number;
  eps: number;
  revenuePerShareTTM: number;
  profitMargin: number;
  operatingMarginTTM: number;
  returnOnAssetsTTM: number;
  returnOnEquityTTM: number;
  revenueTTM: number;
  grossProfitTTM: number;
  dilutedEPSTTM: number;
  quarterlyEarningsGrowthYOY: number;
  quarterlyRevenueGrowthYOY: number;
  analystTargetPrice: number;
  trailingPE: number;
  forwardPE: number;
  priceToSalesRatioTTM: number;
  priceToBookRatio: number;
  evToRevenue: number;
  evToEbitda: number;
  beta: number;
  week52High: number;
  week52Low: number;
  day50MovingAverage: number;
  day200MovingAverage: number;
  sharesOutstanding: number;
  dividendDate: string;
  exDividendDate: string;
}

export interface TimeSeriesData {
  [date: string]: {
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  };
}

export interface TimeSeriesResponse {
  metaData: {
    information: string;
    symbol: string;
    lastRefreshed: string;
    interval?: string;
    outputSize: string;
    timeZone: string;
  };
  timeSeries: TimeSeriesData;
}

class AlphaVantageApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${API_BASE_URL}/api/alphavantage`;
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    try {
      return await apiClient.get<StockQuote>(`${this.baseUrl}/quote/${symbol}`);
    } catch (error) {
      console.error('Error fetching Alpha Vantage quote:', error);
      // Return mock data for development
      const price = 150 + Math.random() * 50;
      const previousClose = price + (Math.random() - 0.5) * 10;
      const change = price - previousClose;
      const changePercent = ((change / previousClose) * 100).toFixed(2);
      
      return {
        symbol,
        price,
        change,
        changePercent: `${changePercent}%`,
        volume: Math.floor(Math.random() * 10000000),
        latestTradingDay: new Date().toISOString().split('T')[0],
        previousClose,
        open: previousClose + (Math.random() - 0.5) * 5,
        high: Math.max(price, previousClose) + Math.random() * 5,
        low: Math.min(price, previousClose) - Math.random() * 5
      };
    }
  }

  async getCompanyOverview(symbol: string): Promise<CompanyOverview> {
    try {
      return await apiClient.get<CompanyOverview>(`${this.baseUrl}/overview/${symbol}`);
    } catch (error) {
      console.error('Error fetching company overview:', error);
      // Return mock data for development
      return {
        symbol,
        name: `${symbol} Corporation`,
        description: `${symbol} is a leading technology company that develops innovative products and services.`,
        cik: '0000320193',
        exchange: 'NASDAQ',
        currency: 'USD',
        country: 'USA',
        sector: 'Technology',
        industry: 'Consumer Electronics',
        address: '1 Infinite Loop, Cupertino, CA 95014',
        fiscalYearEnd: 'September',
        latestQuarter: '2023-12-31',
        marketCapitalization: Math.floor(Math.random() * 1000000000000),
        ebitda: Math.floor(Math.random() * 100000000000),
        peRatio: 15 + Math.random() * 20,
        pegRatio: 1 + Math.random() * 2,
        bookValue: 10 + Math.random() * 20,
        dividendPerShare: Math.random() * 5,
        dividendYield: Math.random() * 3,
        eps: 5 + Math.random() * 10,
        revenuePerShareTTM: 50 + Math.random() * 100,
        profitMargin: 0.1 + Math.random() * 0.3,
        operatingMarginTTM: 0.15 + Math.random() * 0.25,
        returnOnAssetsTTM: 0.1 + Math.random() * 0.2,
        returnOnEquityTTM: 0.2 + Math.random() * 0.3,
        revenueTTM: Math.floor(Math.random() * 500000000000),
        grossProfitTTM: Math.floor(Math.random() * 200000000000),
        dilutedEPSTTM: 5 + Math.random() * 10,
        quarterlyEarningsGrowthYOY: Math.random() * 0.5,
        quarterlyRevenueGrowthYOY: Math.random() * 0.3,
        analystTargetPrice: 150 + Math.random() * 100,
        trailingPE: 15 + Math.random() * 20,
        forwardPE: 12 + Math.random() * 18,
        priceToSalesRatioTTM: 2 + Math.random() * 8,
        priceToBookRatio: 1 + Math.random() * 10,
        evToRevenue: 3 + Math.random() * 7,
        evToEbitda: 10 + Math.random() * 20,
        beta: 0.8 + Math.random() * 0.8,
        week52High: 200 + Math.random() * 50,
        week52Low: 100 + Math.random() * 50,
        day50MovingAverage: 150 + Math.random() * 30,
        day200MovingAverage: 140 + Math.random() * 40,
        sharesOutstanding: Math.floor(Math.random() * 20000000000),
        dividendDate: '2023-11-15',
        exDividendDate: '2023-11-10'
      };
    }
  }

  async getTimeSeriesDaily(symbol: string, outputSize: 'compact' | 'full' = 'compact'): Promise<TimeSeriesResponse> {
    try {
      return await apiClient.get<TimeSeriesResponse>(`${this.baseUrl}/daily/${symbol}?outputSize=${outputSize}`);
    } catch (error) {
      console.error('Error fetching daily time series:', error);
      // Return mock data for development
      const timeSeries: TimeSeriesData = {};
      const basePrice = 150;
      
      for (let i = 100; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        const open = basePrice + (Math.random() - 0.5) * 20;
        const close = open + (Math.random() - 0.5) * 10;
        const high = Math.max(open, close) + Math.random() * 5;
        const low = Math.min(open, close) - Math.random() * 5;
        const volume = Math.floor(Math.random() * 10000000);
        
        timeSeries[dateStr] = {
          open: open.toFixed(2),
          high: high.toFixed(2),
          low: low.toFixed(2),
          close: close.toFixed(2),
          volume: volume.toString()
        };
      }
      
      return {
        metaData: {
          information: 'Daily Prices (open, high, low, close) and Volumes',
          symbol,
          lastRefreshed: new Date().toISOString().split('T')[0],
          outputSize,
          timeZone: 'US/Eastern'
        },
        timeSeries
      };
    }
  }

  async getTimeSeriesIntraday(
    symbol: string, 
    interval: '1min' | '5min' | '15min' | '30min' | '60min' = '5min',
    outputSize: 'compact' | 'full' = 'compact'
  ): Promise<TimeSeriesResponse> {
    try {
      return await apiClient.get<TimeSeriesResponse>(`${this.baseUrl}/intraday/${symbol}?interval=${interval}&outputSize=${outputSize}`);
    } catch (error) {
      console.error('Error fetching intraday time series:', error);
      // Return mock data for development
      const timeSeries: TimeSeriesData = {};
      const basePrice = 150;
      const intervalMinutes = parseInt(interval.replace('min', ''));
      
      for (let i = 100; i >= 0; i--) {
        const date = new Date();
        date.setMinutes(date.getMinutes() - (i * intervalMinutes));
        const dateStr = date.toISOString().slice(0, 19);
        
        const open = basePrice + (Math.random() - 0.5) * 10;
        const close = open + (Math.random() - 0.5) * 5;
        const high = Math.max(open, close) + Math.random() * 2;
        const low = Math.min(open, close) - Math.random() * 2;
        const volume = Math.floor(Math.random() * 1000000);
        
        timeSeries[dateStr] = {
          open: open.toFixed(2),
          high: high.toFixed(2),
          low: low.toFixed(2),
          close: close.toFixed(2),
          volume: volume.toString()
        };
      }
      
      return {
        metaData: {
          information: `Intraday (${interval}) open, high, low, close prices and volume`,
          symbol,
          lastRefreshed: new Date().toISOString(),
          interval,
          outputSize,
          timeZone: 'US/Eastern'
        },
        timeSeries
      };
    }
  }

  async searchSymbols(keywords: string): Promise<Array<{
    symbol: string;
    name: string;
    type: string;
    region: string;
    marketOpen: string;
    marketClose: string;
    timezone: string;
    currency: string;
    matchScore: string;
  }>> {
    try {
      return await apiClient.get<Array<{
        symbol: string;
        name: string;
        type: string;
        region: string;
        marketOpen: string;
        marketClose: string;
        timezone: string;
        currency: string;
        matchScore: string;
      }>>(`${this.baseUrl}/search?keywords=${encodeURIComponent(keywords)}`);
    } catch (error) {
      console.error('Error searching symbols:', error);
      // Return mock data for development
      return [
        {
          symbol: 'AAPL',
          name: 'Apple Inc',
          type: 'Equity',
          region: 'United States',
          marketOpen: '09:30',
          marketClose: '16:00',
          timezone: 'UTC-04',
          currency: 'USD',
          matchScore: '1.0000'
        },
        {
          symbol: 'MSFT',
          name: 'Microsoft Corporation',
          type: 'Equity',
          region: 'United States',
          marketOpen: '09:30',
          marketClose: '16:00',
          timezone: 'UTC-04',
          currency: 'USD',
          matchScore: '0.8000'
        }
      ].filter(item => 
        item.symbol.toLowerCase().includes(keywords.toLowerCase()) ||
        item.name.toLowerCase().includes(keywords.toLowerCase())
      );
    }
  }
}

export const alphaVantageAPI = new AlphaVantageApiService(); 