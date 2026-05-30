import { apiClient } from './apiClient';

export interface IndicatorSignal {
  value: number;
  signal: 'buy' | 'sell' | 'neutral';
  strength?: number;
  label: string;
}

export interface DetectedPattern {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  date: string;
  significance: 'high' | 'medium' | 'low';
}

export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: 'strong' | 'weak';
}

export interface TechnicalIndicators {
  sma20: IndicatorSignal;
  sma50: IndicatorSignal;
  sma200: IndicatorSignal;
  ema9: IndicatorSignal;
  ema21: IndicatorSignal;
  rsi14: IndicatorSignal;
  macd: {
    value: number;
    signal: number;
    histogram: number;
    tradeSignal: 'buy' | 'sell' | 'neutral';
    label: string;
  };
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
    tradeSignal: 'buy' | 'sell' | 'neutral';
    label: string;
  };
  atr14: number;

  obv: IndicatorSignal;
  vwap: IndicatorSignal;
  supportResistanceLevels: SupportResistanceLevel[];
  detectedPatterns: DetectedPattern[];
  fibonacci: {
    level0: number;
    level236: number;
    level382: number;
    level500: number;
    level618: number;
    level1000: number;
  };

  overallScore: number;
  overallSignal: 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell';
  multiTimeframe: {
    aggregatedScore: number;
    aggregatedSignal: 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell';
    confidence: number;
    breakdown: Array<{
      timeframe: string;
      score: number;
      signal: 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell';
    }>;
  };
}

export const technicalApi = {
  async getAnalysis(symbol: string, timeframe = 'daily'): Promise<TechnicalIndicators> {
    try {
      const enc = encodeURIComponent(symbol);
      return await apiClient.get<TechnicalIndicators>(
        `/api/technical/${enc}?timeframe=${encodeURIComponent(timeframe)}`
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('404') || msg.includes('Not enough')) {
        throw new Error(
          `Not enough historical data for ${symbol}. Wait a few seconds for price data to load, then refresh.`
        );
      }
      throw error;
    }
  },

  async getChartForRange(
    symbol: string,
    params: { startDate: string; endDate: string; limit: number; timeframe?: string }
  ): Promise<{ data: unknown[]; indicators: Record<string, unknown> | null }> {
    const tf = params.timeframe ?? 'daily';
    const qs = new URLSearchParams({
      startDate: params.startDate,
      endDate: params.endDate,
      limit: String(params.limit),
      timeframe: tf,
    });
    const enc = encodeURIComponent(symbol);
    return await apiClient.get<{ data: unknown[]; indicators: Record<string, unknown> | null }>(
      `/api/technical/${enc}/chart?${qs}`
    );
  },

  async getChartData(
    symbol: string,
    days = 100,
    timeframe = 'daily'
  ): Promise<{ data: unknown[]; indicators?: unknown }> {
    const enc = encodeURIComponent(symbol);
    return await apiClient.get<{ data: unknown[]; indicators?: unknown }>(
      `/api/technical/${enc}/chart?days=${days}&timeframe=${encodeURIComponent(timeframe)}`
    );
  },
};
