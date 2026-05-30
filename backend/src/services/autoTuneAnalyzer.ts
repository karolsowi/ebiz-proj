import { db } from '../db/connection.js';
import { strategyBacktestRuns, strategyBacktestTrades, strategyRunAnalyses } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { BacktestConfig } from './strategyBacktester.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConvictionBucket {
  rangeMin: number;
  rangeMax: number;
  tradeCount: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
}

export interface PositionSizeAnalysis {
  avgPositionPct: number;
  maxPositionPct: number;
  drawdownContributionBySize: { bucket: string; drawdownContribution: number }[];
  suggestedMaxPositionPct: number | null;
}

export interface RebalanceAnalysis {
  currentIntervalDays: number;
  avgHoldingPeriodDays: number;
  shortHoldWinRate: number;
  longHoldWinRate: number;
  suggestedIntervalDays: number | null;
}

export interface RiskParamAnalysis {
  stopLossHits: number;
  stopLossWhipsaws: number;
  takeProfitHits: number;
  takeProfitLeftOnTable: number;
  suggestTighterStopLoss: boolean;
  suggestLoosertakeProfit: boolean;
}

export interface ParameterChange {
  param: string;
  oldValue: number | boolean;
  newValue: number | boolean;
  reason: string;
  expectedImpact: string;
}

export interface SymbolBreakdown {
  symbol: string;
  trades: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
}

export interface RunAnalysis {
  runId: number;
  originalConfig: Partial<BacktestConfig>;
  proposedConfig: Record<string, unknown>;
  parameterChanges: ParameterChange[];
  summary: {
    totalTrades: number;
    overallWinRate: number;
    overallAvgPnl: number;
    totalPnl: number;
    uniqueSymbols: number;
  };
  analysis: {
    convictionSensitivity: ConvictionBucket[];
    positionSizeImpact: PositionSizeAnalysis;
    rebalanceTimingAnalysis: RebalanceAnalysis;
    riskParamAnalysis: RiskParamAnalysis;
    topWinners: SymbolBreakdown[];
    topLosers: SymbolBreakdown[];
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface TradeRow {
  side: string;
  date: string;
  price: string;
  quantity: number;
  value: string;
  reason: string;
  conviction: string | null;
  pnl: string | null;
  symbol: string;
}

function parseNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === 'number' ? v : parseFloat(v) || 0;
}

function buildConvictionBuckets(trades: TradeRow[]): ConvictionBucket[] {
  const BUCKET_SIZE = 0.05;
  const buyTrades = trades.filter(t => t.side === 'buy' && t.conviction != null);
  const sellTrades = trades.filter(t => t.side === 'sell' && t.pnl != null);

  const tradesBySymbolDate = new Map<string, TradeRow>();
  for (const bt of buyTrades) {
    tradesBySymbolDate.set(`${bt.symbol}_${bt.date}`, bt);
  }

  interface PairedTrade { conviction: number; pnl: number; }
  const paired: PairedTrade[] = [];
  for (const sell of sellTrades) {
    const conviction = parseNum(sell.conviction);
    if (conviction > 0) {
      paired.push({ conviction, pnl: parseNum(sell.pnl) });
    }
  }

  const bucketMap = new Map<number, PairedTrade[]>();
  for (const p of paired) {
    const bucketKey = Math.floor(p.conviction / BUCKET_SIZE) * BUCKET_SIZE;
    const existing = bucketMap.get(bucketKey) ?? [];
    existing.push(p);
    bucketMap.set(bucketKey, existing);
  }

  const buckets: ConvictionBucket[] = [];
  for (const [rangeMin, items] of Array.from(bucketMap.entries()).sort((a, b) => a[0] - b[0])) {
    const wins = items.filter(t => t.pnl > 0).length;
    const totalPnl = items.reduce((s, t) => s + t.pnl, 0);
    buckets.push({
      rangeMin: parseFloat(rangeMin.toFixed(2)),
      rangeMax: parseFloat((rangeMin + BUCKET_SIZE).toFixed(2)),
      tradeCount: items.length,
      winRate: items.length > 0 ? wins / items.length : 0,
      avgPnl: items.length > 0 ? totalPnl / items.length : 0,
      totalPnl,
    });
  }

  return buckets;
}

function analyzePositionSizing(trades: TradeRow[], initialCapital: number): PositionSizeAnalysis {
  const buyTrades = trades.filter(t => t.side === 'buy');
  if (buyTrades.length === 0) {
    return { avgPositionPct: 0, maxPositionPct: 0, drawdownContributionBySize: [], suggestedMaxPositionPct: null };
  }

  const positionPcts = buyTrades.map(t => (parseNum(t.value) / initialCapital) * 100);
  const avgPositionPct = positionPcts.reduce((s, v) => s + v, 0) / positionPcts.length;
  const maxPositionPct = Math.max(...positionPcts);

  const smallBucket = { label: '<5%', trades: [] as TradeRow[] };
  const medBucket = { label: '5-10%', trades: [] as TradeRow[] };
  const largeBucket = { label: '>10%', trades: [] as TradeRow[] };

  for (let i = 0; i < buyTrades.length; i++) {
    const pct = positionPcts[i]!;
    const trade = buyTrades[i]!;
    if (pct < 5) smallBucket.trades.push(trade);
    else if (pct < 10) medBucket.trades.push(trade);
    else largeBucket.trades.push(trade);
  }

  const drawdownContributionBySize = [smallBucket, medBucket, largeBucket].map(b => {
    const losses = trades.filter(t =>
      t.side === 'sell' && parseNum(t.pnl) < 0 &&
      b.trades.some(bt => bt.symbol === t.symbol)
    );
    const totalLoss = losses.reduce((s, t) => s + Math.abs(parseNum(t.pnl)), 0);
    return { bucket: b.label, drawdownContribution: totalLoss };
  });

  const totalLosses = drawdownContributionBySize.reduce((s, d) => s + d.drawdownContribution, 0);
  let suggestedMaxPositionPct: number | null = null;
  if (totalLosses > 0 && largeBucket.trades.length > 0) {
    const largeBucketEntry = drawdownContributionBySize[2];
    const largeContrib = largeBucketEntry ? largeBucketEntry.drawdownContribution / totalLosses : 0;
    if (largeContrib > 0.5) {
      suggestedMaxPositionPct = 0.08;
    }
  }

  return {
    avgPositionPct: parseFloat(avgPositionPct.toFixed(2)),
    maxPositionPct: parseFloat(maxPositionPct.toFixed(2)),
    drawdownContributionBySize,
    suggestedMaxPositionPct,
  };
}

function analyzeRebalanceTiming(trades: TradeRow[], currentInterval: number): RebalanceAnalysis {
  const buyTrades = trades.filter(t => t.side === 'buy');
  const sellTrades = trades.filter(t => t.side === 'sell' && t.reason !== 'end_of_period');

  if (buyTrades.length === 0 || sellTrades.length === 0) {
    return {
      currentIntervalDays: currentInterval,
      avgHoldingPeriodDays: 0,
      shortHoldWinRate: 0,
      longHoldWinRate: 0,
      suggestedIntervalDays: null,
    };
  }

  const holdingPeriods: { days: number; pnl: number }[] = [];
  const sellsBySymbol = new Map<string, TradeRow[]>();
  for (const s of sellTrades) {
    const arr = sellsBySymbol.get(s.symbol) ?? [];
    arr.push(s);
    sellsBySymbol.set(s.symbol, arr);
  }

  for (const buy of buyTrades) {
    const sells = sellsBySymbol.get(buy.symbol) ?? [];
    const matchingSell = sells.find(s => s.date >= buy.date);
    if (matchingSell) {
      const daysDiff = Math.round(
        (new Date(matchingSell.date).getTime() - new Date(buy.date).getTime()) / (1000 * 60 * 60 * 24)
      );
      holdingPeriods.push({ days: daysDiff, pnl: parseNum(matchingSell.pnl) });
    }
  }

  if (holdingPeriods.length === 0) {
    return {
      currentIntervalDays: currentInterval,
      avgHoldingPeriodDays: 0,
      shortHoldWinRate: 0,
      longHoldWinRate: 0,
      suggestedIntervalDays: null,
    };
  }

  const avgHoldingPeriodDays = holdingPeriods.reduce((s, h) => s + h.days, 0) / holdingPeriods.length;
  const sorted = holdingPeriods.sort((a, b) => a.days - b.days);
  const medianDays = sorted[Math.floor(sorted.length / 2)]?.days ?? avgHoldingPeriodDays;

  const shortHold = holdingPeriods.filter(h => h.days <= medianDays);
  const longHold = holdingPeriods.filter(h => h.days > medianDays);

  const shortHoldWinRate = shortHold.length > 0
    ? shortHold.filter(h => h.pnl > 0).length / shortHold.length
    : 0;
  const longHoldWinRate = longHold.length > 0
    ? longHold.filter(h => h.pnl > 0).length / longHold.length
    : 0;

  let suggestedIntervalDays: number | null = null;
  if (shortHoldWinRate > longHoldWinRate + 0.1 && currentInterval > 3) {
    suggestedIntervalDays = Math.max(1, currentInterval - 2);
  } else if (longHoldWinRate > shortHoldWinRate + 0.1 && currentInterval < 14) {
    suggestedIntervalDays = Math.min(14, currentInterval + 2);
  }

  return {
    currentIntervalDays: currentInterval,
    avgHoldingPeriodDays: parseFloat(avgHoldingPeriodDays.toFixed(1)),
    shortHoldWinRate: parseFloat(shortHoldWinRate.toFixed(3)),
    longHoldWinRate: parseFloat(longHoldWinRate.toFixed(3)),
    suggestedIntervalDays,
  };
}

function analyzeRiskParams(trades: TradeRow[]): RiskParamAnalysis {
  const sellTrades = trades.filter(t => t.side === 'sell');

  const stopLossHits = sellTrades.filter(t => t.reason === 'stop_loss').length;
  const takeProfitHits = sellTrades.filter(t => t.reason === 'take_profit').length;

  // Whipsaw: stop-loss hit but the next trade in the same symbol was a profitable buy
  const symbolSells = new Map<string, TradeRow[]>();
  for (const t of sellTrades) {
    const arr = symbolSells.get(t.symbol) ?? [];
    arr.push(t);
    symbolSells.set(t.symbol, arr);
  }

  let stopLossWhipsaws = 0;
  const buyTrades = trades.filter(t => t.side === 'buy');
  for (const sl of sellTrades.filter(t => t.reason === 'stop_loss')) {
    const laterBuy = buyTrades.find(b => b.symbol === sl.symbol && b.date > sl.date);
    if (laterBuy) {
      const laterSell = sellTrades.find(s => s.symbol === sl.symbol && s.date > laterBuy.date);
      if (laterSell && parseNum(laterSell.pnl) > 0) {
        stopLossWhipsaws++;
      }
    }
  }

  // Left on table: take-profit hit but the stock continued higher (next sell at higher price)
  let takeProfitLeftOnTable = 0;
  for (const tp of sellTrades.filter(t => t.reason === 'take_profit')) {
    const laterBuys = buyTrades.filter(b => b.symbol === tp.symbol && b.date > tp.date);
    const firstLaterBuy = laterBuys[0];
    if (firstLaterBuy) {
      const laterSell = sellTrades.find(s => s.symbol === tp.symbol && s.date > firstLaterBuy.date);
      if (laterSell && parseNum(laterSell.price) > parseNum(tp.price)) {
        takeProfitLeftOnTable++;
      }
    }
  }

  const suggestTighterStopLoss = stopLossHits > 0 && (stopLossWhipsaws / stopLossHits) < 0.3;
  const suggestLoosertakeProfit = takeProfitHits > 0 && (takeProfitLeftOnTable / takeProfitHits) > 0.4;

  return {
    stopLossHits,
    stopLossWhipsaws,
    takeProfitHits,
    takeProfitLeftOnTable,
    suggestTighterStopLoss,
    suggestLoosertakeProfit,
  };
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function analyzeRunAndPropose(runId: number): Promise<RunAnalysis> {
  const [run] = await db
    .select()
    .from(strategyBacktestRuns)
    .where(eq(strategyBacktestRuns.id, runId))
    .limit(1);

  if (!run) throw new Error(`Run ${runId} not found`);

  const trades = await db
    .select()
    .from(strategyBacktestTrades)
    .where(eq(strategyBacktestTrades.runId, runId));

  if (trades.length === 0) throw new Error(`Run ${runId} has no trades`);

  const initialCapital = parseNum(run.initialCapital);
  const currentConviction = parseNum(run.convictionThreshold);
  const currentMaxPos = parseNum(run.maxPositionPct);
  const currentRebalance = run.comparisonConfig
    ? (run.comparisonConfig as any).rebalanceIntervalDays ?? 5
    : 5;
  const stopLossEnabled = run.stopLossEnabled;
  const takeProfitEnabled = run.takeProfitEnabled;

  const tradeRows: TradeRow[] = trades.map(t => ({
    side: t.side,
    date: t.date,
    price: t.price,
    quantity: t.quantity,
    value: t.value,
    reason: t.reason,
    conviction: t.conviction,
    pnl: t.pnl,
    symbol: t.symbol,
  }));

  const convictionBuckets = buildConvictionBuckets(tradeRows);
  const positionSizeImpact = analyzePositionSizing(tradeRows, initialCapital);
  const rebalanceTimingAnalysis = analyzeRebalanceTiming(tradeRows, currentRebalance);
  const riskParamAnalysis = analyzeRiskParams(tradeRows);

  // Build proposed config from analysis
  const parameterChanges: ParameterChange[] = [];
  let proposedConviction = currentConviction;
  let proposedMaxPos = currentMaxPos;
  let proposedRebalance = currentRebalance;
  let proposedStopLoss = stopLossEnabled;
  let proposedTakeProfit = takeProfitEnabled;

  // ── Conviction threshold ──
  // Strategy: find highest bucket that improves on overall, even if below 50%
  if (convictionBuckets.length >= 2) {
    const overallSells = tradeRows.filter(t => t.side === 'sell' && t.pnl != null);
    const overallWinRate = overallSells.length > 0
      ? overallSells.filter(t => parseNum(t.pnl) > 0).length / overallSells.length
      : 0;
    const overallAvgPnl = overallSells.length > 0
      ? overallSells.reduce((s, t) => s + parseNum(t.pnl), 0) / overallSells.length
      : 0;

    // Find the best bucket by risk-adjusted score (win_rate * avg_pnl), with enough trades
    const candidateBuckets = convictionBuckets.filter(b => b.tradeCount >= 5);
    if (candidateBuckets.length > 0) {
      const bestBucket = candidateBuckets.reduce((best, b) => {
        const score = b.winRate * Math.max(0, b.avgPnl);
        const bestScore = best.winRate * Math.max(0, best.avgPnl);
        return score > bestScore ? b : best;
      });

      // Also compute cumulative stats for "raise threshold to X" (everything above X)
      const sortedBuckets = [...convictionBuckets].sort((a, b) => a.rangeMin - b.rangeMin);
      let bestThreshold = currentConviction;
      let bestCumulativeScore = -Infinity;
      for (let i = 0; i < sortedBuckets.length; i++) {
        const above = sortedBuckets.slice(i);
        const totalTrades = above.reduce((s, b) => s + b.tradeCount, 0);
        if (totalTrades < 10) continue;
        const cumWinRate = above.reduce((s, b) => s + b.winRate * b.tradeCount, 0) / totalTrades;
        const cumAvgPnl = above.reduce((s, b) => s + b.totalPnl, 0) / totalTrades;
        const score = cumWinRate * cumAvgPnl;
        if (score > bestCumulativeScore) {
          bestCumulativeScore = score;
          bestThreshold = sortedBuckets[i]!.rangeMin;
        }
      }

      const thresholdToUse = Math.max(bestThreshold, bestBucket.rangeMin);
      const winRateImprovement = bestBucket.winRate - overallWinRate;
      const pnlImprovement = bestBucket.avgPnl - overallAvgPnl;

      if (thresholdToUse > currentConviction + 0.02 && (winRateImprovement > 0.03 || pnlImprovement > 0)) {
        proposedConviction = parseFloat(thresholdToUse.toFixed(2));
        const filteredOut = convictionBuckets
          .filter(b => b.rangeMax <= thresholdToUse)
          .reduce((s, b) => s + b.tradeCount, 0);
        parameterChanges.push({
          param: 'convictionThreshold',
          oldValue: currentConviction,
          newValue: proposedConviction,
          reason: `Trades above ${thresholdToUse.toFixed(2)} conviction have ${(bestBucket.winRate * 100).toFixed(0)}% win rate (vs ${(overallWinRate * 100).toFixed(0)}% overall) and $${bestBucket.avgPnl.toFixed(0)} avg PnL (vs $${overallAvgPnl.toFixed(0)}). Filters out ${filteredOut} low-quality entries`,
          expectedImpact: `+${(winRateImprovement * 100).toFixed(1)}pp win rate, +$${pnlImprovement.toFixed(0)} avg PnL per trade`,
        });
      }
    }
  }

  // ── Position sizing ──
  if (positionSizeImpact.suggestedMaxPositionPct != null && positionSizeImpact.suggestedMaxPositionPct < currentMaxPos) {
    proposedMaxPos = positionSizeImpact.suggestedMaxPositionPct;
    parameterChanges.push({
      param: 'maxPositionPct',
      oldValue: currentMaxPos,
      newValue: proposedMaxPos,
      reason: 'Oversized positions (>10%) contributed disproportionately to drawdown',
      expectedImpact: 'Reduced max drawdown with modest return trade-off',
    });
  }

  // ── Rebalance interval ──
  if (rebalanceTimingAnalysis.suggestedIntervalDays != null) {
    proposedRebalance = rebalanceTimingAnalysis.suggestedIntervalDays;
    const direction = proposedRebalance < currentRebalance ? 'shorter' : 'longer';
    parameterChanges.push({
      param: 'rebalanceIntervalDays',
      oldValue: currentRebalance,
      newValue: proposedRebalance,
      reason: `${direction === 'shorter' ? 'Short' : 'Long'}-hold trades have ${direction === 'shorter'
        ? (rebalanceTimingAnalysis.shortHoldWinRate * 100).toFixed(0)
        : (rebalanceTimingAnalysis.longHoldWinRate * 100).toFixed(0)}% win rate vs ${direction === 'shorter'
        ? (rebalanceTimingAnalysis.longHoldWinRate * 100).toFixed(0)
        : (rebalanceTimingAnalysis.shortHoldWinRate * 100).toFixed(0)}% for ${direction === 'shorter' ? 'long' : 'short'}-hold. Avg holding period: ${rebalanceTimingAnalysis.avgHoldingPeriodDays}d`,
      expectedImpact: `Better signal capture with ${direction} rebalance cycle`,
    });
  }

  // ── Stop-loss ──
  // Default is 2×ATR. If whipsaw rate is high, widen it instead of disabling entirely.
  let proposedStopLossAtrMult: number | undefined;
  if (stopLossEnabled && riskParamAnalysis.stopLossHits > 0) {
    const whipsawRate = riskParamAnalysis.stopLossWhipsaws / riskParamAnalysis.stopLossHits;
    if (whipsawRate > 0.5) {
      // Extreme whipsaw: disable stop-loss entirely
      proposedStopLoss = false;
      parameterChanges.push({
        param: 'stopLossEnabled',
        oldValue: true,
        newValue: false,
        reason: `${(whipsawRate * 100).toFixed(0)}% whipsaw rate (${riskParamAnalysis.stopLossWhipsaws}/${riskParamAnalysis.stopLossHits}) — stop-loss is actively harmful at this level`,
        expectedImpact: `Avoid ~${riskParamAnalysis.stopLossWhipsaws} premature exits; consider manual trailing stops`,
      });
    } else if (whipsawRate > 0.25) {
      // Moderate whipsaw: widen the stop from 2×ATR to 3×ATR
      proposedStopLossAtrMult = 3.0;
      parameterChanges.push({
        param: 'stopLossAtrMultiplier',
        oldValue: 2.0,
        newValue: 3.0,
        reason: `${(whipsawRate * 100).toFixed(0)}% whipsaw rate (${riskParamAnalysis.stopLossWhipsaws}/${riskParamAnalysis.stopLossHits}) — current 2×ATR stop is too tight for this universe's volatility`,
        expectedImpact: `Wider stop (3×ATR) absorbs normal volatility while still protecting against catastrophic drops`,
      });
    }
  }

  // ── Take-profit ──
  // Default is 4×ATR. If leaving money on table, widen it.
  let proposedTakeProfitAtrMult: number | undefined;
  if (takeProfitEnabled && riskParamAnalysis.takeProfitHits > 0) {
    const leftOnTableRate = riskParamAnalysis.takeProfitLeftOnTable / riskParamAnalysis.takeProfitHits;
    if (leftOnTableRate > 0.5) {
      // Extreme: disable take-profit entirely (let winners run)
      proposedTakeProfit = false;
      parameterChanges.push({
        param: 'takeProfitEnabled',
        oldValue: true,
        newValue: false,
        reason: `${(leftOnTableRate * 100).toFixed(0)}% of take-profit exits left money on the table (${riskParamAnalysis.takeProfitLeftOnTable}/${riskParamAnalysis.takeProfitHits}) — capping winners too aggressively`,
        expectedImpact: `Let winners run; rely on signal-based exit and stop-loss for risk management`,
      });
    } else if (leftOnTableRate > 0.3) {
      // Moderate: widen take-profit from 4×ATR to 6×ATR
      proposedTakeProfitAtrMult = 6.0;
      parameterChanges.push({
        param: 'takeProfitAtrMultiplier',
        oldValue: 4.0,
        newValue: 6.0,
        reason: `${(leftOnTableRate * 100).toFixed(0)}% of take-profit exits left money on the table (${riskParamAnalysis.takeProfitLeftOnTable}/${riskParamAnalysis.takeProfitHits}) — current 4×ATR target caps upside too early`,
        expectedImpact: `Wider target (6×ATR) captures more upside in trending moves while still locking in gains`,
      });
    }
  }

  const originalConfig: Partial<BacktestConfig> = {
    convictionThreshold: currentConviction,
    maxPositionPct: currentMaxPos,
    rebalanceIntervalDays: currentRebalance,
    stopLossEnabled,
    takeProfitEnabled,
    initialCapital,
  };

  // Start from the original run's full comparison config (carries universeSelection, mlConfig, etc.)
  const baseConfig = (run.comparisonConfig as Record<string, unknown>) ?? {};
  const proposedConfig: Record<string, unknown> = {
    ...baseConfig,
    convictionThreshold: proposedConviction,
    maxPositionPct: proposedMaxPos,
    rebalanceIntervalDays: proposedRebalance,
    stopLossEnabled: proposedStopLoss,
    takeProfitEnabled: proposedTakeProfit,
    initialCapital,
  };
  if (proposedStopLossAtrMult != null) proposedConfig.stopLossAtrMultiplier = proposedStopLossAtrMult;
  if (proposedTakeProfitAtrMult != null) proposedConfig.takeProfitAtrMultiplier = proposedTakeProfitAtrMult;

  // Carry over dates/symbols from original run for validation convenience
  if (run.startDate) proposedConfig.startDate = run.startDate;
  if (run.endDate) proposedConfig.endDate = run.endDate;
  if (run.symbols) proposedConfig.symbols = run.symbols;

  // ── Symbol-level breakdown ──
  const sellTrades = tradeRows.filter(t => t.side === 'sell' && t.pnl != null);
  const symbolMap = new Map<string, { trades: number; wins: number; totalPnl: number }>();
  for (const t of sellTrades) {
    const entry = symbolMap.get(t.symbol) ?? { trades: 0, wins: 0, totalPnl: 0 };
    entry.trades++;
    const pnl = parseNum(t.pnl);
    entry.totalPnl += pnl;
    if (pnl > 0) entry.wins++;
    symbolMap.set(t.symbol, entry);
  }

  const symbolBreakdowns: SymbolBreakdown[] = Array.from(symbolMap.entries())
    .filter(([, v]) => v.trades >= 2)
    .map(([symbol, v]) => ({
      symbol,
      trades: v.trades,
      winRate: v.trades > 0 ? v.wins / v.trades : 0,
      totalPnl: parseFloat(v.totalPnl.toFixed(2)),
      avgPnl: parseFloat((v.totalPnl / v.trades).toFixed(2)),
    }));

  const topWinners = [...symbolBreakdowns].sort((a, b) => b.totalPnl - a.totalPnl).slice(0, 5);
  const topLosers = [...symbolBreakdowns].sort((a, b) => a.totalPnl - b.totalPnl).slice(0, 5);

  // ── Summary stats ──
  const overallWinRate = sellTrades.length > 0
    ? sellTrades.filter(t => parseNum(t.pnl) > 0).length / sellTrades.length
    : 0;
  const totalPnl = sellTrades.reduce((s, t) => s + parseNum(t.pnl), 0);
  const overallAvgPnl = sellTrades.length > 0 ? totalPnl / sellTrades.length : 0;

  return {
    runId,
    originalConfig,
    proposedConfig,
    parameterChanges,
    summary: {
      totalTrades: tradeRows.length,
      overallWinRate: parseFloat(overallWinRate.toFixed(3)),
      overallAvgPnl: parseFloat(overallAvgPnl.toFixed(2)),
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      uniqueSymbols: symbolMap.size,
    },
    analysis: {
      convictionSensitivity: convictionBuckets,
      positionSizeImpact,
      rebalanceTimingAnalysis,
      riskParamAnalysis,
      topWinners,
      topLosers,
    },
  };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export async function persistRunAnalysis(analysis: RunAnalysis): Promise<number> {
  const [row] = await db
    .insert(strategyRunAnalyses)
    .values({
      sourceRunId: analysis.runId,
      analysis: analysis.analysis as any,
      proposedConfig: analysis.proposedConfig as any,
    })
    .returning({ id: strategyRunAnalyses.id });
  return row!.id;
}

export async function getAnalysesForRun(runId: number) {
  return db
    .select()
    .from(strategyRunAnalyses)
    .where(eq(strategyRunAnalyses.sourceRunId, runId));
}

export async function updateAnalysisValidation(analysisId: number, jobId: number) {
  await db
    .update(strategyRunAnalyses)
    .set({ validationJobId: jobId })
    .where(eq(strategyRunAnalyses.id, analysisId));
}

export async function updateAnalysisValidationRun(analysisId: number, runId: number) {
  await db
    .update(strategyRunAnalyses)
    .set({ validationRunId: runId })
    .where(eq(strategyRunAnalyses.id, analysisId));
}
