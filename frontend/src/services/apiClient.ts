/**
 * Central API client with automatic Authorization header injection
 * and transparent token refresh on 401 responses.
 */

import { apiUrl } from '../utils/apiUrl';

const ACCESS_TOKEN_KEY = 'inwest_access_token';
const REFRESH_TOKEN_KEY = 'inwest_refresh_token';

let refreshPromise: Promise<string> | null = null;

function resolveUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return apiUrl(url.startsWith('/') ? url : `/${url}`);
}

function getToken(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = getToken(REFRESH_TOKEN_KEY);
  if (!refreshToken) throw new Error('No refresh token');

  const res = await fetch(resolveUrl('/api/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    clearTokens();
    window.dispatchEvent(new CustomEvent('auth:logout'));
    throw new Error('Session expired. Please log in again.');
  }

  const data = await res.json() as { accessToken: string; refreshToken: string };
  setTokens(data.accessToken, data.refreshToken);
  return data.accessToken;
}

async function ensureFreshToken(): Promise<string | null> {
  return getToken(ACCESS_TOKEN_KEY);
}

async function request<T>(
  url: string,
  options: RequestInit = {},
  retried = false
): Promise<T> {
  const token = await ensureFreshToken();
  const fullUrl = resolveUrl(url);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(fullUrl, { ...options, headers });

  if (response.status === 401 && !retried) {
    try {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      await refreshPromise;
      return request<T>(url, options, true);
    } catch {
      clearTokens();
      throw new Error('Session expired. Please log in again.');
    }
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    let body: unknown;
    try {
      body = await response.json();
      const j = body as { error?: string; message?: string; code?: string; violations?: unknown };
      message = j.error ?? j.message ?? message;
    } catch { /* ignore parse errors */ }
    const err = new Error(message) as Error & { status: number; body?: unknown };
    err.status = response.status;
    err.body = body;
    throw err;
  }

  if (response.status === 204) return undefined as unknown as T;

  return response.json() as Promise<T>;
}

export const apiClient = {
  get<T>(url: string, options?: Omit<RequestInit, 'method'>): Promise<T> {
    return request<T>(url, { ...options, method: 'GET' });
  },

  post<T>(url: string, body?: unknown, options?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    return request<T>(url, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  put<T>(url: string, body?: unknown, options?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    return request<T>(url, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  patch<T>(url: string, body?: unknown, options?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    return request<T>(url, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  delete<T>(url: string, options?: Omit<RequestInit, 'method'>): Promise<T> {
    return request<T>(url, { ...options, method: 'DELETE' });
  },

  tokens: {
    get access() { return getToken(ACCESS_TOKEN_KEY); },
    get refresh() { return getToken(REFRESH_TOKEN_KEY); },
    set(accessToken: string, refreshToken: string) { setTokens(accessToken, refreshToken); },
    clear() { clearTokens(); },
  },
};
