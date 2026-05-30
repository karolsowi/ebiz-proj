import { AuthUser } from '../types/auth';
import { apiClient } from './apiClient';

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export const authService = {
  getAccessToken(): string | null {
    return apiClient.tokens.access;
  },

  getRefreshToken(): string | null {
    return apiClient.tokens.refresh;
  },

  setTokens(accessToken: string, refreshToken: string): void {
    apiClient.tokens.set(accessToken, refreshToken);
  },

  clearTokens(): void {
    apiClient.tokens.clear();
  },

  async register(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<AuthResponse> {
    return apiClient.post<AuthResponse>('/api/auth/register', input);
  },

  async login(input: { email: string; password: string; rememberMe?: boolean }): Promise<AuthResponse> {
    return apiClient.post<AuthResponse>('/api/auth/login', input);
  },

  async refresh(refreshToken: string): Promise<RefreshResponse> {
    return apiClient.post<RefreshResponse>('/api/auth/refresh', { refreshToken });
  },

  async logout(refreshToken: string | null): Promise<void> {
    await apiClient.post('/api/auth/logout', { refreshToken }).catch(() => undefined);
  },

  async getCurrentUser(): Promise<AuthUser> {
    const data = await apiClient.get<{ user: AuthUser }>('/api/auth/me');
    return data.user;
  },
};
