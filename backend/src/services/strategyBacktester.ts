import {
  isRuleBasedStrategy,
  strategyEngine,
  type RuleBasedStrategyName,
  type StrategySuggestion,
} from './strategyEngine.js';
import { priceService } from './databaseService.js';
import {
  ML_LABEL_HORIZON_DAYS,
  ML_MIN_TRAINING_ROWS,
  ML_TRAINING_LOOKBACK_MONTHS,
  ML_VALIDATION_HOLDOUT_RATIO,
  ML_WALK_FORWARD_CADENCE,
  strategyMlStrategyService,
  type MlExecutionStrategyName,
  type StrategyMlExecutionConfig,
} from './strategyMlStrategyService.js';
import type { ResearchUniverseDiagnostics } from './researchUniverseService.js';
import { mapPool, PoolAbortError } from '../utils/asyncPool.js';
import { defaultSymbolParallelism } from './backtestParallelism.js';

export const BACKTEST_STRATEGIES = [
  'social_momentum',
  'fundamental_flow',
  'full_spectrum',
  'ml_baseline',
  'hybrid_baseline',
] as const;

export type BacktestStrategyName = (typeof BACKTEST_STRATEGIES)[number];
export const BACKTEST_EXECUTION_MODES = ['next_open', 'next_close', 'next_vwap'] as const;
export type BacktestExecutionMode = (typeof BACKTEST_EXECUTION_MODES)[number];

export const BAR_PATH_MODELS = ['legacy_stop_first', 'ohlc_sequence'] as const;
export type BarPathModel = (typeof BAR_PATH_MODELS)[number];

export interface BacktestProgressEvent {
  strategy: BacktestStrategyName;
  dayIndex: number;
  totalDays: number;
  date: string;
  tradesSoFar: number;
  equity: number;
  pctComplete: number;
  symbolCount: number;
}

export type BacktestProgressCallback = (event: BacktestProgressEvent) => void;

export interface BacktestConfig {
  symbols: string[];
  strategy: BacktestStrategyName;
  startDate: string;
  endDate: string;
  initialCapital: number;
  convictionThreshold: number;
  maxPositionPct: number;
  stopLossEnabled: boolean;
  takeProfitEnabled: boolean;
  executionMode: BacktestExecutionMode;
  slippageBps: number;
  commissionBps: number;
  rebalanceIntervalDays: number;
  /** ATR multiplier for stop-loss distance. Default 2.0 (entry - 2×ATR). Higher = wider stop. */
  stopLossAtrMultiplier?: number;
  /** ATR multiplier for take-profit distance. Default 4.0 (entry + 4×ATR). Higher = more room to run. */
  takeProfitAtrMultiplier?: number;
  /**
   * How same-bar stop vs take-profit is resolved without tick data.
   * `ohlc_sequence` walks O→H→L→C on bull bars and O→L→H→C on bear bars (close vs open).
   */
  barPathModel?: BarPathModel;
  /**
   * Optional square-root market impact (bps) added on top of `slippageBps`:
   * `impactBps = liquidityImpactSqrtCoef * sqrt(min(1, orderNotional / avgDollarVolume)))`.
   */
  liquidityImpactSqrtCoef?: number;
  /** Trailing window (trading days with data) for average dollar volume. Default 20. */
  advVolumeLookbackDays?: number;
  /** Cap order notional at this fraction of one-day average dollar volume (e.g. 0.05 = 5%). */
  maxAdvParticipationPct?: number;
  universeDiagnostics?: ResearchUniverseDiagnostics;
  mlConfig?: StrategyMlExecutionConfig;
  /** Optional live progress (throttled to ~every 5% of trading days). */
  onProgress?: BacktestProgressCallback;
  /** Long-running steps (e.g. ML feature build) — shown in comparison UI. */
  onActivity?: (message: string) => void;
  /** Concurrent symbol signal evaluations per rebalance day (default: CPU-based, up to 16). */
  symbolParallelism?: number;
}

/** Thrown when pause is requested mid-day (caught by runBacktestResumable). */
export class BacktestPauseRequested extends Error {
  constructor(readonly dayIndex: number) {
    super('Backtest pause requested');
    this.name = 'BacktestPauseRequested';
  }
}

type BacktestDayContext = {
  barCache: Map<string, PriceBar>;
  signalCache: Map<string, Awaited<ReturnType<typeof strategyEngine.gatherAllSignals>>>;
  symbolParallelism: number;
  shouldPause?: () => boolean | Promise<boolean>;
};

export interface OpenPosition {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  conviction: number;
  costBasis: number;
}

interface PendingOrder {
  symbol: string;
  side: 'buy' | 'sell';
  reason: 'signal_entry' | 'signal_exit';
  conviction: number;
  generatedDate: string;
  suggestedPositionPct?: number;
  referenceEntryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface SimulatedTrade {
  symbol: string;
  side: 'buy' | 'sell';
  date: string;
  price: number;
  quantity: number;
  value: number;
  reason: 'signal_entry' | 'signal_exit' | 'stop_loss' | 'take_profit' | 'end_of_period';
  conviction: number;
  strategy: BacktestStrategyName;
  pnl?: number;
  fees?: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
  cash: number;
  positionsValue: number;
}

export interface BacktestMlBucketUsage {
  bucketStart: string;
  year: string;
  modelVersion: string | null;
  trainingStartDate: string | null;
  trainedThroughDate: string | null;
  trainingRowCount: number | null;
  suggestionCount: number;
}

export interface BacktestMlYearUsage {
  year: string;
  bucketCount: number;
  suggestionCount: number;
}

export interface BacktestMlFallbackReason {
  reason: string;
  count: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: SimulatedTrade[];
  equityCurve: EquityPoint[];
  finalEquity: number;
  totalReturn: number;
  totalReturnPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  annualizedReturnPct: number;
  strategyMetadata: {
    strategyFamily: 'rule' | 'ml' | 'hybrid';
    modelVersions: string[];
    bucketStarts: string[];
    trainedThroughDates: string[];
    executionTiming: BacktestExecutionMode;
    barPathModel: BarPathModel;
    liquidityImpactSqrtCoef: number;
    advVolumeLookbackDays: number;
    maxAdvParticipationPct: number | null;
    slippageBps: number;
    commissionBps: number;
    rebalanceIntervalDays: number;
    universeDiagnostics: ResearchUniverseDiagnostics | null;
    mlDiagnostics: {
      walkForwardCadence: NonNullable<StrategyMlExecutionConfig['walkForwardCadence']>;
      trainingLookbackMonths: number;
      labelHorizonDays: number;
      minTrainingRows: number;
      validationHoldoutRatio: number;
      totalMlEvaluations: number;
      modelBackedEvaluations: number;
      fallbackEvaluations: number;
      bucketUsage: BacktestMlBucketUsage[];
      yearUsage: BacktestMlYearUsage[];
      fallbackReasons: BacktestMlFallbackReason[];
    };
  };
}

export interface BacktestPendingOrderSnapshot {
  symbol: string;
  side: 'buy' | 'sell';
  reason: 'signal_entry' | 'signal_exit';
  conviction: number;
  generatedDate: string;
  suggestedPositionPct?: number;
  referenceEntryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface BacktestResumeState {
  nextDayIndex: number;
  cash: number;
  positions: OpenPosition[];
  pendingOrders: BacktestPendingOrderSnapshot[];
  allTrades: SimulatedTrade[];
  equityCurve: EquityPoint[];
  strategyMetadata: BacktestResult['strategyMetadata'];
}

export interface BacktestResumableOptions {
  resume?: BacktestResumeState;
  shouldPause?: () => boolean | Promise<boolean>;
  /** Persist mid-run state (e.g. every N trading days) for crash/reboot recovery. */
  onPeriodicCheckpoint?: (resume: BacktestResumeState) => void | Promise<void>;
}

export type BacktestRunOutcome =
  | { status: 'complete'; result: BacktestResult }
  | { status: 'paused'; resume: BacktestResumeState };

function snapshotPendingOrders(orders: PendingOrder[]): BacktestPendingOrderSnapshot[] {
  return orders.map((o) => ({ ...o }));
}

function restorePendingOrders(orders: BacktestPendingOrderSnapshot[]): PendingOrder[] {
  return orders.map((o) => ({ ...o }));
}

function buildResumeState(
  nextDayIndex: number,
  cash: number,
  positions: Map<string, OpenPosition>,
  pendingOrders: PendingOrder[],
  allTrades: SimulatedTrade[],
  equityCurve: EquityPoint[],
  strategyMetadata: BacktestResult['strategyMetadata']
): BacktestResumeState {
  return {
    nextDayIndex,
    cash,
    positions: Array.from(positions.values()),
    pendingOrders: snapshotPendingOrders(pendingOrders),
    allTrades,
    equityCurve,
    strategyMetadata,
  };
}

export function isRebalanceDay(
  dayIndex: number,
  rebalanceIntervalDays: number
): boolean {
  const interval = Math.max(1, Math.floor(rebalanceIntervalDays));
  return dayIndex % interval === 0;
}

export function applySlippage(
  price: number,
  side: 'buy' | 'sell',
  slippageBps: number
): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  const bps = Math.max(0, slippageBps);
  const multiplier = side === 'buy'
    ? 1 + bps / 10_000
    : 1 - bps / 10_000;
  return parseFloat((price * multiplier).toFixed(8));
}

export function computeCommission(
  notional: number,
  commissionBps: number
): number {
  if (!Number.isFinite(notional) || notional <= 0) return 0;
  const bps = Math.max(0, commissionBps);
  return parseFloat((notional * (bps / 10_000)).toFixed(4));
}

class StrategyBacktester {
  private getTradingDays(startDate: string, endDate: string): Date[] {
    const days: Date[] = [];
    const current = new Date(startDate + 'T12:00:00Z');
    const end = new Date(endDate + 'T12:00:00Z');

    while (current <= end) {
      const dayOfWeek = current.getUTCDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        days.push(new Date(current));
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return days;
  }

  private async getPriceForDate(
    symbol: string,
    date: Date
  ): Promise<number | null> {
    const bar = await this.getLatestPriceBarOnOrBefore(symbol, date);
    return bar?.close ?? null;
  }

  private getUtcDayRange(date: Date): { start: Date; end: Date } {
    const start = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
      0
    ));
    const end = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23,
      59,
      59,
      999
    ));
    return { start, end };
  }

  private toPriceBar(row: any): PriceBar {
    const vol = row.volume != null ? Number(row.volume) : null;
    return {
      date: new Date(row.date).toISOString().split('T')[0]!,
      open: parseFloat(String(row.open)),
      high: parseFloat(String(row.high)),
      low: parseFloat(String(row.low)),
      close: parseFloat(String(row.close)),
      volume: Number.isFinite(vol as number) ? (vol as number) : null,
    };
  }

  private dayBarCacheKey(symbol: string, date: Date): string {
    return `${date.toISOString().split('T')[0]!}|${symbol.toUpperCase()}`;
  }

  private async prefetchDayBars(
    symbols: string[],
    date: Date,
    barCache: Map<string, PriceBar>
  ): Promise<void> {
    const unique = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
    if (unique.length === 0) return;

    const { start, end } = this.getUtcDayRange(date);
    const rows = await priceService.getDailyPriceBarsForSymbols(unique, start, end);
    for (const row of rows) {
      const bar = this.toPriceBar(row);
      barCache.set(this.dayBarCacheKey(row.symbol, date), bar);
    }
  }

  private async getExactPriceBar(
    symbol: string,
    date: Date,
    barCache?: Map<string, PriceBar>
  ): Promise<PriceBar | null> {
    const key = this.dayBarCacheKey(symbol, date);
    if (barCache?.has(key)) {
      return barCache.get(key) ?? null;
    }

    const { start, end } = this.getUtcDayRange(date);
    const rows = await priceService.getPriceHistory(
      symbol.toUpperCase(),
      start,
      end,
      'daily'
    );

    if (rows.length === 0) return null;
    const bar = this.toPriceBar(rows[0]);
    if (barCache) barCache.set(key, bar);
    return bar;
  }

  private async getLatestPriceBarOnOrBefore(
    symbol: string,
    date: Date
  ): Promise<PriceBar | null> {
    const { end } = this.getUtcDayRange(date);
    const since = new Date(end.getTime() - 10 * 86_400_000);
    const rows = await priceService.getPriceHistory(
      symbol.toUpperCase(),
      since,
      end,
      'daily'
    );

    if (rows.length === 0) return null;
    return this.toPriceBar(rows[0]);
  }

  /** Daily-bar VWAP proxy when path model is legacy: typical price (H+L+C)/3. */
  private getBarTypicalPrice(bar: PriceBar): number {
    const t = (bar.high + bar.low + bar.close) / 3;
    return Number.isFinite(t) && t > 0 ? parseFloat(t.toFixed(8)) : bar.close;
  }

  private getBarPathVertices(bar: PriceBar, model: BarPathModel): number[] {
    if (model === 'legacy_stop_first') {
      return [bar.open, bar.high, bar.low, bar.close];
    }
    return bar.close >= bar.open
      ? [bar.open, bar.high, bar.low, bar.close]
      : [bar.open, bar.low, bar.high, bar.close];
  }

  /**
   * Path-integrated price for VWAP-style fills: segment midpoints weighted by
   * |Δprice| × max(volume,1). Falls back to typical price if degenerate.
   */
  private computePathIntegratedPrice(bar: PriceBar, model: BarPathModel): number {
    if (model === 'legacy_stop_first') {
      return this.getBarTypicalPrice(bar);
    }
    const v = this.getBarPathVertices(bar, model);
    const vol = bar.volume && bar.volume > 0 ? bar.volume : 1;
    let num = 0;
    let den = 0;
    for (let i = 0; i < v.length - 1; i++) {
      const a = v[i]!;
      const b = v[i + 1]!;
      const seg = Math.abs(b - a);
      if (seg < 1e-12) continue;
      const w = seg * vol;
      num += ((a + b) / 2) * w;
      den += w;
    }
    if (den <= 0) return this.getBarTypicalPrice(bar);
    return parseFloat((num / den).toFixed(8));
  }

  private getExecutionPrice(
    bar: PriceBar,
    executionMode: BacktestExecutionMode,
    barPathModel: BarPathModel
  ): number {
    if (executionMode === 'next_open') return bar.open;
    if (executionMode === 'next_vwap') {
      return this.computePathIntegratedPrice(bar, barPathModel);
    }
    return bar.close;
  }

  /** Fills queued signal orders after the session (close or VWAP proxy), not at the open. */
  private isDeferredExecutionMode(mode: BacktestExecutionMode): boolean {
    return mode === 'next_close' || mode === 'next_vwap';
  }

  private normalizeTargetPrice(
    target: number | undefined,
    referenceEntryPrice: number | undefined,
    executionPrice: number,
    fallbackMultiplier: number
  ): number {
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) {
      return executionPrice;
    }

    if (
      Number.isFinite(target) &&
      Number.isFinite(referenceEntryPrice) &&
      (referenceEntryPrice ?? 0) > 0
    ) {
      const adjusted = executionPrice + ((target ?? 0) - (referenceEntryPrice ?? 0));
      if (Number.isFinite(adjusted) && adjusted > 0) {
        return parseFloat(adjusted.toFixed(8));
      }
    }

    if (Number.isFinite(target) && (target ?? 0) > 0) {
      return parseFloat((target ?? 0).toFixed(8));
    }

    return parseFloat((executionPrice * fallbackMultiplier).toFixed(8));
  }

  private resolveOrderTargets(
    order: PendingOrder,
    executionPrice: number,
    config: BacktestConfig
  ): { stopLoss: number; takeProfit: number } {
    let stopLoss = this.normalizeTargetPrice(
      order.stopLoss,
      order.referenceEntryPrice,
      executionPrice,
      0.95
    );
    let takeProfit = this.normalizeTargetPrice(
      order.takeProfit,
      order.referenceEntryPrice,
      executionPrice,
      1.05
    );

    if (stopLoss >= executionPrice) {
      stopLoss = parseFloat((executionPrice * 0.95).toFixed(8));
    }
    if (takeProfit <= executionPrice) {
      takeProfit = parseFloat((executionPrice * 1.05).toFixed(8));
    }

    // Apply ATR multiplier scaling: widen/tighten stops relative to the default 2×ATR
    const slMult = config.stopLossAtrMultiplier;
    if (slMult != null && slMult !== 2.0) {
      const defaultDistance = executionPrice - stopLoss;
      const scaledDistance = defaultDistance * (slMult / 2.0);
      stopLoss = parseFloat(Math.max(executionPrice * 0.5, executionPrice - scaledDistance).toFixed(8));
    }
    const tpMult = config.takeProfitAtrMultiplier;
    if (tpMult != null && tpMult !== 4.0) {
      const defaultDistance = takeProfit - executionPrice;
      const scaledDistance = defaultDistance * (tpMult / 4.0);
      takeProfit = parseFloat((executionPrice + scaledDistance).toFixed(8));
    }

    return { stopLoss, takeProfit };
  }

  private resolveBarPathModel(config: BacktestConfig): BarPathModel {
    return config.barPathModel ?? 'ohlc_sequence';
  }

  private async getAvgDollarVolume(
    symbol: string,
    asOf: Date,
    lookback: number
  ): Promise<number | null> {
    const { end } = this.getUtcDayRange(asOf);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - lookback * 3 - 7);
    const rows = await priceService.getPriceHistory(symbol.toUpperCase(), start, end, 'daily');
    const dollars: number[] = [];
    for (const row of rows) {
      const rowDate = new Date(row.date);
      if (rowDate > end) continue;
      const c = parseFloat(String(row.close));
      const v = row.volume != null ? Number(row.volume) : 0;
      if (c > 0 && v > 0) dollars.push(c * v);
      if (dollars.length >= lookback) break;
    }
    if (dollars.length < Math.min(5, lookback)) return null;
    const sum = dollars.reduce((a, b) => a + b, 0);
    return sum / dollars.length;
  }

  private async computeLiquidityImpactBps(
    symbol: string,
    asOf: Date,
    orderNotional: number,
    config: BacktestConfig
  ): Promise<number> {
    const coef = config.liquidityImpactSqrtCoef ?? 0;
    if (!(coef > 0) || !(orderNotional > 0)) return 0;
    const lookback = Math.max(5, Math.floor(config.advVolumeLookbackDays ?? 20));
    const adv = await this.getAvgDollarVolume(symbol, asOf, lookback);
    if (!adv || adv <= 0) return 0;
    const participation = Math.min(1, Math.max(0, orderNotional / adv));
    return coef * Math.sqrt(participation);
  }

  private determineIntradayExitLegacy(
    position: OpenPosition,
    bar: PriceBar,
    config: BacktestConfig
  ): {
    reason: 'stop_loss' | 'take_profit';
    rawPrice: number;
  } | null {
    if (config.stopLossEnabled && bar.open <= position.stopLoss) {
      return { reason: 'stop_loss', rawPrice: bar.open };
    }
    if (config.takeProfitEnabled && bar.open >= position.takeProfit) {
      return { reason: 'take_profit', rawPrice: bar.open };
    }

    const hitStop = config.stopLossEnabled && bar.low <= position.stopLoss;
    const hitTake = config.takeProfitEnabled && bar.high >= position.takeProfit;

    if (hitStop && hitTake) {
      return { reason: 'stop_loss', rawPrice: position.stopLoss };
    }
    if (hitStop) {
      return { reason: 'stop_loss', rawPrice: position.stopLoss };
    }
    if (hitTake) {
      return { reason: 'take_profit', rawPrice: position.takeProfit };
    }

    return null;
  }

  private determineIntradayExitOhlcSequence(
    position: OpenPosition,
    bar: PriceBar,
    config: BacktestConfig
  ): {
    reason: 'stop_loss' | 'take_profit';
    rawPrice: number;
  } | null {
    const sl = position.stopLoss;
    const tp = position.takeProfit;
    const vertices = this.getBarPathVertices(bar, 'ohlc_sequence');

    if (config.stopLossEnabled && bar.open <= sl) {
      return { reason: 'stop_loss', rawPrice: bar.open };
    }
    if (config.takeProfitEnabled && bar.open >= tp) {
      return { reason: 'take_profit', rawPrice: bar.open };
    }

    let bestTime: number | null = null;
    let best: { reason: 'stop_loss' | 'take_profit'; rawPrice: number } | null = null;
    let cumLen = 0;

    for (let i = 0; i < vertices.length - 1; i++) {
      const a = vertices[i]!;
      const b = vertices[i + 1]!;
      const segLen = Math.abs(b - a);
      if (segLen < 1e-12) {
        continue;
      }
      const d = b - a;

      const candidates: Array<{
        t: number;
        reason: 'stop_loss' | 'take_profit';
        price: number;
      }> = [];

      if (config.stopLossEnabled && d < 0 && a > sl && b <= sl) {
        const t = (a - sl) / (a - b);
        if (t > 0 && t <= 1 + 1e-9) {
          candidates.push({ t: Math.min(1, Math.max(0, t)), reason: 'stop_loss', price: sl });
        }
      }
      if (config.takeProfitEnabled && d > 0 && a < tp && b >= tp) {
        const t = (tp - a) / (b - a);
        if (t > 0 && t <= 1 + 1e-9) {
          candidates.push({ t: Math.min(1, Math.max(0, t)), reason: 'take_profit', price: tp });
        }
      }

      for (const c of candidates) {
        const globalT = cumLen + c.t * segLen;
        if (
          bestTime === null ||
          globalT < bestTime - 1e-9 ||
          (Math.abs(globalT - bestTime) < 1e-9 && c.reason === 'stop_loss' && best!.reason === 'take_profit')
        ) {
          bestTime = globalT;
          best = { reason: c.reason, rawPrice: c.price };
        }
      }

      cumLen += segLen;
    }

    return best;
  }

  private determineIntradayExit(
    position: OpenPosition,
    bar: PriceBar,
    config: BacktestConfig
  ): {
    reason: 'stop_loss' | 'take_profit';
    rawPrice: number;
  } | null {
    const model = this.resolveBarPathModel(config);
    if (model === 'legacy_stop_first') {
      return this.determineIntradayExitLegacy(position, bar, config);
    }
    return this.determineIntradayExitOhlcSequence(position, bar, config);
  }

  private async buildSuggestionForStrategy(
    symbol: string,
    date: Date,
    config: BacktestConfig,
    signals: Awaited<ReturnType<typeof strategyEngine.gatherAllSignals>>
  ): Promise<StrategySuggestion | null> {
    if (!signals) return null;

    if (isRuleBasedStrategy(config.strategy)) {
      return strategyEngine.buildSuggestion(
        symbol,
        config.strategy as RuleBasedStrategyName,
        signals
      );
    }

    return strategyMlStrategyService.buildSuggestion(
      symbol,
      config.strategy as MlExecutionStrategyName,
      signals,
      date,
      config.symbols,
      config.mlConfig,
      config.onActivity ? { onActivity: config.onActivity } : undefined
    );
  }

  private createStrategyMetadata(
    strategy: BacktestStrategyName,
    config?: BacktestConfig
  ): BacktestResult['strategyMetadata'] {
    const rawVal = config?.mlConfig?.validationHoldoutRatio ?? ML_VALIDATION_HOLDOUT_RATIO;
    const validationHoldoutRatio = Number.isFinite(rawVal)
      ? Math.min(0.45, Math.max(0, rawVal))
      : ML_VALIDATION_HOLDOUT_RATIO;
    const mlConfig = {
      walkForwardCadence: config?.mlConfig?.walkForwardCadence ?? ML_WALK_FORWARD_CADENCE,
      trainingLookbackMonths: config?.mlConfig?.trainingLookbackMonths ?? ML_TRAINING_LOOKBACK_MONTHS,
      labelHorizonDays: config?.mlConfig?.labelHorizonDays ?? ML_LABEL_HORIZON_DAYS,
      minTrainingRows: config?.mlConfig?.minTrainingRows ?? ML_MIN_TRAINING_ROWS,
      validationHoldoutRatio,
    };
    return {
      strategyFamily: strategy === 'ml_baseline'
        ? 'ml'
        : strategy === 'hybrid_baseline'
          ? 'hybrid'
          : 'rule',
      modelVersions: [],
      bucketStarts: [],
      trainedThroughDates: [],
      executionTiming: config?.executionMode ?? 'next_close',
      barPathModel: config?.barPathModel ?? 'ohlc_sequence',
      liquidityImpactSqrtCoef: config?.liquidityImpactSqrtCoef ?? 0,
      advVolumeLookbackDays: config?.advVolumeLookbackDays ?? 20,
      maxAdvParticipationPct:
        config?.maxAdvParticipationPct !== undefined ? config.maxAdvParticipationPct : null,
      slippageBps: 0,
      commissionBps: 0,
      rebalanceIntervalDays: 1,
      universeDiagnostics: config?.universeDiagnostics ?? null,
      mlDiagnostics: {
        walkForwardCadence: mlConfig.walkForwardCadence,
        trainingLookbackMonths: mlConfig.trainingLookbackMonths,
        labelHorizonDays: mlConfig.labelHorizonDays,
        minTrainingRows: mlConfig.minTrainingRows,
        validationHoldoutRatio: mlConfig.validationHoldoutRatio,
        totalMlEvaluations: 0,
        modelBackedEvaluations: 0,
        fallbackEvaluations: 0,
        bucketUsage: [],
        yearUsage: [],
        fallbackReasons: [],
      },
    };
  }

  private parseOptionalNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private upsertMlBucketUsage(
    metadata: BacktestResult['strategyMetadata'],
    bucketStart: string,
    details: {
      modelVersion: string | null;
      trainingStartDate: string | null;
      trainedThroughDate: string | null;
      trainingRowCount: number | null;
    }
  ): void {
    const year = bucketStart.slice(0, 4);
    const existing = metadata.mlDiagnostics.bucketUsage.find(
      (entry) =>
        entry.bucketStart === bucketStart &&
        entry.modelVersion === details.modelVersion
    );

    if (existing) {
      existing.suggestionCount += 1;
      existing.trainingStartDate ??= details.trainingStartDate;
      existing.trainedThroughDate ??= details.trainedThroughDate;
      existing.trainingRowCount ??= details.trainingRowCount;
      return;
    }

    metadata.mlDiagnostics.bucketUsage.push({
      bucketStart,
      year,
      modelVersion: details.modelVersion,
      trainingStartDate: details.trainingStartDate,
      trainedThroughDate: details.trainedThroughDate,
      trainingRowCount: details.trainingRowCount,
      suggestionCount: 1,
    });
  }

  private upsertMlYearUsage(
    metadata: BacktestResult['strategyMetadata'],
    year: string,
    bucketStart: string
  ): void {
    const existing = metadata.mlDiagnostics.yearUsage.find((entry) => entry.year === year);
    if (existing) {
      existing.suggestionCount += 1;
      const knownBuckets = new Set(
        metadata.mlDiagnostics.bucketUsage
          .filter((entry) => entry.year === year)
          .map((entry) => entry.bucketStart)
      );
      knownBuckets.add(bucketStart);
      existing.bucketCount = knownBuckets.size;
      return;
    }

    metadata.mlDiagnostics.yearUsage.push({
      year,
      bucketCount: 1,
      suggestionCount: 1,
    });
  }

  private upsertMlFallbackReason(
    metadata: BacktestResult['strategyMetadata'],
    reason: string
  ): void {
    const existing = metadata.mlDiagnostics.fallbackReasons.find(
      (entry) => entry.reason === reason
    );
    if (existing) {
      existing.count += 1;
      return;
    }

    metadata.mlDiagnostics.fallbackReasons.push({ reason, count: 1 });
  }

  private captureSuggestionMetadata(
    metadata: BacktestResult['strategyMetadata'],
    suggestion: StrategySuggestion
  ): void {
    for (const [breakdownKey, value] of Object.entries(suggestion.breakdown)) {
      const modelVersion =
        typeof value.meta?.modelVersion === 'string' ? value.meta.modelVersion : null;
      const bucketStart =
        typeof value.meta?.bucketStart === 'string' ? value.meta.bucketStart : null;
      const trainingStartDate =
        typeof value.meta?.trainingStartDate === 'string' ? value.meta.trainingStartDate : null;
      const trainedThroughDate =
        typeof value.meta?.trainedThroughDate === 'string' ? value.meta.trainedThroughDate : null;
      const reason =
        typeof value.meta?.reason === 'string' ? value.meta.reason : null;
      const trainingRowCount =
        this.parseOptionalNumber(value.meta?.trainingRowCount) ??
        this.parseOptionalNumber(value.observations);
      const isMlBreakdown =
        breakdownKey.includes('ml') ||
        !!modelVersion ||
        !!bucketStart ||
        !!trainingStartDate ||
        !!trainedThroughDate ||
        !!reason;

      if (modelVersion && !metadata.modelVersions.includes(modelVersion)) {
        metadata.modelVersions.push(modelVersion);
      }
      if (bucketStart && !metadata.bucketStarts.includes(bucketStart)) {
        metadata.bucketStarts.push(bucketStart);
      }
      if (
        trainedThroughDate &&
        !metadata.trainedThroughDates.includes(trainedThroughDate)
      ) {
        metadata.trainedThroughDates.push(trainedThroughDate);
      }

      if (!isMlBreakdown) continue;

      metadata.mlDiagnostics.totalMlEvaluations += 1;
      if (bucketStart) {
        this.upsertMlBucketUsage(metadata, bucketStart, {
          modelVersion,
          trainingStartDate,
          trainedThroughDate,
          trainingRowCount,
        });
        this.upsertMlYearUsage(metadata, bucketStart.slice(0, 4), bucketStart);
      }

      if (modelVersion || trainedThroughDate || trainingStartDate) {
        metadata.mlDiagnostics.modelBackedEvaluations += 1;
      } else {
        metadata.mlDiagnostics.fallbackEvaluations += 1;
        if (reason) {
          this.upsertMlFallbackReason(metadata, reason);
        }
      }
    }
  }

  private hasPendingOrder(
    pendingOrders: PendingOrder[],
    symbol: string,
    side: 'buy' | 'sell'
  ): boolean {
    return pendingOrders.some(
      (order) => order.symbol === symbol.toUpperCase() && order.side === side
    );
  }

  private async executePendingOrders(
    date: Date,
    pendingOrders: PendingOrder[],
    positions: Map<string, OpenPosition>,
    cash: number,
    config: BacktestConfig,
    dayCtx?: BacktestDayContext
  ): Promise<{
    trades: SimulatedTrade[];
    cash: number;
    remainingOrders: PendingOrder[];
  }> {
    const trades: SimulatedTrade[] = [];
    const remainingOrders: PendingOrder[] = [];

    for (const order of pendingOrders) {
      const executionBar = await this.getExactPriceBar(
        order.symbol,
        date,
        dayCtx?.barCache
      );
      if (!executionBar) {
        remainingOrders.push(order);
        continue;
      }
      const pathModel = this.resolveBarPathModel(config);
      const rawPrice = this.getExecutionPrice(executionBar, config.executionMode, pathModel);
      if (rawPrice <= 0) {
        remainingOrders.push(order);
        continue;
      }
      const dateStr = executionBar.date;

      if (order.side === 'buy') {
        if (positions.has(order.symbol)) continue;

        const positionPct = Math.min(
          (order.suggestedPositionPct ?? 0) / 100,
          config.maxPositionPct
        );
        let positionBudget = cash * positionPct;
        const lookback = Math.max(5, Math.floor(config.advVolumeLookbackDays ?? 20));
        const adv = await this.getAvgDollarVolume(order.symbol, date, lookback);
        const maxPart = config.maxAdvParticipationPct;
        if (maxPart !== undefined && maxPart > 0 && adv && adv > 0) {
          positionBudget = Math.min(positionBudget, adv * maxPart);
        }

        const impactBpsBuy = await this.computeLiquidityImpactBps(
          order.symbol,
          date,
          positionBudget,
          config
        );
        const executionPrice = applySlippage(
          rawPrice,
          'buy',
          config.slippageBps + impactBpsBuy
        );
        const targets = this.resolveOrderTargets(order, executionPrice, config);
        const perShareCost = executionPrice * (1 + Math.max(0, config.commissionBps) / 10_000);
        const quantity = Math.floor(positionBudget / perShareCost);

        if (quantity < 1) continue;

        const notional = quantity * executionPrice;
        const fees = computeCommission(notional, config.commissionBps);
        const totalCost = notional + fees;
        if (totalCost > cash) continue;

        cash -= totalCost;
        positions.set(order.symbol, {
          symbol: order.symbol,
          entryDate: dateStr,
          entryPrice: executionPrice,
          quantity,
          stopLoss: targets.stopLoss,
          takeProfit: targets.takeProfit,
          conviction: order.conviction,
          costBasis: totalCost,
        });

        trades.push({
          symbol: order.symbol,
          side: 'buy',
          date: dateStr,
          price: executionPrice,
          quantity,
          value: notional,
          reason: order.reason,
          conviction: order.conviction,
          strategy: config.strategy,
          fees,
        });
        continue;
      }

      const position = positions.get(order.symbol);
      if (!position) continue;

      const notionalEst = position.quantity * rawPrice;
      const impactBpsSell = await this.computeLiquidityImpactBps(
        order.symbol,
        date,
        notionalEst,
        config
      );
      const executionPrice = applySlippage(
        rawPrice,
        'sell',
        config.slippageBps + impactBpsSell
      );
      const notional = position.quantity * executionPrice;
      const fees = computeCommission(notional, config.commissionBps);
      const netProceeds = notional - fees;
      const pnl = netProceeds - position.costBasis;

      cash += netProceeds;
      trades.push({
        symbol: order.symbol,
        side: 'sell',
        date: dateStr,
        price: executionPrice,
        quantity: position.quantity,
        value: notional,
        reason: order.reason,
        conviction: order.conviction,
        strategy: config.strategy,
        pnl,
        fees,
      });
      positions.delete(order.symbol);
    }

    return { trades, cash, remainingOrders };
  }

  private async executeImmediateExit(
    symbol: string,
    asOf: Date,
    dateStr: string,
    position: OpenPosition,
    rawPrice: number,
    reason: 'stop_loss' | 'take_profit' | 'end_of_period',
    cash: number,
    config: BacktestConfig
  ): Promise<{ trade: SimulatedTrade; cash: number }> {
    const notionalEst = position.quantity * rawPrice;
    const impactBps = await this.computeLiquidityImpactBps(
      symbol,
      asOf,
      notionalEst,
      config
    );
    const executionPrice = applySlippage(
      rawPrice,
      'sell',
      config.slippageBps + impactBps
    );
    const notional = position.quantity * executionPrice;
    const fees = computeCommission(notional, config.commissionBps);
    const netProceeds = notional - fees;
    const pnl = netProceeds - position.costBasis;

    return {
      trade: {
        symbol,
        side: 'sell',
        date: dateStr,
        price: executionPrice,
        quantity: position.quantity,
        value: notional,
        reason,
        conviction: position.conviction,
        strategy: config.strategy,
        pnl,
        fees,
      },
      cash: cash + netProceeds,
    };
  }

  private async processDay(
    dayIndex: number,
    date: Date,
    symbols: string[],
    positions: Map<string, OpenPosition>,
    pendingOrders: PendingOrder[],
    cash: number,
    config: BacktestConfig,
    strategyMetadata: BacktestResult['strategyMetadata'],
    dayCtx: BacktestDayContext
  ): Promise<{ trades: SimulatedTrade[]; cash: number; pendingOrders: PendingOrder[] }> {
    const trades: SimulatedTrade[] = [];
    const dateStr = date.toISOString().split('T')[0]!;
    const ordersDueToday = [...pendingOrders];
    let nextPendingOrders: PendingOrder[] = [];
    const rebalanceToday = isRebalanceDay(dayIndex, config.rebalanceIntervalDays);
    const { barCache, symbolParallelism } = dayCtx;

    if (config.executionMode === 'next_open') {
      const executed = await this.executePendingOrders(
        date,
        ordersDueToday,
        positions,
        cash,
        config,
        dayCtx
      );
      trades.push(...executed.trades);
      cash = executed.cash;
      nextPendingOrders = [...executed.remainingOrders];
    }

    const heldSymbols = [...positions.keys()];
    if (heldSymbols.length > 0) {
      await this.prefetchDayBars(heldSymbols, date, barCache);
    }
    for (const [symbol, position] of positions.entries()) {
      const bar = await this.getExactPriceBar(symbol, date, barCache);
      if (!bar) continue;

      const exit = this.determineIntradayExit(position, bar, config);
      if (exit) {
        const executedExit = await this.executeImmediateExit(
          symbol,
          date,
          bar.date,
          position,
          exit.rawPrice,
          exit.reason,
          cash,
          config
        );
        cash = executedExit.cash;
        trades.push(executedExit.trade);
        positions.delete(symbol);
      }
    }

    if (!rebalanceToday) {
      if (this.isDeferredExecutionMode(config.executionMode)) {
        const executed = await this.executePendingOrders(
          date,
          ordersDueToday,
          positions,
          cash,
          config,
          dayCtx
        );
        trades.push(...executed.trades);
        cash = executed.cash;
        nextPendingOrders = [...executed.remainingOrders, ...nextPendingOrders];
      }
      return { trades, cash, pendingOrders: nextPendingOrders };
    }

    const scheduledOrdersBase = this.isDeferredExecutionMode(config.executionMode)
      ? [...ordersDueToday, ...nextPendingOrders]
      : nextPendingOrders;

    const sellSymbols = [...positions.keys()].filter(
      (symbol) => !this.hasPendingOrder(scheduledOrdersBase, symbol, 'sell')
    );
    const buySymbols = symbols
      .map((s) => s.toUpperCase())
      .filter(
        (sym) =>
          !positions.has(sym) && !this.hasPendingOrder(scheduledOrdersBase, sym, 'buy')
      );

    await this.prefetchDayBars([...sellSymbols, ...buySymbols], date, barCache);

    const { signalCache, shouldPause } = dayCtx;
    const getCachedSignals = async (sym: string) => {
      const key = sym.toUpperCase();
      if (!signalCache.has(key)) {
        signalCache.set(key, await strategyEngine.gatherAllSignals(key, date));
      }
      return signalCache.get(key) ?? null;
    };
    const poolPauseOpts = {
      shouldAbort: async () => !!(shouldPause && (await shouldPause())),
    };

    try {
      const sellOrders = await mapPool(
        sellSymbols,
        symbolParallelism,
        async (symbol) => {
          const bar = await this.getExactPriceBar(symbol, date, barCache);
          if (!bar) return null;

          const signals = await getCachedSignals(symbol);
          const suggestion = await this.buildSuggestionForStrategy(
            symbol,
            date,
            config,
            signals
          );
          if (!suggestion) return null;
          this.captureSuggestionMetadata(strategyMetadata, suggestion);
          if (suggestion.signal === 'sell' || suggestion.signal === 'strong_sell') {
            return {
              symbol,
              side: 'sell' as const,
              reason: 'signal_exit' as const,
              conviction: suggestion.convictionScore,
              generatedDate: dateStr,
            };
          }
          return null;
        },
        poolPauseOpts
      );

      for (const order of sellOrders) {
        if (order) nextPendingOrders.push(order);
      }

      const buyOrders = await mapPool(
        buySymbols,
        symbolParallelism,
        async (sym) => {
          const bar = await this.getExactPriceBar(sym, date, barCache);
          if (!bar || bar.close <= 0) return null;

          const signals = await getCachedSignals(sym);
          if (!signals) return null;

          const suggestion = await this.buildSuggestionForStrategy(sym, date, config, signals);
          if (!suggestion) return null;
          this.captureSuggestionMetadata(strategyMetadata, suggestion);

          const isBullish =
            suggestion.signal === 'buy' || suggestion.signal === 'strong_buy';

          if (isBullish && suggestion.convictionScore >= config.convictionThreshold) {
            return {
              symbol: sym,
              side: 'buy' as const,
              reason: 'signal_entry' as const,
              conviction: suggestion.convictionScore,
              generatedDate: dateStr,
              suggestedPositionPct: suggestion.suggestedPositionPct,
              referenceEntryPrice: signals.entryPrice,
              stopLoss: signals.stopLoss,
              takeProfit: signals.takeProfit,
            };
          }
          return null;
        },
        poolPauseOpts
      );

      for (const order of buyOrders) {
        if (order) nextPendingOrders.push(order);
      }
    } catch (err) {
      if (err instanceof PoolAbortError) {
        throw new BacktestPauseRequested(dayIndex);
      }
      throw err;
    }

    if (this.isDeferredExecutionMode(config.executionMode)) {
      const executed = await this.executePendingOrders(
        date,
        ordersDueToday,
        positions,
        cash,
        config,
        dayCtx
      );
      trades.push(...executed.trades);
      cash = executed.cash;
      nextPendingOrders = [...executed.remainingOrders, ...nextPendingOrders];
    }

    return { trades, cash, pendingOrders: nextPendingOrders };
  }

  private async closeAllPositions(
    date: Date,
    positions: Map<string, OpenPosition>,
    cash: number,
    config: BacktestConfig
  ): Promise<{ trades: SimulatedTrade[]; cash: number }> {
    const trades: SimulatedTrade[] = [];
    const dateStr = date.toISOString().split('T')[0]!;

    for (const [symbol, position] of positions.entries()) {
      const bar = await this.getLatestPriceBarOnOrBefore(symbol, date);
      const price = bar?.close ?? position.entryPrice;
      const executedExit = await this.executeImmediateExit(
        symbol,
        date,
        bar?.date ?? dateStr,
        position,
        price,
        'end_of_period',
        cash,
        config
      );
      cash = executedExit.cash;
      trades.push(executedExit.trade);
    }

    positions.clear();
    return { trades, cash };
  }

  private async computePositionsValue(
    positions: Map<string, OpenPosition>,
    date: Date
  ): Promise<number> {
    let total = 0;
    for (const position of positions.values()) {
      const price =
        (await this.getPriceForDate(position.symbol, date)) ?? position.entryPrice;
      total += position.quantity * price;
    }
    return total;
  }

  private computeWinLoss(trades: SimulatedTrade[]): {
    winning: number;
    losing: number;
    winRatePct: number;
  } {
    const sells = trades.filter((t) => t.side === 'sell' && t.pnl !== undefined);
    const winning = sells.filter((t) => (t.pnl ?? 0) > 0).length;
    const losing = sells.filter((t) => (t.pnl ?? 0) <= 0).length;
    const total = winning + losing;
    const winRatePct =
      total > 0 ? parseFloat(((winning / total) * 100).toFixed(2)) : 0;
    return { winning, losing, winRatePct };
  }

  async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
    const outcome = await this.runBacktestResumable(config);
    if (outcome.status === 'paused') {
      throw new Error('Backtest paused unexpectedly');
    }
    return outcome.result;
  }

  async runBacktestResumable(
    config: BacktestConfig,
    options?: BacktestResumableOptions
  ): Promise<BacktestRunOutcome> {
    const tradingDays = this.getTradingDays(config.startDate, config.endDate);
    const resume = options?.resume;
    const positions = new Map<string, OpenPosition>(
      (resume?.positions ?? []).map((p) => [p.symbol, p])
    );
    let pendingOrders: PendingOrder[] = restorePendingOrders(resume?.pendingOrders ?? []);
    let cash = resume?.cash ?? config.initialCapital;
    const allTrades: SimulatedTrade[] = resume?.allTrades ? [...resume.allTrades] : [];
    const equityCurve: EquityPoint[] = resume?.equityCurve ? [...resume.equityCurve] : [];
    const strategyMetadata =
      resume?.strategyMetadata ?? this.createStrategyMetadata(config.strategy, config);
    if (!resume) {
      strategyMetadata.executionTiming = config.executionMode;
      strategyMetadata.slippageBps = config.slippageBps;
      strategyMetadata.commissionBps = config.commissionBps;
      strategyMetadata.rebalanceIntervalDays = config.rebalanceIntervalDays;
    }
    const startDayIndex = resume?.nextDayIndex ?? 0;
    const symbolParallelism = Math.max(
      1,
      Math.floor(config.symbolParallelism ?? defaultSymbolParallelism())
    );
    const dayCtx: BacktestDayContext = {
      barCache: new Map<string, PriceBar>(),
      signalCache: new Map(),
      symbolParallelism,
      ...(options?.shouldPause ? { shouldPause: options.shouldPause } : {}),
    };

    console.log(
      `Backtest: ${config.strategy} | ${config.symbols.length} symbols | ` +
        `${config.startDate} -> ${config.endDate} | ${tradingDays.length} trading days | ` +
        `symbolParallelism=${symbolParallelism}` +
        (resume ? ` | resume day ${startDayIndex + 1}` : '')
    );

    if (
      !resume &&
      (config.strategy === 'ml_baseline' || config.strategy === 'hybrid_baseline')
    ) {
      await strategyMlStrategyService.prewarmModelSnapshots(
        config.symbols,
        config.startDate,
        config.endDate,
        config.mlConfig,
        config.onActivity
      );
    }

    let lastReportedPct = -1;
    let lastReportedDay = -1;
    const totalDays = tradingDays.length;
    const symbolCount = config.symbols.length;
    const minDayGap =
      symbolCount >= 200 ? 1 : symbolCount >= 80 ? 2 : Math.max(1, Math.floor(totalDays * 0.05));

    if (config.onProgress && totalDays > 0) {
      if (startDayIndex === 0) {
        config.onProgress({
          strategy: config.strategy,
          dayIndex: 0,
          totalDays,
          date: tradingDays[0]!.toISOString().split('T')[0]!,
          tradesSoFar: 0,
          equity: config.initialCapital,
          pctComplete: 0,
          symbolCount,
        });
      } else if (resume) {
        const resumeDay = Math.min(startDayIndex, totalDays - 1);
        const lastPoint = resume.equityCurve[resume.equityCurve.length - 1];
        config.onProgress({
          strategy: config.strategy,
          dayIndex: resumeDay,
          totalDays,
          date: tradingDays[resumeDay]!.toISOString().split('T')[0]!,
          tradesSoFar: resume.allTrades.length,
          equity: lastPoint?.equity ?? config.initialCapital,
          pctComplete: (resumeDay / totalDays) * 100,
          symbolCount,
        });
      }
    }

    for (let dayIndex = startDayIndex; dayIndex < tradingDays.length; dayIndex++) {
      if (options?.shouldPause && (await options.shouldPause())) {
        return {
          status: 'paused',
          resume: buildResumeState(
            dayIndex,
            cash,
            positions,
            pendingOrders,
            allTrades,
            equityCurve,
            strategyMetadata
          ),
        };
      }

      const date = tradingDays[dayIndex]!;
      dayCtx.barCache.clear();
      dayCtx.signalCache.clear();

      try {
        const dayOutcome = await this.processDay(
          dayIndex,
          date,
          config.symbols,
          positions,
          pendingOrders,
          cash,
          config,
          strategyMetadata,
          dayCtx
        );
        cash = dayOutcome.cash;
        pendingOrders = dayOutcome.pendingOrders;
        allTrades.push(...dayOutcome.trades);
      } catch (err) {
        if (err instanceof BacktestPauseRequested || err instanceof PoolAbortError) {
          return {
            status: 'paused',
            resume: buildResumeState(
              dayIndex,
              cash,
              positions,
              pendingOrders,
              allTrades,
              equityCurve,
              strategyMetadata
            ),
          };
        }
        throw err;
      }

      const positionsValue = await this.computePositionsValue(positions, date);
      const equity = cash + positionsValue;
      equityCurve.push({
        date: date.toISOString().split('T')[0]!,
        equity,
        cash,
        positionsValue,
      });

      if (config.onProgress && totalDays > 0) {
        const pctComplete = ((dayIndex + 1) / totalDays) * 100;
        const minPctDelta = symbolCount >= 200 ? 0.5 : symbolCount >= 80 ? 1 : 5;
        const shouldReport =
          dayIndex === totalDays - 1 ||
          dayIndex - lastReportedDay >= minDayGap ||
          pctComplete - lastReportedPct >= minPctDelta;
        if (shouldReport) {
          lastReportedPct = pctComplete;
          lastReportedDay = dayIndex;
          config.onProgress({
            strategy: config.strategy,
            dayIndex,
            totalDays,
            date: date.toISOString().split('T')[0]!,
            tradesSoFar: allTrades.length,
            equity,
            pctComplete,
            symbolCount,
          });
          if (options?.onPeriodicCheckpoint) {
            await options.onPeriodicCheckpoint(
              buildResumeState(
                dayIndex + 1,
                cash,
                positions,
                pendingOrders,
                allTrades,
                equityCurve,
                strategyMetadata
              )
            );
          }
        }
      }
    }

    const lastDay = tradingDays[tradingDays.length - 1];
    if (lastDay && positions.size > 0) {
      const { trades: closeTrades, cash: finalCash } = await this.closeAllPositions(
        lastDay,
        positions,
        cash,
        config
      );
      cash = finalCash;
      allTrades.push(...closeTrades);

      const last = equityCurve[equityCurve.length - 1];
      if (last) {
        last.cash = finalCash;
        last.positionsValue = 0;
        last.equity = finalCash;
      }
    }

    const finalEquity = cash;
    const totalReturn = finalEquity - config.initialCapital;
    const totalReturnPct = parseFloat(
      ((totalReturn / config.initialCapital) * 100).toFixed(4)
    );
    const { winning, losing, winRatePct } = this.computeWinLoss(allTrades);

    let peak = config.initialCapital;
    let maxDrawdownPct = 0;
    for (const point of equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const drawdown = ((peak - point.equity) / peak) * 100;
      if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown;
    }

    console.log(
      `Backtest complete: return ${totalReturnPct}%, ` +
        `${allTrades.length} trades, win rate ${winRatePct}%`
    );

    return {
      status: 'complete',
      result: {
        config,
        trades: allTrades,
        equityCurve,
        finalEquity,
        totalReturn,
        totalReturnPct,
        totalTrades: allTrades.filter((t) => t.side === 'sell').length,
        winningTrades: winning,
        losingTrades: losing,
        winRatePct,
        maxDrawdownPct: parseFloat(maxDrawdownPct.toFixed(4)),
        sharpeRatio: 0,
        sortinoRatio: 0,
        annualizedReturnPct: 0,
        strategyMetadata,
      },
    };
  }
}

export const strategyBacktester = new StrategyBacktester();
