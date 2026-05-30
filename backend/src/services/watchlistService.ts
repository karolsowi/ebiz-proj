import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { watchlist } from '../db/schema.js';

export interface CreateWatchlistEntry {
  symbol: string;
  name?: string;
  notes?: string;
  alertPrice?: string;
  alertEnabled?: boolean;
}

export interface UpdateWatchlistEntry {
  name?: string;
  notes?: string;
  alertPrice?: string | null;
  alertEnabled?: boolean;
}

export class WatchlistService {
  async getWatchlist(userId: string) {
    return db
      .select()
      .from(watchlist)
      .where(eq(watchlist.userId, userId))
      .orderBy(desc(watchlist.addedAt));
  }

  async getById(userId: string, id: number) {
    const rows = await db
      .select()
      .from(watchlist)
      .where(and(eq(watchlist.userId, userId), eq(watchlist.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async addEntry(userId: string, data: CreateWatchlistEntry) {
    const result = await db
      .insert(watchlist)
      .values({
        userId,
        symbol: data.symbol,
        name: data.name ?? null,
        notes: data.notes ?? null,
        alertPrice: data.alertPrice ?? null,
        alertEnabled: data.alertEnabled ?? false,
      })
      .onConflictDoUpdate({
        target: [watchlist.userId, watchlist.symbol],
        set: {
          name: data.name ?? null,
          notes: data.notes ?? null,
          alertPrice: data.alertPrice ?? null,
          alertEnabled: data.alertEnabled ?? false,
        },
      })
      .returning();
    return result[0];
  }

  async updateById(userId: string, id: number, updates: UpdateWatchlistEntry) {
    const existing = await this.getById(userId, id);
    if (!existing) {
      return null;
    }

    const result = await db
      .update(watchlist)
      .set({
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
        ...(updates.alertPrice !== undefined ? { alertPrice: updates.alertPrice } : {}),
        ...(updates.alertEnabled !== undefined ? { alertEnabled: updates.alertEnabled } : {}),
      })
      .where(and(eq(watchlist.userId, userId), eq(watchlist.id, id)))
      .returning();
    return result[0] ?? null;
  }

  async deleteById(userId: string, id: number) {
    const result = await db
      .delete(watchlist)
      .where(and(eq(watchlist.userId, userId), eq(watchlist.id, id)))
      .returning();
    return result[0] ?? null;
  }
}

export const watchlistService = new WatchlistService();
