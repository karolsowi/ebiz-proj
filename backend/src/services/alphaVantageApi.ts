const DEFAULT_AV_KEY = 'demo';
const BASE_URL = 'https://www.alphavantage.co/query';

export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  lastUpdated: string;
}

export interface TimeSeriesData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CompanyOverview {
  symbol: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  marketCap: number;
  peRatio: number;
  dividendYield: number;
  beta: number;
  eps: number;
  bookValue: number;
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
  week52High: number;
  week52Low: number;
  movingAverage50Day: number;
  movingAverage200Day: number;
  fullTimeEmployees: number;
  exchange: string;
  officialSite: string;
}

export class AlphaVantageAPI {
  constructor(private readonly apiKey: string = DEFAULT_AV_KEY) {}

  private async makeRequest(params: Record<string, string>) {
    const url = new URL(BASE_URL);
    url.searchParams.append('apikey', this.apiKey);

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
      if (data['Error Message']) {
        throw new Error(data['Error Message']);
      }
      if (data['Note']) {
        throw new Error('API call frequency limit reached. Please try again later.');
      }

      return data;
    } catch (error) {
      console.error('Alpha Vantage API Error:', error);
      throw error;
    }
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    const data = await this.makeRequest({
      function: 'GLOBAL_QUOTE',
      symbol: symbol.toUpperCase()
    });

    const quote = data['Global Quote'];
    if (!quote) {
      throw new Error(`No data found for symbol: ${symbol}`);
    }

    return {
      symbol: quote['01. symbol'],
      price: parseFloat(quote['05. price']),
      change: parseFloat(quote['09. change']),
      changePercent: parseFloat(quote['10. change percent'].replace('%', '')),
      volume: parseInt(quote['06. volume']),
      previousClose: parseFloat(quote['08. previous close']),
      open: parseFloat(quote['02. open']),
      high: parseFloat(quote['03. high']),
      low: parseFloat(quote['04. low']),
      lastUpdated: quote['07. latest trading day']
    };
  }

  async getTimeSeries(symbol: string, interval: 'daily' | 'weekly' | 'monthly' = 'daily'): Promise<TimeSeriesData[]> {
    const functionMap = {
      daily: 'TIME_SERIES_DAILY',
      weekly: 'TIME_SERIES_WEEKLY',
      monthly: 'TIME_SERIES_MONTHLY'
    };

    const data = await this.makeRequest({
      function: functionMap[interval],
      symbol: symbol.toUpperCase(),
      outputsize: 'compact' // Get last 100 data points
    });

    const timeSeriesKey = Object.keys(data).find(key => key.includes('Time Series'));
    if (!timeSeriesKey) {
      throw new Error(`No time series data found for symbol: ${symbol}`);
    }

    const timeSeries = data[timeSeriesKey];

    return Object.entries(timeSeries).map(([date, values]: [string, any]) => ({
      date,
      open: parseFloat(values['1. open']),
      high: parseFloat(values['2. high']),
      low: parseFloat(values['3. low']),
      close: parseFloat(values['4. close']),
      volume: parseInt(values['5. volume'])
    })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  async getCompanyOverview(symbol: string): Promise<CompanyOverview> {
    const data = await this.makeRequest({
      function: 'OVERVIEW',
      symbol: symbol.toUpperCase()
    });

    if (!data.Symbol) {
      throw new Error(`No company overview found for symbol: ${symbol}`);
    }

    return {
      symbol: data.Symbol,
      name: data.Name,
      description: data.Description,
      sector: data.Sector,
      industry: data.Industry,
      marketCap: parseInt(data.MarketCapitalization) || 0,
      peRatio: parseFloat(data.PERatio) || 0,
      dividendYield: parseFloat(data.DividendYield) || 0,
      beta: parseFloat(data.Beta) || 0,
      eps: parseFloat(data.EPS) || 0,
      bookValue: parseFloat(data.BookValue) || 0,
      profitMargin: parseFloat(data.ProfitMargin) || 0,
      operatingMarginTTM: parseFloat(data.OperatingMarginTTM) || 0,
      returnOnAssetsTTM: parseFloat(data.ReturnOnAssetsTTM) || 0,
      returnOnEquityTTM: parseFloat(data.ReturnOnEquityTTM) || 0,
      revenueTTM: parseInt(data.RevenueTTM) || 0,
      grossProfitTTM: parseInt(data.GrossProfitTTM) || 0,
      dilutedEPSTTM: parseFloat(data.DilutedEPSTTM) || 0,
      quarterlyEarningsGrowthYOY: parseFloat(data.QuarterlyEarningsGrowthYOY) || 0,
      quarterlyRevenueGrowthYOY: parseFloat(data.QuarterlyRevenueGrowthYOY) || 0,
      analystTargetPrice: parseFloat(data.AnalystTargetPrice) || 0,
      trailingPE: parseFloat(data.TrailingPE) || 0,
      forwardPE: parseFloat(data.ForwardPE) || 0,
      priceToSalesRatioTTM: parseFloat(data.PriceToSalesRatioTTM) || 0,
      priceToBookRatio: parseFloat(data.PriceToBookRatio) || 0,
      evToRevenue: parseFloat(data.EVToRevenue) || 0,
      evToEbitda: parseFloat(data.EVToEBITDA) || 0,
      week52High: parseFloat(data['52WeekHigh']) || 0,
      week52Low: parseFloat(data['52WeekLow']) || 0,
      movingAverage50Day: parseFloat(data['50DayMovingAverage']) || 0,
      movingAverage200Day: parseFloat(data['200DayMovingAverage']) || 0,
      fullTimeEmployees: parseInt(data.FullTimeEmployees) || 0,
      exchange: data.Exchange || 'Unknown',
      officialSite: data.OfficialSite || ''
    };
  }

  async searchSymbols(keywords: string): Promise<Array<{ symbol: string, name: string, type: string, region: string, marketOpen: string, marketClose: string, timezone: string, currency: string, matchScore: string }>> {
    const data = await this.makeRequest({
      function: 'SYMBOL_SEARCH',
      keywords: keywords
    });

    if (!data.bestMatches) {
      return [];
    }

    return data.bestMatches.map((match: any) => ({
      symbol: match['1. symbol'],
      name: match['2. name'],
      type: match['3. type'],
      region: match['4. region'],
      marketOpen: match['5. marketOpen'],
      marketClose: match['6. marketClose'],
      timezone: match['7. timezone'],
      currency: match['8. currency'],
      matchScore: match['9. matchScore']
    }));
  }

  async getTopGainersLosers(): Promise<{
    topGainers: Array<{ symbol: string, price: string, changeAmount: string, changePercentage: string, volume: string }>,
    topLosers: Array<{ symbol: string, price: string, changeAmount: string, changePercentage: string, volume: string }>,
    mostActivelyTraded: Array<{ symbol: string, price: string, changeAmount: string, changePercentage: string, volume: string }>
  }> {
    const data = await this.makeRequest({
      function: 'TOP_GAINERS_LOSERS'
    });

    const normalize = (row: Record<string, unknown>) => {
      const pct = row.changePercentage ?? row.change_percentage ?? '0';
      const pctStr = String(pct);
      return {
        symbol: String(row.symbol ?? row.ticker ?? '').trim(),
        price: String(row.price ?? '0'),
        changeAmount: String(row.changeAmount ?? row.change_amount ?? '0'),
        changePercentage: pctStr.includes('%') ? pctStr : `${pctStr}%`,
        volume: String(row.volume ?? '0'),
      };
    };

    const mapRows = (rows: unknown) =>
      (Array.isArray(rows) ? rows : []).map((r) => normalize(r as Record<string, unknown>));

    return {
      topGainers: mapRows(data.top_gainers),
      topLosers: mapRows(data.top_losers),
      mostActivelyTraded: mapRows(data.most_actively_traded),
    };
  }
}

/** Legacy singleton (server .env) — prefer getAlphaVantageClientForUser(userId) in request handlers. */
export const alphaVantageAPI = new AlphaVantageAPI(DEFAULT_AV_KEY);