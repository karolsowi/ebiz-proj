// Frontend service for Alpaca API - makes API calls to backend
import { apiClient } from './apiClient';
import { apiUrl } from '../utils/apiUrl';

export interface CreateOrderRequest {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  time_in_force: 'day' | 'gtc' | 'ioc' | 'fok';
  limit_price?: number;
  stop_price?: number;
  extended_hours?: boolean;
}

export interface Order {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at?: string;
  expired_at?: string;
  canceled_at?: string;
  failed_at?: string;
  replaced_at?: string;
  replaced_by?: string;
  replaces?: string;
  asset_id: string;
  symbol: string;
  asset_class: string;
  notional?: number;
  qty: number;
  filled_qty: number;
  filled_avg_price?: number;
  order_class: string;
  order_type: string;
  type: string;
  side: string;
  time_in_force: string;
  limit_price?: number;
  stop_price?: number;
  status: string;
  extended_hours: boolean;
  legs?: Record<string, unknown>[];
  trail_percent?: number;
  trail_price?: number;
  hwm?: number;
}

export interface Position {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  avg_entry_price: number;
  qty: number;
  side: 'long' | 'short';
  market_value: number;
  cost_basis: number;
  unrealized_pl: number;
  unrealized_plpc: number;
  unrealized_intraday_pl: number;
  unrealized_intraday_plpc: number;
  current_price: number;
  lastday_price: number;
  change_today: number;
}

export interface Account {
  id: string;
  account_number: string;
  status: string;
  crypto_status?: string;
  currency: string;
  buying_power: number;
  regt_buying_power: number;
  daytrading_buying_power: number;
  non_marginable_buying_power: number;
  cash: number;
  accrued_fees: number;
  pending_transfer_out?: number;
  pending_transfer_in?: number;
  portfolio_value: number;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  transfers_blocked: boolean;
  account_blocked: boolean;
  created_at: string;
  trade_suspended_by_user: boolean;
  multiplier: number;
  shorting_enabled: boolean;
  equity: number;
  last_equity: number;
  long_market_value: number;
  short_market_value: number;
  initial_margin: number;
  maintenance_margin: number;
  last_maintenance_margin: number;
  sma: number;
  daytrade_count: number;
}

class AlpacaApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = apiUrl('/api/alpaca');
  }

  async getAccount(): Promise<Account> {
    try {
      return await apiClient.get<Account>(`${this.baseUrl}/account`);
    } catch (error) {
      console.error('Error fetching account:', error);
      throw error; // Don't return mock data, let the error propagate
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      return await apiClient.get<Position[]>(`${this.baseUrl}/positions`);
    } catch (error) {
      console.error('Error fetching positions:', error);
      return []; // Return empty array instead of mock data
    }
  }

  async getOrders(status?: string): Promise<Order[]> {
    try {
      const url = status ? `${this.baseUrl}/orders?status=${status}` : `${this.baseUrl}/orders`;
      return await apiClient.get<Order[]>(url);
    } catch (error) {
      console.error('Error fetching orders:', error);
      return []; // Return empty array instead of mock data
    }
  }

  async createOrder(orderRequest: CreateOrderRequest): Promise<Order> {
    try {
      return await apiClient.post<Order>(`${this.baseUrl}/orders`, orderRequest);
    } catch (error) {
      console.error('Error creating order:', error);
      throw error;
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    try {
      await apiClient.delete(`${this.baseUrl}/orders/${orderId}`);
    } catch (error) {
      console.error('Error canceling order:', error);
      throw error;
    }
  }

  async getPortfolioHistory(period?: string): Promise<Record<string, unknown>> {
    try {
      const url = period ? `${this.baseUrl}/portfolio/history?period=${period}` : `${this.baseUrl}/portfolio/history`;
      return await apiClient.get<Record<string, unknown>>(url);
    } catch (error) {
      console.error('Error fetching portfolio history:', error);
      throw error;
    }
  }
}

export const alpacaApi = new AlpacaApiService(); 