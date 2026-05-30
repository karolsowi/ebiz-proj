export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'user' | 'admin';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
