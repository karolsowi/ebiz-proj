/** Generic API response shapes used across services */

export interface ApiSuccessResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface UsageStats {
  alphaVantageCallsToday: number;
  alphaVantageLastCall: number;
  finnhubCallsToday: number;
  finnhubLastCall: number;
  lastResetDate: string;
}

export interface MarketMoverStock {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
}
