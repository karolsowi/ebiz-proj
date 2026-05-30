import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient';

export type IntegrationService =
  | 'alpaca'
  | 'finnhub'
  | 'alphavantage'
  | 'reddit'
  | 'news';

export interface IntegrationStatusResponse {
  integrations: Record<IntegrationService, boolean>;
  canFetchNews: boolean;
  canManageReddit: boolean;
  canUseAlpaca: boolean;
}

export function useIntegrationStatus() {
  const [status, setStatus] = useState<IntegrationStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<IntegrationStatusResponse>('/api/user/integrations');
      setStatus(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load integration status');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, loading, error, refresh };
}
