import { eq, and, lt, isNull } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { db } from '../db/connection';
import { users, refreshTokens, userSettings } from '../db/schema';
import type { RegisterRequest, LoginRequest, AuthResponse, JwtPayload } from '../types/auth';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required. Set it in your .env file.');
}

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REMEMBER_ME_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET as string, { expiresIn: ACCESS_TOKEN_TTL });
}

async function issueRefreshToken(
  userId: string,
  meta?: { userAgent?: string; ipAddress?: string },
  ttlMs = REFRESH_TOKEN_TTL_MS
): Promise<string> {
  const token = randomUUID() + '-' + randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs);

  // Purge expired tokens for this user to keep the table lean
  await db
    .delete(refreshTokens)
    .where(
      and(
        eq(refreshTokens.userId, userId),
        lt(refreshTokens.expiresAt, new Date())
      )
    );

  await db.insert(refreshTokens).values({
    token,
    userId,
    expiresAt,
    userAgent: meta?.userAgent ?? null,
    ipAddress: meta?.ipAddress ?? null,
  });

  return token;
}

export const authService = {
  async register(
    data: RegisterRequest,
    meta?: { userAgent?: string; ipAddress?: string }
  ): Promise<AuthResponse> {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, data.email.toLowerCase().trim()))
      .limit(1);

    if (existing.length > 0) {
      throw Object.assign(new Error('Email already registered'), { status: 409 });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const id = randomUUID();

    const [user] = await db
      .insert(users)
      .values({
        id,
        email: data.email.toLowerCase().trim(),
        firstName: data.firstName,
        lastName: data.lastName,
        passwordHash,
        role: 'user',
      })
      .returning();

    // Create default settings row for new user
    await db.insert(userSettings).values({ userId: id }).onConflictDoNothing();

    const payload: JwtPayload = { userId: user!.id, email: user!.email, role: user!.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = await issueRefreshToken(id, meta);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user!.id,
        email: user!.email,
        firstName: user!.firstName,
        lastName: user!.lastName,
        role: user!.role,
      },
    };
  },

  async login(
    data: LoginRequest,
    meta?: { userAgent?: string; ipAddress?: string }
  ): Promise<AuthResponse> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, data.email.toLowerCase().trim()))
      .limit(1);

    if (!user) {
      throw Object.assign(new Error('Invalid credentials'), { status: 401 });
    }

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) {
      throw Object.assign(new Error('Invalid credentials'), { status: 401 });
    }

    const payload: JwtPayload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = await issueRefreshToken(
      user.id,
      meta,
      data.rememberMe ? REMEMBER_ME_REFRESH_TOKEN_TTL_MS : REFRESH_TOKEN_TTL_MS
    );

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
    };
  },

  async refresh(
    token: string,
    meta?: { userAgent?: string; ipAddress?: string }
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const [storedToken] = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.token, token),
          isNull(refreshTokens.revokedAt)
        )
      )
      .limit(1);

    if (!storedToken || storedToken.expiresAt < new Date()) {
      throw Object.assign(new Error('Invalid or expired refresh token'), { status: 401 });
    }

    // Revoke old token (token rotation)
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, storedToken.id));

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, storedToken.userId))
      .limit(1);

    if (!user) {
      throw Object.assign(new Error('User not found'), { status: 401 });
    }

    const payload: JwtPayload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = await issueRefreshToken(user.id, meta);

    return { accessToken, refreshToken };
  },

  async logout(token: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.token, token));
  },

  async logoutAll(userId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt)
        )
      );
  },

  async getUser(userId: string) {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user ?? null;
  },

  verifyAccessToken(token: string): JwtPayload {
    return jwt.verify(token, JWT_SECRET as string) as JwtPayload;
  },
};
