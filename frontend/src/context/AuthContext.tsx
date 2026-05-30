import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authService } from '../services/authService';
import { userApiService } from '../services/userApiService';
import { AuthUser } from '../types/auth';
import { syncThemeFromUserSettings } from '../utils/themePreference';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(async () => {
    const refreshToken = authService.getRefreshToken();
    await authService.logout(refreshToken);
    authService.clearTokens();
    setUser(null);
  }, []);

  // React to session-expired events emitted by apiClient
  useEffect(() => {
    const handler = () => {
      authService.clearTokens();
      setUser(null);
    };
    window.addEventListener('auth:logout', handler);
    return () => window.removeEventListener('auth:logout', handler);
  }, []);

  const applyUserTheme = useCallback(async () => {
    try {
      const { theme } = await userApiService.getSettings();
      syncThemeFromUserSettings(theme);
    } catch {
      /* keep local theme */
    }
  }, []);

  const login = useCallback(async (email: string, password: string, rememberMe = false) => {
    const result = await authService.login({ email, password, rememberMe });
    authService.setTokens(result.accessToken, result.refreshToken);
    setUser(result.user);
    await applyUserTheme();
  }, [applyUserTheme]);

  const register = useCallback(async (input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) => {
    const result = await authService.register(input);
    authService.setTokens(result.accessToken, result.refreshToken);
    setUser(result.user);
    await applyUserTheme();
  }, [applyUserTheme]);

  // Restore session on mount
  useEffect(() => {
    const initializeSession = async () => {
      try {
        const accessToken = authService.getAccessToken();
        const refreshToken = authService.getRefreshToken();

        if (!accessToken && !refreshToken) {
          return;
        }

        if (accessToken) {
          try {
            const currentUser = await authService.getCurrentUser();
            setUser(currentUser);
            await applyUserTheme();
            return;
          } catch {
            // Fall through to refresh flow
          }
        }

        if (!refreshToken) return;

        const refreshed = await authService.refresh(refreshToken);
        authService.setTokens(refreshed.accessToken, refreshed.refreshToken);
        const currentUser = await authService.getCurrentUser();
        setUser(currentUser);
        await applyUserTheme();
      } catch {
        authService.clearTokens();
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    void initializeSession();
  }, [applyUserTheme]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
    }),
    [isLoading, login, logout, register, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
