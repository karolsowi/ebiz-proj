import { portfolioEntries } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db/connection';
import { marketDataService } from './marketDataService.js';

export interface CreatePortfolioEntry {
    symbol: string;
    name?: string;
    quantity: string;
    averageCost: string;
    currentPrice?: string;
    assetType: string;
    source?: string;
    notes?: string;
    sector?: string;
    industry?: string;
}

export interface UpdatePortfolioEntry {
    quantity?: string;
    averageCost?: string;
    currentPrice?: string;
    notes?: string;
}

export class PortfolioService {

    // Get all portfolio entries
    async getPortfolioEntries(userId: string) {
        try {
            return await db
                .select()
                .from(portfolioEntries)
                .where(eq(portfolioEntries.userId, userId))
                .orderBy(desc(portfolioEntries.updatedAt));
        } catch (error) {
            console.error('Error fetching portfolio entries:', error);
            throw error;
        }
    }

    // Add a new portfolio entry
    async addPortfolioEntry(entry: CreatePortfolioEntry, userId: string) {
        try {
            // Calculate total value if current price is provided
            let totalValue: string | null = null;
            let gainLoss: string | null = null;
            let gainLossPercent: string | null = null;

            if (entry.currentPrice && entry.quantity) {
                const qty = parseFloat(entry.quantity);
                const price = parseFloat(entry.currentPrice);
                const cost = parseFloat(entry.averageCost);

                totalValue = (qty * price).toString();
                gainLoss = ((price - cost) * qty).toString();
                gainLossPercent = cost > 0 ? (((price - cost) / cost) * 100).toString() : '0';
            }

            const result = await db.insert(portfolioEntries).values({
                userId,
                symbol: entry.symbol,
                name: entry.name || null,
                quantity: entry.quantity,
                averageCost: entry.averageCost,
                currentPrice: entry.currentPrice || null,
                totalValue: totalValue,
                gainLoss: gainLoss,
                gainLossPercent: gainLossPercent,
                assetType: entry.assetType,
                source: entry.source || 'manual',
                notes: entry.notes || null,
                sector: entry.sector || null,
                industry: entry.industry || null,
            }).returning();

            return result[0];
        } catch (error) {
            console.error('Error adding portfolio entry:', error);
            throw error;
        }
    }

    // Update a portfolio entry (userId enforces ownership)
    async updatePortfolioEntry(id: number, update: UpdatePortfolioEntry, userId: string) {
        try {
            const condition = and(eq(portfolioEntries.id, id), eq(portfolioEntries.userId, userId));

            // Get existing entry first to recalculate values
            const existing = await db
                .select()
                .from(portfolioEntries)
                .where(condition)
                .limit(1);

            if (existing.length === 0) {
                throw new Error(`Portfolio entry with ID ${id} not found`);
            }

            const entry = existing[0];
            if (!entry) {
                throw new Error(`Portfolio entry with ID ${id} not found`);
            }

            const qty = update.quantity ? parseFloat(update.quantity) : parseFloat(entry.quantity);
            const cost = update.averageCost ? parseFloat(update.averageCost) : parseFloat(entry.averageCost);
            const currentPriceStr = update.currentPrice !== undefined ? update.currentPrice : entry.currentPrice;
            const price = currentPriceStr ? parseFloat(currentPriceStr) : null;

            let totalValue = entry.totalValue;
            let gainLoss = entry.gainLoss;
            let gainLossPercent = entry.gainLossPercent;

            if (price !== null) {
                totalValue = (qty * price).toString();
                gainLoss = ((price - cost) * qty).toString();
                gainLossPercent = cost > 0 ? (((price - cost) / cost) * 100).toString() : '0';
            }

            const result = await db
                .update(portfolioEntries)
                .set({
                    ...(update.quantity !== undefined ? { quantity: update.quantity } : {}),
                    ...(update.averageCost !== undefined ? { averageCost: update.averageCost } : {}),
                    ...(update.currentPrice !== undefined ? { currentPrice: update.currentPrice } : {}),
                    ...(update.notes !== undefined ? { notes: update.notes } : {}),
                    totalValue: totalValue,
                    gainLoss: gainLoss,
                    gainLossPercent: gainLossPercent,
                    updatedAt: new Date(),
                })
                .where(condition)
                .returning();

            return result[0];
        } catch (error) {
            console.error('Error updating portfolio entry:', error);
            throw error;
        }
    }

    // Delete a portfolio entry (userId enforces ownership)
    async deletePortfolioEntry(id: number, userId: string) {
        try {
            const condition = and(eq(portfolioEntries.id, id), eq(portfolioEntries.userId, userId));

            const result = await db
                .delete(portfolioEntries)
                .where(condition)
                .returning();

            if (result.length === 0) {
                throw new Error(`Portfolio entry with ID ${id} not found`);
            }

            return { message: 'Entry deleted successfully', id };
        } catch (error) {
            console.error('Error deleting portfolio entry:', error);
            throw error;
        }
    }

    // Get portfolio summary
    async getPortfolioSummary(userId: string) {
        try {
            const entries = await this.getPortfolioEntries(userId);

            let totalValue = 0;
            let totalCost = 0;
            let totalGainLoss = 0;

            for (const entry of entries) {
                if (entry.totalValue) totalValue += parseFloat(entry.totalValue);
                if (entry.quantity && entry.averageCost) {
                    totalCost += parseFloat(entry.quantity) * parseFloat(entry.averageCost);
                }
            }

            totalGainLoss = totalValue - totalCost;
            const totalGainLossPercent = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;

            return {
                totalValue: totalValue.toFixed(2),
                totalCost: totalCost.toFixed(2),
                totalGainLoss: totalGainLoss.toFixed(2),
                totalGainLossPercent: totalGainLossPercent.toFixed(2),
                entryCount: entries.length,
            };
        } catch (error) {
            console.error('Error calculating portfolio summary:', error);
            throw error;
        }
    }

    // Refresh current prices for all portfolio entries
    async refreshPortfolioPrices(userId: string) {
        try {
            const entries = await this.getPortfolioEntries(userId);

            const updatedEntries: unknown[] = [];
            const failedSymbols: Array<{ symbol: string; reason: string }> = [];

            for (const entry of entries) {
                try {
                    const quote = await marketDataService.getQuote(entry.symbol, false, userId);
                    const updated = await this.updatePortfolioEntry(entry.id, {
                        currentPrice: quote.price.toString(),
                    }, userId);
                    updatedEntries.push(updated);
                } catch (error) {
                    failedSymbols.push({
                        symbol: entry.symbol,
                        reason: error instanceof Error ? error.message : 'Unknown error',
                    });
                }
            }

            const summary = await this.getPortfolioSummary(userId);

            return {
                updatedCount: updatedEntries.length,
                failedCount: failedSymbols.length,
                failedSymbols,
                summary,
                refreshedAt: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error refreshing portfolio prices:', error);
            throw error;
        }
    }
}

export const portfolioService = new PortfolioService();
