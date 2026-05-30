import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '../db/connection';
import { users, userSettings, userApiKeys } from '../db/schema';
import { emailService } from './emailService';
import { encryptionService } from './encryptionService.js';

function maskSecret(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const tail = value.slice(-4);
  return `••••••••${tail}`;
}

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

export interface APIKeyData {
  id: string;
  name: string;
  service: string;
  isActive: boolean;
  lastUsedAt?: string | undefined;
  createdAt: string;
  expiresAt?: string | undefined;
  userId: string;
  apiKeyPreview?: string | undefined;
  secretConfigured?: boolean | undefined;
  paperTrading?: boolean | undefined;
}

class UserService {
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return null;

    const settings = await this.getUserSettings(userId);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      timezone: settings.timezone,
      language: settings.language,
      emailVerified: user.emailVerified,
      dateJoined: user.createdAt.toISOString(),
    };
  }

  async updateUserProfile(userId: string, data: Partial<{
    firstName: string;
    lastName: string;
    timezone: string;
    language: string;
  }>): Promise<UserProfile | null> {
    const userFields: Record<string, any> = {};
    const settingsFields: Record<string, any> = {};

    if (data.firstName !== undefined) userFields.firstName = data.firstName;
    if (data.lastName !== undefined) userFields.lastName = data.lastName;
    if (data.timezone !== undefined) settingsFields.timezone = data.timezone;
    if (data.language !== undefined) settingsFields.language = data.language;

    if (Object.keys(userFields).length > 0) {
      userFields.updatedAt = new Date();
      await db.update(users).set(userFields).where(eq(users.id, userId));
    }

    if (Object.keys(settingsFields).length > 0) {
      settingsFields.updatedAt = new Date();
      await db
        .insert(userSettings)
        .values({ userId, ...settingsFields })
        .onConflictDoUpdate({
          target: [userSettings.userId],
          set: settingsFields,
        });
    }

    return this.getUserProfile(userId);
  }

  async getUserSettings(userId: string): Promise<UserSettings> {
    const [row] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    if (row) {
      return {
        theme: row.theme,
        language: row.language,
        timezone: row.timezone,
        currency: row.currency,
        dateFormat: row.dateFormat,
        defaultChartType: row.defaultChartType,
        refreshInterval: row.refreshInterval,
        emailNotifications: row.emailNotifications,
        tradingAlerts: row.tradingAlerts,
        paperTradingMode: row.paperTradingMode,
        confirmOrders: row.confirmOrders,
        riskWarnings: row.riskWarnings,
      };
    }

    // Return defaults if not yet created
    return {
      theme: 'system',
      language: 'en',
      timezone: 'UTC',
      currency: 'USD',
      dateFormat: 'MM/DD/YYYY',
      defaultChartType: 'candlestick',
      refreshInterval: 30,
      emailNotifications: true,
      tradingAlerts: true,
      paperTradingMode: true,
      confirmOrders: true,
      riskWarnings: true,
    };
  }

  async updateUserSettings(userId: string, data: Partial<UserSettings>): Promise<UserSettings> {
    const settingsFields: Record<string, any> = { ...data, updatedAt: new Date() };

    await db
      .insert(userSettings)
      .values({ userId, ...data })
      .onConflictDoUpdate({
        target: [userSettings.userId],
        set: settingsFields,
      });

    return this.getUserSettings(userId);
  }

  async getUserAPIKeys(userId: string): Promise<APIKeyData[]> {
    const rows = await db
      .select()
      .from(userApiKeys)
      .where(eq(userApiKeys.userId, userId));

    return rows.map((row) => {
      let apiKeyPreview: string | undefined;
      if (row.apiKeyEncrypted) {
        try {
          apiKeyPreview = maskSecret(encryptionService.decrypt(row.apiKeyEncrypted));
        } catch {
          apiKeyPreview = '••••••••';
        }
      }
      return {
        id: String(row.id),
        name: row.name,
        service: row.service,
        isActive: row.isActive,
        lastUsedAt: row.lastUsedAt?.toISOString(),
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt?.toISOString(),
        userId: row.userId,
        apiKeyPreview,
        secretConfigured: Boolean(row.secretKeyEncrypted),
        paperTrading: row.paperTrading,
      };
    });
  }

  async addAPIKey(
    userId: string,
    data: { name: string; service: string; apiKey?: string; secretKey?: string; paperTrading?: boolean }
  ): Promise<APIKeyData> {
    const [row] = await db
      .insert(userApiKeys)
      .values({
        userId,
        name: data.name,
        service: data.service,
        isActive: true,
        apiKeyEncrypted: data.apiKey ? encryptionService.encrypt(data.apiKey) : null,
        secretKeyEncrypted: data.secretKey ? encryptionService.encrypt(data.secretKey) : null,
        paperTrading: data.paperTrading ?? true,
      })
      .returning();

    return {
      id: String(row!.id),
      name: row!.name,
      service: row!.service,
      isActive: row!.isActive,
      createdAt: row!.createdAt.toISOString(),
      userId: row!.userId,
      apiKeyPreview: data.apiKey ? maskSecret(data.apiKey) : undefined,
      secretConfigured: Boolean(data.secretKey),
      paperTrading: row!.paperTrading,
    };
  }

  async updateAPIKey(
    userId: string,
    keyId: string,
    data: Partial<{
      name: string;
      isActive: boolean;
      apiKey?: string;
      secretKey?: string;
      paperTrading?: boolean;
    }>
  ): Promise<APIKeyData | null> {
    const updateFields: Record<string, unknown> = {};
    if (data.name !== undefined) updateFields.name = data.name;
    if (data.isActive !== undefined) updateFields.isActive = data.isActive;
    if (data.paperTrading !== undefined) updateFields.paperTrading = data.paperTrading;
    if (data.apiKey) updateFields.apiKeyEncrypted = encryptionService.encrypt(data.apiKey);
    if (data.secretKey) updateFields.secretKeyEncrypted = encryptionService.encrypt(data.secretKey);

    const [row] = await db
      .update(userApiKeys)
      .set(updateFields)
      .where(and(eq(userApiKeys.id, Number(keyId)), eq(userApiKeys.userId, userId)))
      .returning();

    if (!row) return null;

    const keys = await this.getUserAPIKeys(userId);
    return keys.find((k) => k.id === keyId) ?? null;
  }

  async deleteAPIKey(userId: string, keyId: string): Promise<boolean> {
    const result = await db
      .delete(userApiKeys)
      .where(and(eq(userApiKeys.id, Number(keyId)), eq(userApiKeys.userId, userId)))
      .returning();

    return result.length > 0;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new Error('User not found');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw Object.assign(new Error('Current password is incorrect'), { status: 400 });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));

    return { success: true, message: 'Password changed successfully' };
  }

  async getSecuritySettings(userId: string) {
    // Returns a minimal security info object; 2FA not yet implemented
    const [user] = await db
      .select({ emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return {
      twoFactorEnabled: false,
      emailVerified: user?.emailVerified ?? false,
      backupCodes: [],
      trustedDevices: [],
      loginHistory: [],
    };
  }

  async enable2FA(_userId: string) {
    return { success: false, message: '2FA is not yet implemented' };
  }

  async disable2FA(_userId: string, _password: string) {
    return { success: false, message: '2FA is not yet implemented' };
  }

  async sendVerificationEmail(email: string, firstName: string, lastName: string) {
    try {
      await emailService.sendWelcomeEmail({ email, firstName, lastName });
      return { success: true, message: 'Verification email sent' };
    } catch {
      return { success: false, message: 'Failed to send email' };
    }
  }

  async verifyEmail(_email: string, _verificationCode: string) {
    return { success: false, message: 'Email verification via code not yet implemented' };
  }

  async createAccount(data: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    emailVerified?: boolean;
  }) {
    // Delegate to authService register
    const { authService } = await import('./authService.js');
    return authService.register({
      email: data.email,
      password: data.password,
      firstName: data.firstName,
      lastName: data.lastName,
    });
  }

  async sendEmailChangeVerification(
    _oldEmail: string,
    _newEmail: string,
    _firstName: string,
    _lastName: string
  ) {
    return { success: false, message: 'Email change verification not yet implemented' };
  }

  async verifyEmailChange(_oldEmail: string, _newEmail: string, _verificationCode: string) {
    return { success: false, message: 'Email change verification not yet implemented' };
  }
}

export const userService = new UserService();
