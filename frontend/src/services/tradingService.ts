import { apiClient } from './apiClient';
import { apiUrl } from '../utils/apiUrl';

export interface TradeOrder {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  time_in_force: 'day' | 'gtc' | 'ioc' | 'fok';
  qty: string;
  limit_price?: string;
  stop_price?: string;
  extended_hours?: boolean;
  client_order_id?: string;
}

export interface TradeHistoryItem {
  id: number;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: string;
  quantity: string;
  filledQuantity: string;
  limitPrice?: string;
  averageFillPrice?: string;
  status: string;
  submittedAt: string;
  filledAt?: string;
  commission: string;
  fees: string;
  account: {
    accountType: string;
    provider: string;
  };
}

export interface TradingStats {
  totalTrades: number;
  successfulTrades: number;
  totalPL: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  dayTradeCount: number;
  paperTrading: boolean;
  realizedPL: number;
  unrealizedPL: number;
}

export interface RiskSettings {
  maxPositionSizePercent: number;
  dailyLossLimit: number;
  perTradeRiskPercent: number;
}

export interface RiskViolation {
  code: 'MAX_POSITION_SIZE' | 'DAILY_LOSS_LIMIT' | 'PER_TRADE_RISK';
  message: string;
}

export interface Position {
  id: number;
  symbol: string;
  quantity: string;
  side: 'long' | 'short';
  marketValue: string;
  costBasis: string;
  unrealizedPL: string;
  unrealizedPLPercent: string;
  currentPrice: string;
  avgEntryPrice: string;
  account: {
    accountType: string;
    provider: string;
  };
}

export interface AccountInfo {
  id: number;
  accountId: string;
  name: string;
  provider: string;
  accountType: 'paper' | 'live';
  status: string;
  balance: string;
  buyingPower: string;
  portfolioValue: string;
  dayTradeCount: number;
  patternDayTrader: boolean;
  isPaperTrading: boolean;
  environment: string;
}

class TradingService {
  private baseURL = apiUrl('/api/trading');

  // Initialize trading account
  async initializeAccount(): Promise<void> {
    await apiClient.post(`${this.baseURL}/initialize`);
  }

  // Get account info
  async getAccountInfo(): Promise<AccountInfo> {
    return apiClient.get<AccountInfo>(`${this.baseURL}/account`);
  }

  // Sync account data
  async syncAccount(): Promise<void> {
    await apiClient.post(`${this.baseURL}/sync`);
  }

  // Place a trade order
  async placeOrder(order: TradeOrder): Promise<Record<string, unknown>> {
    try {
      return await apiClient.post(`${this.baseURL}/orders`, order);
    } catch (e: unknown) {
      const err = e as Error & { body?: { code?: string; violations?: RiskViolation[] } };
      const b = err.body;
      if (
        b &&
        typeof b === 'object' &&
        b.code === 'RISK_RULE_VIOLATION' &&
        Array.isArray(b.violations)
      ) {
        const message = (b.violations as RiskViolation[]).map((v) => v.message).join(' | ');
        throw new Error(message || 'Order rejected by risk controls');
      }
      throw e;
    }
  }

  async getRiskSettings(): Promise<RiskSettings> {
    return apiClient.get<RiskSettings>(`${this.baseURL}/risk-settings`);
  }

  async updateRiskSettings(settings: Partial<RiskSettings>): Promise<RiskSettings> {
    return apiClient.put<RiskSettings>(`${this.baseURL}/risk-settings`, settings);
  }

  // Cancel an order
  async cancelOrder(orderId: string): Promise<void> {
    await apiClient.delete(`${this.baseURL}/orders/${encodeURIComponent(orderId)}`);
  }

  // Get trade history
  async getTradeHistory(filters?: {
    startDate?: string;
    endDate?: string;
    symbol?: string;
    side?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ trades: TradeHistoryItem[]; totalCount: number; paperTrading: boolean }> {
    const params = new URLSearchParams();

    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.symbol) params.append('symbol', filters.symbol);
    if (filters?.side) params.append('side', filters.side);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (filters?.offset) params.append('offset', filters.offset.toString());

    return apiClient.get(`${this.baseURL}/history?${params}`);
  }

  // Get trading statistics
  async getTradingStats(period?: { startDate: string; endDate: string }): Promise<TradingStats> {
    const params = new URLSearchParams();

    if (period) {
      params.append('startDate', period.startDate);
      params.append('endDate', period.endDate);
      params.append('period', 'custom');
    }

    return apiClient.get<TradingStats>(`${this.baseURL}/stats?${params}`);
  }

  // Get current positions
  async getPositions(): Promise<{ positions: Position[]; count: number; paperTrading: boolean }> {
    return apiClient.get(`${this.baseURL}/positions`);
  }

  // Close position
  async closePosition(symbol: string): Promise<Record<string, unknown>> {
    const enc = encodeURIComponent(symbol);
    return apiClient.post(`${this.baseURL}/positions/${enc}/close`);
  }

  // Get trading environment info
  async getEnvironment(): Promise<{
    isPaperTrading: boolean;
    environment: string;
    accountType: string;
    provider: string;
    warning: string;
  }> {
    return apiClient.get(`${this.baseURL}/environment`);
  }

  // Health check
  async healthCheck(): Promise<{
    status: string;
    service: string;
    paperTrading: boolean;
    provider: string;
    timestamp: string;
  }> {
    return apiClient.get(`${this.baseURL}/health`);
  }

  // Format currency
  formatCurrency(value: string | number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(typeof value === 'string' ? parseFloat(value) : value);
  }

  // Format percentage
  formatPercent(value: string | number): string {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return `${(num * 100).toFixed(2)}%`;
  }

  // Calculate P&L color class
  getPLColorClass(value: string | number): string {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (num > 0) return 'text-green-600 dark:text-green-400';
    if (num < 0) return 'text-red-600 dark:text-red-400';
    return 'text-gray-600 dark:text-gray-400';
  }
}

export const tradingService = new TradingService();