import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { automationRules } from '../db/schema.js';
import type { Bar } from './alpacaApi.js';
import { getAlpacaClientForUser } from './credentialResolver.js';
import { getApiKeysOwnerUserId } from '../constants/integration.js';
import { tradingService } from './tradingService.js';
import { backtestEngine } from './backtestEngine.js';

const SYMBOL_BAR_CHUNK = Math.min(100, Math.max(10, parseInt(process.env.AUTOMATION_SYMBOL_BAR_CHUNK ?? '50', 10) || 50));

export type AutomationCondition = 'above' | 'below';
export type AutomationAction = 'buy' | 'sell';

export interface AutomationRuleInput {
  name?: string;
  symbol: string;
  condition: AutomationCondition;
  triggerPrice: number;
  action: AutomationAction;
  quantity: number;
  timeInForce?: 'day' | 'gtc' | 'ioc' | 'fok';
  enabled?: boolean;
}

export interface AutomationEvaluationResult {
  checked: number;
  triggered: number;
  orders: Array<{ ruleId: number; symbol: string; orderId?: string; status?: string }>;
  errors: Array<{ ruleId: number; symbol: string; error: string }>;
}

type NormalizedAutomationRuleInput = Omit<AutomationRuleInput, 'name' | 'timeInForce' | 'enabled'> & {
  name: string;
  timeInForce: 'day' | 'gtc' | 'ioc' | 'fok';
  enabled: boolean;
};

class AutomationService {
  private normalizeInput(input: AutomationRuleInput): NormalizedAutomationRuleInput {
    const symbol = input.symbol?.trim().toUpperCase();
    const triggerPrice = Number(input.triggerPrice);
    const quantity = Number(input.quantity);

    if (!symbol) throw new Error('Symbol is required');
    if (input.condition !== 'above' && input.condition !== 'below') throw new Error('Invalid condition');
    if (input.action !== 'buy' && input.action !== 'sell') throw new Error('Invalid action');
    if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) throw new Error('Trigger price must be greater than 0');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be greater than 0');

    return {
      ...input,
      name: input.name?.trim() || `${symbol} ${input.condition} ${triggerPrice}`,
      symbol,
      triggerPrice,
      quantity,
      timeInForce: input.timeInForce ?? 'day',
      enabled: input.enabled ?? true,
    };
  }

  async listRules(userId: string) {
    return db
      .select()
      .from(automationRules)
      .where(eq(automationRules.userId, userId))
      .orderBy(desc(automationRules.createdAt));
  }

  async createRule(userId: string, input: AutomationRuleInput) {
    const rule = this.normalizeInput(input);
    const inserted = await db.insert(automationRules).values({
      userId,
      name: rule.name,
      symbol: rule.symbol,
      condition: rule.condition,
      triggerPrice: rule.triggerPrice.toString(),
      action: rule.action,
      quantity: rule.quantity.toString(),
      timeInForce: rule.timeInForce,
      enabled: rule.enabled,
    }).returning();

    return inserted[0];
  }

  async updateRule(userId: string, id: number, input: Partial<AutomationRuleInput>) {
    const existing = await this.getRule(userId, id);
    if (!existing) return null;

    const merged = this.normalizeInput({
      name: input.name ?? existing.name,
      symbol: input.symbol ?? existing.symbol,
      condition: (input.condition ?? existing.condition) as AutomationCondition,
      triggerPrice: input.triggerPrice ?? Number(existing.triggerPrice),
      action: (input.action ?? existing.action) as AutomationAction,
      quantity: input.quantity ?? Number(existing.quantity),
      timeInForce: (input.timeInForce ?? existing.timeInForce) as 'day' | 'gtc' | 'ioc' | 'fok',
      enabled: input.enabled ?? existing.enabled,
    });

    const updated = await db
      .update(automationRules)
      .set({
        name: merged.name,
        symbol: merged.symbol,
        condition: merged.condition,
        triggerPrice: merged.triggerPrice.toString(),
        action: merged.action,
        quantity: merged.quantity.toString(),
        timeInForce: merged.timeInForce,
        enabled: merged.enabled,
        updatedAt: new Date(),
      })
      .where(and(eq(automationRules.id, id), eq(automationRules.userId, userId)))
      .returning();

    return updated[0] ?? null;
  }

  async deleteRule(userId: string, id: number) {
    const deleted = await db
      .delete(automationRules)
      .where(and(eq(automationRules.id, id), eq(automationRules.userId, userId)))
      .returning({ id: automationRules.id });

    return deleted.length > 0;
  }

  /**
   * Create a disabled automation rule seeded from a completed backtest run
   * (first symbol), using the last BUY fill when present, otherwise latest Alpaca bar.
   */
  async createRuleFromBacktest(userId: string, runId: string) {
    const run = await backtestEngine.getRun(runId);
    if (!run || run.input.userId !== userId) {
      throw new Error('Backtest run not found');
    }
    if (run.status !== 'completed') {
      throw new Error('Only completed backtest runs can be turned into automation rules');
    }

    const symbols = run.input.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (symbols.length === 0) {
      throw new Error('Backtest run has no symbols');
    }

    const primary = symbols[0]!;
    const trades = run.trades ?? [];
    const chronological = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    const lastBuyPrimary = [...chronological].reverse().find((t) => t.symbol === primary && t.side === 'buy');

    let triggerPrice: number;
    let quantity: number;

    if (lastBuyPrimary) {
      triggerPrice = Math.round(lastBuyPrimary.price * 101) / 100;
      quantity = Math.max(1, Math.round(lastBuyPrimary.quantity));
    } else {
      const bars = await this.fetchBarsBySymbols([primary]);
      const close = bars[primary]?.c != null ? Number(bars[primary].c) : NaN;
      if (!Number.isFinite(close)) {
        throw new Error('Unable to fetch a live quote to seed trigger price — check Alpaca market data credentials');
      }
      triggerPrice = Math.round(close * 101) / 100;
      quantity = 1;
    }

    return this.createRule(userId, {
      name: `${primary} · from backtest`,
      symbol: primary,
      condition: 'above',
      triggerPrice,
      action: 'buy',
      quantity,
      timeInForce: 'day',
      enabled: false,
    });
  }

  async evaluateUserRules(userId: string): Promise<AutomationEvaluationResult> {
    const rules = await db
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.userId, userId), eq(automationRules.enabled, true)));

    return this.evaluateRules(rules);
  }

  async evaluateAllEnabledRules(): Promise<AutomationEvaluationResult> {
    const rules = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.enabled, true));

    return this.evaluateRules(rules);
  }

  private async getRule(userId: string, id: number) {
    const rows = await db
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.id, id), eq(automationRules.userId, userId)))
      .limit(1);

    return rows[0] ?? null;
  }

  private async fetchBarsBySymbols(symbols: string[]): Promise<Record<string, Bar>> {
    const alpaca = await getAlpacaClientForUser(getApiKeysOwnerUserId());
    if (!alpaca) return {};

    const uniq = [...new Set(symbols)].filter(Boolean);
    const merged: Record<string, Bar> = {};
    for (let i = 0; i < uniq.length; i += SYMBOL_BAR_CHUNK) {
      const slice = uniq.slice(i, i + SYMBOL_BAR_CHUNK);
      const partial = await alpaca.getLatestBars(slice);
      Object.assign(merged, partial);
    }
    return merged;
  }

  private async evaluateRules(rules: Array<typeof automationRules.$inferSelect>): Promise<AutomationEvaluationResult> {
    const result: AutomationEvaluationResult = { checked: rules.length, triggered: 0, orders: [], errors: [] };
    if (rules.length === 0) return result;

    const symbols = [...new Set(rules.map(rule => rule.symbol))];
    const bars = await this.fetchBarsBySymbols(symbols);
    const now = new Date();

    for (const rule of rules) {
      try {
        const bar = bars[rule.symbol];
        const currentPrice = bar?.c ? Number(bar.c) : NaN;
        if (!Number.isFinite(currentPrice)) continue;

        await db
          .update(automationRules)
          .set({ lastCheckedAt: now })
          .where(eq(automationRules.id, rule.id));

        const triggerPrice = Number(rule.triggerPrice);
        const shouldTrigger =
          (rule.condition === 'above' && currentPrice >= triggerPrice) ||
          (rule.condition === 'below' && currentPrice <= triggerPrice);

        if (!shouldTrigger) continue;

        const order = await tradingService.placeOrder(rule.userId, {
          symbol: rule.symbol,
          side: rule.action as AutomationAction,
          type: 'market',
          time_in_force: rule.timeInForce as 'day' | 'gtc' | 'ioc' | 'fok',
          qty: String(rule.quantity),
        });

        await db
          .update(automationRules)
          .set({ enabled: false, lastTriggeredAt: now, updatedAt: now })
          .where(eq(automationRules.id, rule.id));

        result.triggered++;
        result.orders.push({ ruleId: rule.id, symbol: rule.symbol, orderId: order.id, status: order.status });
      } catch (error) {
        result.errors.push({
          ruleId: rule.id,
          symbol: rule.symbol,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }
}

export const automationService = new AutomationService();
