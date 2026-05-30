import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import { historicalPrices, sentimentScores, backtestRuns, backtestTrades } from '../db/schema.js';

export interface BacktestRunInput {
  symbols: string[];
  startDate: string;
  endDate: string;
  initialCapital: number;
  buyThreshold: number;
  sellThreshold: number;
  stopLossPercent?: number | undefined;
  takeProfitPercent?: number | undefined;
  positionSizePercent?: number | undefined;
  commissionPerTrade?: number | undefined;
  slippageBps?: number | undefined;
  userId: string;
}

type BacktestStatus = 'running' | 'completed' | 'failed';

export interface BacktestTrade {
  symbol: string;
  side: 'buy' | 'sell';
  date: string;
  price: number;
  quantity: number;
  sentiment: number;
  value: number;
  reason?: 'signal' | 'stop_loss' | 'take_profit' | 'end_of_period' | undefined;
}

interface BacktestSummary {
  totalReturn: number;
  totalReturnPercent: number;
  maxDrawdownPercent: number;
  totalTrades: number;
  winRatePercent: number;
  finalEquity: number;
}

export interface BacktestRun {
  runId: string;
  status: BacktestStatus;
  input: BacktestRunInput;
  createdAt: string;
  completedAt?: string | undefined;
  summary?: BacktestSummary | undefined;
  trades?: BacktestTrade[] | undefined;
  equityCurve?: Array<{ date: string; equity: number }> | undefined;
  error?: string | undefined;
}

interface SymbolState {
  symbol: string;
  cash: number;
  quantity: number;
  lastPrice: number;
  entryPrice: number | null;
}

interface DailyPrice {
  open: number;
  high: number;
  low: number;
  close: number;
}

class BacktestEngine {
  async runBacktest(input: BacktestRunInput): Promise<BacktestRun> {
    const runId = `bt_${randomUUID()}`;
    const now = new Date();

    // Persist initial 'running' row
    await db.insert(backtestRuns).values({
      id: runId,
      userId: input.userId,
      symbols: input.symbols,
      startDate: input.startDate,
      endDate: input.endDate,
      initialCapital: input.initialCapital.toString(),
      buyThreshold: input.buyThreshold.toString(),
      sellThreshold: input.sellThreshold.toString(),
      stopLossPercent: input.stopLossPercent?.toString() ?? null,
      takeProfitPercent: input.takeProfitPercent?.toString() ?? null,
      status: 'running',
      createdAt: now,
    });

    try {
      const result = await this.execute(input);

      // Persist summary + equity curve, mark completed
      await db
        .update(backtestRuns)
        .set({
          status: 'completed',
          completedAt: new Date(),
          totalReturn: result.summary.totalReturn.toString(),
          totalReturnPercent: result.summary.totalReturnPercent.toString(),
          maxDrawdownPercent: result.summary.maxDrawdownPercent.toString(),
          totalTrades: result.summary.totalTrades,
          winRatePercent: result.summary.winRatePercent.toString(),
          finalEquity: result.summary.finalEquity.toString(),
          equityCurve: result.equityCurve,
        })
        .where(eq(backtestRuns.id, runId));

      // Persist individual trades (batch insert)
      if (result.trades.length > 0) {
        await db.insert(backtestTrades).values(
          result.trades.map((t) => ({
            runId,
            symbol: t.symbol,
            side: t.side,
            date: t.date,
            price: t.price.toString(),
            quantity: t.quantity.toString(),
            sentiment: t.sentiment.toString(),
            value: t.value.toString(),
            reason: t.reason ?? null,
          }))
        );
      }

      return {
        runId,
        status: 'completed',
        input,
        createdAt: now.toISOString(),
        completedAt: new Date().toISOString(),
        ...result,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Backtest failed';

      await db
        .update(backtestRuns)
        .set({
          status: 'failed',
          completedAt: new Date(),
          errorMessage: errMsg,
        })
        .where(eq(backtestRuns.id, runId));

      return {
        runId,
        status: 'failed',
        input,
        createdAt: now.toISOString(),
        completedAt: new Date().toISOString(),
        error: errMsg,
      };
    }
  }

  /** Fetch a run from DB (returns null if not found) */
  async getRun(runId: string): Promise<BacktestRun | null> {
    const [row] = await db
      .select()
      .from(backtestRuns)
      .where(eq(backtestRuns.id, runId))
      .limit(1);

    if (!row) return null;

    const trades = await db
      .select()
      .from(backtestTrades)
      .where(eq(backtestTrades.runId, runId));

    const input: BacktestRunInput = {
      symbols: row.symbols as string[],
      startDate: row.startDate,
      endDate: row.endDate,
      initialCapital: parseFloat(row.initialCapital),
      buyThreshold: parseFloat(row.buyThreshold),
      sellThreshold: parseFloat(row.sellThreshold),
      stopLossPercent: row.stopLossPercent ? parseFloat(row.stopLossPercent) : undefined,
      takeProfitPercent: row.takeProfitPercent ? parseFloat(row.takeProfitPercent) : undefined,
      positionSizePercent: undefined,
      commissionPerTrade: undefined,
      slippageBps: undefined,
      userId: row.userId,
    };

    const run: BacktestRun = {
      runId: row.id,
      status: row.status as BacktestStatus,
      input,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString(),
      error: row.errorMessage ?? undefined,
    };

    if (row.status === 'completed') {
      run.summary = {
        totalReturn: parseFloat(row.totalReturn ?? '0'),
        totalReturnPercent: parseFloat(row.totalReturnPercent ?? '0'),
        maxDrawdownPercent: parseFloat(row.maxDrawdownPercent ?? '0'),
        totalTrades: row.totalTrades ?? 0,
        winRatePercent: parseFloat(row.winRatePercent ?? '0'),
        finalEquity: parseFloat(row.finalEquity ?? '0'),
      };
      run.equityCurve = (row.equityCurve ?? []) as Array<{ date: string; equity: number }>;
      run.trades = trades.map((t) => ({
        symbol: t.symbol,
        side: t.side as 'buy' | 'sell',
        date: t.date,
        price: parseFloat(t.price),
        quantity: parseFloat(t.quantity),
        sentiment: parseFloat(t.sentiment),
        value: parseFloat(t.value),
        reason: (t.reason ?? undefined) as BacktestTrade['reason'],
      }));
    }

    return run;
  }

  /** List runs for a user */
  async listRuns(userId: string, limit = 20): Promise<BacktestRun[]> {
    const rows = await db
      .select()
      .from(backtestRuns)
      .where(eq(backtestRuns.userId, userId))
      .orderBy(backtestRuns.createdAt)
      .limit(limit);

    return rows.map((row) => ({
      runId: row.id,
      status: row.status as BacktestStatus,
      input: {
        userId: row.userId,
        symbols: row.symbols as string[],
        startDate: row.startDate,
        endDate: row.endDate,
        initialCapital: parseFloat(row.initialCapital),
        buyThreshold: parseFloat(row.buyThreshold),
        sellThreshold: parseFloat(row.sellThreshold),
        stopLossPercent: row.stopLossPercent ? parseFloat(row.stopLossPercent) : undefined,
        takeProfitPercent: row.takeProfitPercent ? parseFloat(row.takeProfitPercent) : undefined,
        positionSizePercent: undefined,
        commissionPerTrade: undefined,
        slippageBps: undefined,
      },
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString(),
      summary: row.status === 'completed' ? {
        totalReturn: parseFloat(row.totalReturn ?? '0'),
        totalReturnPercent: parseFloat(row.totalReturnPercent ?? '0'),
        maxDrawdownPercent: parseFloat(row.maxDrawdownPercent ?? '0'),
        totalTrades: row.totalTrades ?? 0,
        winRatePercent: parseFloat(row.winRatePercent ?? '0'),
        finalEquity: parseFloat(row.finalEquity ?? '0'),
      } : undefined,
      error: row.errorMessage ?? undefined,
    }));
  }

  private async execute(input: BacktestRunInput): Promise<{
    summary: BacktestSummary;
    trades: BacktestTrade[];
    equityCurve: Array<{ date: string; equity: number }>;
  }> {
    const start = new Date(`${input.startDate}T00:00:00.000Z`);
    const end = new Date(`${input.endDate}T23:59:59.999Z`);
    const symbols = [...new Set(input.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (symbols.length === 0) throw new Error('At least one symbol is required');

    const [pricesRaw, sentimentRaw] = await Promise.all([
      db
        .select()
        .from(historicalPrices)
        .where(
          and(
            inArray(historicalPrices.symbol, symbols),
            gte(historicalPrices.date, start),
            lte(historicalPrices.date, end)
          )
        ),
      db
        .select()
        .from(sentimentScores)
        .where(
          and(
            inArray(sentimentScores.symbol, symbols),
            gte(sentimentScores.date, start),
            lte(sentimentScores.date, end)
          )
        ),
    ]);

    const priceBySymbolDate = new Map<string, DailyPrice>();
    const dateSet = new Set<string>();
    for (const row of pricesRaw) {
      const date = row.date.toISOString().split('T')[0] || '';
      dateSet.add(date);
      priceBySymbolDate.set(`${row.symbol}_${date}`, {
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
      });
    }

    const sentimentBySymbolDate = new Map<string, number>();
    for (const row of sentimentRaw) {
      const date = row.date.toISOString().split('T')[0] || '';
      const score = row.weightedSentiment
        ? parseFloat(row.weightedSentiment)
        : row.averageSentiment
          ? parseFloat(row.averageSentiment)
          : 0;
      sentimentBySymbolDate.set(`${row.symbol}_${date}`, score);
    }

    const dates = [...dateSet].sort((a, b) => a.localeCompare(b));
    if (dates.length === 0) throw new Error('No historical price data found for requested period');

    const perSymbolCapital = input.initialCapital / symbols.length;
    const positionSizePercent = Math.min(Math.max(input.positionSizePercent ?? 25, 1), 100);
    const commissionPerTrade = Math.max(input.commissionPerTrade ?? 0, 0);
    const slippageRate = Math.max(input.slippageBps ?? 5, 0) / 10000;
    const state = new Map<string, SymbolState>();
    for (const symbol of symbols) {
      state.set(symbol, { symbol, cash: perSymbolCapital, quantity: 0, lastPrice: 0, entryPrice: null });
    }

    const trades: BacktestTrade[] = [];
    const closedTradeReturns: number[] = [];
    const equityCurve: Array<{ date: string; equity: number }> = [];

    const buyFill = (open: number) => open * (1 + slippageRate);
    const sellFill = (price: number) => price * (1 - slippageRate);

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]!;
      const nextDate = dates[i + 1];
      for (const symbol of symbols) {
        const s = state.get(symbol)!;
        const price = priceBySymbolDate.get(`${symbol}_${date}`);
        if (!price || price.close <= 0) continue;
        s.lastPrice = price.close;

        const sentiment = sentimentBySymbolDate.get(`${symbol}_${date}`) ?? 0;

        if (s.quantity > 0 && s.entryPrice && input.stopLossPercent && input.stopLossPercent > 0) {
          const stopPrice = s.entryPrice * (1 - input.stopLossPercent / 100);
          if (price.low <= stopPrice) {
            const fillPrice = sellFill(stopPrice);
            const value = Math.max(s.quantity * fillPrice - commissionPerTrade, 0);
            trades.push({ symbol, side: 'sell', date, price: fillPrice, quantity: s.quantity, sentiment, value, reason: 'stop_loss' });
            closedTradeReturns.push((fillPrice - s.entryPrice) / s.entryPrice);
            s.cash += value; s.quantity = 0; s.entryPrice = null;
            continue;
          }
        }

        if (s.quantity > 0 && s.entryPrice && input.takeProfitPercent && input.takeProfitPercent > 0) {
          const tpPrice = s.entryPrice * (1 + input.takeProfitPercent / 100);
          if (price.high >= tpPrice) {
            const fillPrice = sellFill(tpPrice);
            const value = Math.max(s.quantity * fillPrice - commissionPerTrade, 0);
            trades.push({ symbol, side: 'sell', date, price: fillPrice, quantity: s.quantity, sentiment, value, reason: 'take_profit' });
            closedTradeReturns.push((fillPrice - s.entryPrice) / s.entryPrice);
            s.cash += value; s.quantity = 0; s.entryPrice = null;
            continue;
          }
        }

        const nextPrice = nextDate ? priceBySymbolDate.get(`${symbol}_${nextDate}`) : undefined;
        if (!nextDate || !nextPrice) continue;

        if (s.quantity === 0 && sentiment >= input.buyThreshold && s.cash > commissionPerTrade) {
          const fillPrice = buyFill(nextPrice.open);
          const budget = s.cash * (positionSizePercent / 100);
          const quantity = Math.max((budget - commissionPerTrade) / fillPrice, 0);
          if (quantity <= 0) continue;
          const value = quantity * fillPrice;
          trades.push({ symbol, side: 'buy', date: nextDate, price: fillPrice, quantity, sentiment, value, reason: 'signal' });
          s.quantity = quantity; s.cash -= value + commissionPerTrade; s.entryPrice = fillPrice;
        } else if (s.quantity > 0 && sentiment <= input.sellThreshold) {
          const fillPrice = sellFill(nextPrice.open);
          const value = Math.max(s.quantity * fillPrice - commissionPerTrade, 0);
          trades.push({ symbol, side: 'sell', date: nextDate, price: fillPrice, quantity: s.quantity, sentiment, value, reason: 'signal' });
          if (s.entryPrice && s.entryPrice > 0) closedTradeReturns.push((fillPrice - s.entryPrice) / s.entryPrice);
          s.cash += value; s.quantity = 0; s.entryPrice = null;
        }
      }

      let equity = 0;
      for (const symbol of symbols) {
        const s = state.get(symbol)!;
        equity += s.cash + s.quantity * s.lastPrice;
      }
      equityCurve.push({ date, equity });
    }

    // Close all open positions at end of period
    for (const symbol of symbols) {
      const s = state.get(symbol)!;
      if (s.quantity > 0 && s.lastPrice > 0) {
        const fillPrice = sellFill(s.lastPrice);
        const value = Math.max(s.quantity * fillPrice - commissionPerTrade, 0);
        trades.push({
          symbol, side: 'sell',
          date: dates[dates.length - 1] || input.endDate,
          price: fillPrice, quantity: s.quantity,
          sentiment: sentimentBySymbolDate.get(`${symbol}_${dates[dates.length - 1]}`) ?? 0,
          value, reason: 'end_of_period',
        });
        if (s.entryPrice && s.entryPrice > 0) closedTradeReturns.push((fillPrice - s.entryPrice) / s.entryPrice);
        s.cash += value; s.quantity = 0;
      }
    }

    const finalEquity = [...state.values()].reduce((sum, s) => sum + s.cash + s.quantity * s.lastPrice, 0);
    const totalReturn = finalEquity - input.initialCapital;
    const totalReturnPercent = input.initialCapital > 0 ? (totalReturn / input.initialCapital) * 100 : 0;

    let peak = input.initialCapital;
    let maxDrawdown = 0;
    for (const point of equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const drawdown = peak > 0 ? (peak - point.equity) / peak : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    const winning = closedTradeReturns.filter((r) => r > 0).length;
    const winRatePercent = closedTradeReturns.length > 0 ? (winning / closedTradeReturns.length) * 100 : 0;

    return {
      summary: { totalReturn, totalReturnPercent, maxDrawdownPercent: maxDrawdown * 100, totalTrades: trades.length, winRatePercent, finalEquity },
      trades,
      equityCurve,
    };
  }
}

export const backtestEngine = new BacktestEngine();
