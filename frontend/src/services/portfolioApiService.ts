import { apiClient } from './apiClient';

export interface PortfolioRefreshResponse {
  updatedCount: number;
  failedCount: number;
  failedSymbols: Array<{ symbol: string; reason: string }>;
  summary: {
    totalValue: string;
    totalCost: string;
    totalGainLoss: string;
    totalGainLossPercent: string;
    entryCount: number;
  };
  refreshedAt: string;
}

class PortfolioApiService {
  private baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  async refreshPrices(): Promise<PortfolioRefreshResponse> {
    return apiClient.post<PortfolioRefreshResponse>(`${this.baseUrl}/api/portfolio/refresh-prices`);
  }
}

export const portfolioApiService = new PortfolioApiService();
