import { apiClient } from './apiClient';

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  timezone: string;
  language: string;
  emailVerified: boolean;
  dateJoined: string;
}

export interface UserSettings {
  theme: string;
  language: string;
  timezone: string;
  currency: string;
  dateFormat: string;
  defaultChartType: string;
  refreshInterval: number;
  emailNotifications: boolean;
  tradingAlerts: boolean;
  paperTradingMode: boolean;
  confirmOrders: boolean;
  riskWarnings: boolean;
}

export interface UserApiKey {
  id: string;
  name: string;
  service: string;
  isActive: boolean;
  lastUsedAt?: string;
  createdAt: string;
  apiKeyPreview?: string;
  secretConfigured?: boolean;
  paperTrading?: boolean;
}

export const userApiService = {
  getProfile: () => apiClient.get<UserProfile>('/api/user/profile'),
  updateProfile: (data: Partial<Pick<UserProfile, 'firstName' | 'lastName' | 'timezone' | 'language'>>) =>
    apiClient.put<UserProfile>('/api/user/profile', data),

  getSettings: () => apiClient.get<UserSettings>('/api/user/settings'),
  updateSettings: (data: Partial<UserSettings>) =>
    apiClient.put<UserSettings>('/api/user/settings', data),

  getApiKeys: () => apiClient.get<UserApiKey[]>('/api/user/api-keys'),

  getIntegrationStatus: () =>
    apiClient.get<{
      integrations: Record<string, boolean>;
      canFetchNews: boolean;
      canManageReddit: boolean;
      canUseAlpaca: boolean;
    }>('/api/user/integrations'),
  addApiKey: (data: {
    name: string;
    service: string;
    apiKey: string;
    secretKey?: string;
    paperTrading?: boolean;
  }) => apiClient.post<UserApiKey>('/api/user/api-keys', data),
  updateApiKey: (
    keyId: string,
    data: Partial<{
      name: string;
      isActive: boolean;
      apiKey: string;
      secretKey: string;
      paperTrading: boolean;
    }>
  ) => apiClient.put<UserApiKey>(`/api/user/api-keys/${keyId}`, data),
  deleteApiKey: (keyId: string) =>
    apiClient.delete<{ message: string }>(`/api/user/api-keys/${keyId}`),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.put<{ success: boolean; message: string }>('/api/user/change-password', {
      currentPassword,
      newPassword,
    }),
};
