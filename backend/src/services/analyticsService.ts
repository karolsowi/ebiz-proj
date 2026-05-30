import { db } from '../db/connection.js';
import {
  tradingSessions,
  positions,
  portfolioEntries,
  tradingAccounts,
  predictions,
  historicalPrices,
} from '../db/schema.js';
import { eq, desc, asc, and, isNull, isNotNull, gte } from 'drizzle-orm';

// ── Math helpers ──────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[], ddof = 1): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - ddof);
  return Math.sqrt(variance);
}

function sharpeRatio(returns: number[], annualisedRiskFreeRate = 0.05): number {
  if (returns.length < 2) return 0;
  const daily = annualisedRiskFreeRate / 252;
  const excess = returns.map((r) => r - daily);
  const m = mean(excess);
  const s = stddev(excess);
  if (s === 0) return 0;
  return (m / s) * Math.sqrt(252);
}

function sortinoRatio(returns: number[], annualisedRiskFreeRate = 0.05): number {
  if (returns.length < 2) return 0;
  const daily = annualisedRiskFreeRate / 252;
  const excess = returns.map((r) => r - daily);
  const m = mean(excess);
  const downsideReturns = returns.filter((r) => r < daily);
  if (downsideReturns.length === 0) return m > 0 ? 10 : 0;
  const downstd = stddev(downsideReturns, 1);
  if (downstd === 0) return 0;
  return (m / downstd) * Math.sqrt(252);
}

function maxDrawdown(equityValues: number[]): number {
  if (equityValues.length < 2) return 0;
  let peak = equityValues[0]!;
  let maxDD = 0;
  for (const v of equityValues) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function historicalVaR(returns: number[], confidence = 0.95): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor((1 - confidence) * sorted.length);
  return -(sorted[Math.max(0, idx - 1)] ?? sorted[0]!);
}

function calmarRatio(annualisedReturn: number, maxDD: number): number {
  if (maxDD === 0) return annualisedReturn >= 0 ? 10 : 0;
  return annualisedReturn / maxDD;
}

// ── Service ──────────────────────────────────────────────────────────────────

export interface RiskMetrics {
  dataPoints: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  historicalVaR95: number;
  historicalVaR99: number;
  annualisedVolatility: number;
  annualisedReturn: number;
  positionConcentrations: { symbol: string; marketValue: number; percent: number }[];
  topPositionPercent: number;
  sectorConcentrations: { sector: string; value: number; percent: number }[];
  totalPositionsValue: number;
  sessionCount: number;
}

export interface EquityCurvePoint {
  date: string;
  balance: number;
  dailyPL: number;
  realizedPL: number;
  unrealizedPL: number;
  tradesCount: number;
}

export interface PerformanceData {
  curve: EquityCurvePoint[];
  summary: {
    startBalance: number;
    endBalance: number;
    cumulativeReturn: number;
    bestDay: number;
    worstDay: number;
    winDays: number;
    totalDays: number;
    winRate: number;
    totalRealizedPL: number;
    avgDailyPL: number;
  };
}

export interface PredictionRow {
  id: number;
  userId: string;
  symbol: string;
  predictedDirection: string;
  predictedReturnPercent: string | null;
  horizonDays: number;
  actualReturnPercent: string | null;
  actualDirection: string | null;
  evaluatedAt: Date | null;
  modelVersion: string;
  confidence: string | null;
  createdAt: Date;
}

export interface PredictionsData {
  predictions: PredictionRow[];
  summary: {
    total: number;
    evaluated: number;
    pending: number;
    directionalAccuracy: number | null;
    mae: number | null;
    calibration: number | null;
  };
}

class AnalyticsService {
  private async getDefaultAccountId(userId: string): Promise<number | null> {
    const accounts = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.userId, userId))
      .limit(1);
    return accounts[0]?.id ?? null;
  }

  async getRiskMetrics(userId: string, accountId?: number): Promise<RiskMetrics> {
    const acctId = accountId ?? (await this.getDefaultAccountId(userId));

    const sessions = acctId
      ? await db
          .select()
          .from(tradingSessions)
          .where(eq(tradingSessions.accountId, acctId))
          .orderBy(desc(tradingSessions.date))
          .limit(252)
      : [];

    // Daily returns as (daily PL) / startingBalance — handles both positive and negative balances
    const dailyReturns = sessions
      .filter((s) => parseFloat(s.startingBalance) > 0)
      .map((s) => parseFloat(s.realizedPL ?? '0') / parseFloat(s.startingBalance));

    // Equity curve in chronological order
    const equityValues = [...sessions]
      .reverse()
      .map((s) => parseFloat(s.endingBalance ?? s.startingBalance));

    const annualisedReturn = mean(dailyReturns) * 252;
    const annualisedVolatility = stddev(dailyReturns) * Math.sqrt(252);
    const mdd = maxDrawdown(equityValues);
    const sharpe = sharpeRatio(dailyReturns);
    const sortino = sortinoRatio(dailyReturns);
    const calmar = calmarRatio(annualisedReturn, mdd);

    // Positions concentration
    const positionRows = acctId
      ? await db
          .select()
          .from(positions)
          .where(eq(positions.accountId, acctId))
      : [];

    const totalMV = positionRows.reduce(
      (s, p) => s + parseFloat(p.marketValue ?? '0'),
      0
    );

    const positionConcentrations = positionRows
      .map((p) => ({
        symbol: p.symbol,
        marketValue: parseFloat(p.marketValue ?? '0'),
        percent: totalMV > 0 ? (parseFloat(p.marketValue ?? '0') / totalMV) * 100 : 0,
      }))
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 10);

    // Sector concentration from portfolio entries
    const portfolioRows = await db
      .select()
      .from(portfolioEntries)
      .where(eq(portfolioEntries.userId, userId));
    const totalPortfolioValue = portfolioRows.reduce(
      (s, e) => s + parseFloat(e.totalValue ?? '0'),
      0
    );
    const sectorMap = new Map<string, number>();
    for (const entry of portfolioRows) {
      const sector = entry.sector ?? 'Unknown';
      sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + parseFloat(entry.totalValue ?? '0'));
    }
    const sectorConcentrations = Array.from(sectorMap.entries())
      .map(([sector, value]) => ({
        sector,
        value,
        percent: totalPortfolioValue > 0 ? (value / totalPortfolioValue) * 100 : 0,
      }))
      .sort((a, b) => b.percent - a.percent);

    return {
      dataPoints: dailyReturns.length,
      sharpeRatio: sharpe,
      sortinoRatio: sortino,
      calmarRatio: calmar,
      maxDrawdown: mdd,
      maxDrawdownPercent: mdd * 100,
      historicalVaR95: historicalVaR(dailyReturns, 0.95),
      historicalVaR99: historicalVaR(dailyReturns, 0.99),
      annualisedVolatility,
      annualisedReturn,
      positionConcentrations,
      topPositionPercent: positionConcentrations[0]?.percent ?? 0,
      sectorConcentrations,
      totalPositionsValue: totalMV,
      sessionCount: sessions.length,
    };
  }

  async getEquityCurve(userId: string, accountId?: number, limit = 90): Promise<PerformanceData> {
    const acctId = accountId ?? (await this.getDefaultAccountId(userId));
    if (!acctId) return { curve: [], summary: { startBalance: 0, endBalance: 0, cumulativeReturn: 0, bestDay: 0, worstDay: 0, winDays: 0, totalDays: 0, winRate: 0, totalRealizedPL: 0, avgDailyPL: 0 } };

    const sessions = await db
      .select()
      .from(tradingSessions)
      .where(eq(tradingSessions.accountId, acctId))
      .orderBy(tradingSessions.date)
      .limit(limit);

    if (sessions.length === 0) {
      return { curve: [], summary: { startBalance: 0, endBalance: 0, cumulativeReturn: 0, bestDay: 0, worstDay: 0, winDays: 0, totalDays: 0, winRate: 0, totalRealizedPL: 0, avgDailyPL: 0 } };
    }

    const curve: EquityCurvePoint[] = sessions.map((s) => ({
      date: s.date.toISOString().split('T')[0]!,
      balance: parseFloat(s.endingBalance ?? s.startingBalance),
      dailyPL:
        parseFloat(s.realizedPL ?? '0') + parseFloat(s.unrealizedPL ?? '0'),
      realizedPL: parseFloat(s.realizedPL ?? '0'),
      unrealizedPL: parseFloat(s.unrealizedPL ?? '0'),
      tradesCount: s.tradesCount,
    }));

    const startBalance = parseFloat(sessions[0]!.startingBalance);
    const endBalance = parseFloat(
      sessions[sessions.length - 1]!.endingBalance ?? sessions[sessions.length - 1]!.startingBalance
    );
    const cumulativeReturn =
      startBalance > 0 ? ((endBalance - startBalance) / startBalance) * 100 : 0;

    const dailyPLs = curve.map((c) => c.realizedPL);
    const bestDay = dailyPLs.length > 0 ? Math.max(...dailyPLs) : 0;
    const worstDay = dailyPLs.length > 0 ? Math.min(...dailyPLs) : 0;
    const winDays = dailyPLs.filter((pl) => pl > 0).length;
    const totalRealizedPL = dailyPLs.reduce((a, b) => a + b, 0);
    const avgDailyPL = dailyPLs.length > 0 ? totalRealizedPL / dailyPLs.length : 0;

    return {
      curve,
      summary: {
        startBalance,
        endBalance,
        cumulativeReturn,
        bestDay,
        worstDay,
        winDays,
        totalDays: sessions.length,
        winRate: sessions.length > 0 ? (winDays / sessions.length) * 100 : 0,
        totalRealizedPL,
        avgDailyPL,
      },
    };
  }

  async getPredictions(filter: {
    userId: string;
    symbol?: string;
    evaluated?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<PredictionsData> {
    const conditions = [];
    conditions.push(eq(predictions.userId, filter.userId));
    if (filter.symbol) conditions.push(eq(predictions.symbol, filter.symbol));
    if (filter.evaluated === true) conditions.push(isNotNull(predictions.evaluatedAt));
    if (filter.evaluated === false) conditions.push(isNull(predictions.evaluatedAt));

    const rows = await db
      .select()
      .from(predictions)
      .where(and(...conditions))
      .orderBy(desc(predictions.createdAt))
      .limit(filter.limit ?? 100)
      .offset(filter.offset ?? 0);

    const evaluated = rows.filter((r) => r.evaluatedAt !== null);
    const correct = evaluated.filter((r) => r.predictedDirection === r.actualDirection);
    const maeSamples = evaluated.filter(
      (r) => r.actualReturnPercent !== null && r.predictedReturnPercent !== null
    );
    const mae =
      maeSamples.length > 0
        ? maeSamples.reduce(
            (s, r) =>
              s +
              Math.abs(
                parseFloat(r.predictedReturnPercent!) - parseFloat(r.actualReturnPercent!)
              ),
            0
          ) / maeSamples.length
        : null;

    // Calibration: average confidence of correct predictions vs all evaluated
    const withConfidence = evaluated.filter((r) => r.confidence !== null);
    const calibration =
      withConfidence.length > 0
        ? withConfidence.reduce((s, r) => {
            const conf = parseFloat(r.confidence!);
            const hit = r.predictedDirection === r.actualDirection ? 1 : 0;
            return s + Math.abs(conf - hit);
          }, 0) / withConfidence.length
        : null;

    return {
      predictions: rows,
      summary: {
        total: rows.length,
        evaluated: evaluated.length,
        pending: rows.length - evaluated.length,
        directionalAccuracy:
          evaluated.length > 0 ? (correct.length / evaluated.length) * 100 : null,
        mae,
        calibration,
      },
    };
  }

  async createPrediction(data: {
    symbol: string;
    predictedDirection: string;
    predictedReturnPercent?: number;
    horizonDays?: number;
    modelVersion?: string;
    confidence?: number;
    userId: string;
  }): Promise<PredictionRow> {
    const [row] = await db
      .insert(predictions)
      .values({
        symbol: data.symbol.toUpperCase(),
        predictedDirection: data.predictedDirection,
        predictedReturnPercent: data.predictedReturnPercent != null ? data.predictedReturnPercent.toFixed(4) : null,
        horizonDays: data.horizonDays ?? 5,
        modelVersion: data.modelVersion ?? 'v1',
        confidence: data.confidence != null ? data.confidence.toFixed(4) : null,
        userId: data.userId,
      })
      .returning();
    return row!;
  }

  async evaluatePrediction(userId: string, id: number, actualReturnPercent: number): Promise<PredictionRow> {
    const actualDirection =
      actualReturnPercent > 0 ? 'up' : actualReturnPercent < 0 ? 'down' : 'hold';
    const [row] = await db
      .update(predictions)
      .set({
        actualReturnPercent: actualReturnPercent.toFixed(4),
        actualDirection,
        evaluatedAt: new Date(),
      })
      .where(and(eq(predictions.id, id), eq(predictions.userId, userId)))
      .returning();
    if (!row) {
      throw new Error('Prediction not found');
    }
    return row!;
  }

  async evaluateDuePredictions(limit = 500): Promise<{ checked: number; evaluated: number; skipped: number }> {
    const pending = await db
      .select()
      .from(predictions)
      .where(isNull(predictions.evaluatedAt))
      .orderBy(asc(predictions.createdAt))
      .limit(limit);

    let checked = 0;
    let evaluated = 0;
    let skipped = 0;
    const now = new Date();

    for (const prediction of pending) {
      checked++;
      const dueAt = new Date(prediction.createdAt);
      dueAt.setDate(dueAt.getDate() + prediction.horizonDays);
      if (dueAt > now) {
        skipped++;
        continue;
      }

      const [startPrice] = await db
        .select({ close: historicalPrices.close })
        .from(historicalPrices)
        .where(and(
          eq(historicalPrices.symbol, prediction.symbol),
          eq(historicalPrices.timeframe, 'daily'),
          gte(historicalPrices.date, prediction.createdAt)
        ))
        .orderBy(asc(historicalPrices.date))
        .limit(1);

      const [endPrice] = await db
        .select({ close: historicalPrices.close })
        .from(historicalPrices)
        .where(and(
          eq(historicalPrices.symbol, prediction.symbol),
          eq(historicalPrices.timeframe, 'daily'),
          gte(historicalPrices.date, dueAt)
        ))
        .orderBy(asc(historicalPrices.date))
        .limit(1);

      if (!startPrice || !endPrice) {
        skipped++;
        continue;
      }

      const startClose = parseFloat(startPrice.close);
      const endClose = parseFloat(endPrice.close);
      if (!Number.isFinite(startClose) || !Number.isFinite(endClose) || startClose <= 0) {
        skipped++;
        continue;
      }

      const actualReturnPercent = ((endClose - startClose) / startClose) * 100;
      const actualDirection = actualReturnPercent > 0 ? 'up' : actualReturnPercent < 0 ? 'down' : 'hold';

      await db
        .update(predictions)
        .set({
          actualReturnPercent: actualReturnPercent.toFixed(4),
          actualDirection,
          evaluatedAt: new Date(),
        })
        .where(eq(predictions.id, prediction.id));
      evaluated++;
    }

    return { checked, evaluated, skipped };
  }
}

export const analyticsService = new AnalyticsService();
