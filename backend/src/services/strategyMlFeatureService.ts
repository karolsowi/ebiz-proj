import { mapPool } from '../utils/asyncPool.js';
import { priceService } from './databaseService.js';
import { defaultSymbolParallelism } from './backtestParallelism.js';
import { computeEvaluationTargetDate } from './suggestionEvaluator.js';
import { strategyEngine, type RawSignals } from './strategyEngine.js';

const MAX_LOOKBACK_CALENDAR_DAYS = 200;
const LABEL_PRICE_LOOKAHEAD_DAYS = 5;

export interface MlPriceLookbackFeatures {
  trailingReturn5d: number;
  trailingReturn20d: number;
  trailingReturn60d: number;
  volatility20d: number;
  distanceFromHigh20d: number;
  distanceFromLow20d: number;
}

export interface StrategyMlFeatureValues extends MlPriceLookbackFeatures {
  taScore: number;
  taTrend: number;
  taMomentum: number;
  volumeAnalysis: number;
  supportProximity: number;
  patternScore: number;
  atrPct: number;
  redditSentiment: number;
  redditTrendScore: number;
  redditMentionsLog1p: number;
  redditCoveragePct: number;
  newsSentiment: number;
  newsMentionsLog1p: number;
  newsCoveragePct: number;
  sectorSentiment: number;
  sectorCoveragePct: number;
  calendarCatalystScore: number;
  daysToEarningsNormalized: number;
  catalystObserved: number;
}

export interface StrategyMlLabel {
  targetDate: string;
  observedDate: string | null;
  futurePrice: number | null;
  forwardReturnPct: number | null;
  hasLabel: boolean;
}

export interface StrategyMlFeatureRow {
  symbol: string;
  asOfDate: string;
  horizonDays: number;
  currentPrice: number;
  features: StrategyMlFeatureValues;
  label: StrategyMlLabel;
}

function toDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function computePctChange(
  startPrice: number,
  endPrice: number
): number {
  if (!Number.isFinite(startPrice) || !Number.isFinite(endPrice) || startPrice <= 0) {
    return 0;
  }
  return ((endPrice - startPrice) / startPrice) * 100;
}

function round(value: number, digits = 4): number {
  return parseFloat(value.toFixed(digits));
}

function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function getNthFromEnd(values: number[], sessions: number): number | null {
  const index = values.length - 1 - sessions;
  if (index < 0 || index >= values.length) return null;
  return values[index] ?? null;
}

export function computePriceLookbackFeatures(
  closes: number[],
  currentPrice: number
): MlPriceLookbackFeatures {
  const safeCurrentPrice =
    Number.isFinite(currentPrice) && currentPrice > 0
      ? currentPrice
      : closes[closes.length - 1] ?? 0;

  const trailingReturn5d = (() => {
    const start = getNthFromEnd(closes, 5);
    return start !== null ? round(computePctChange(start, safeCurrentPrice)) : 0;
  })();

  const trailingReturn20d = (() => {
    const start = getNthFromEnd(closes, 20);
    return start !== null ? round(computePctChange(start, safeCurrentPrice)) : 0;
  })();

  const trailingReturn60d = (() => {
    const start = getNthFromEnd(closes, 60);
    return start !== null ? round(computePctChange(start, safeCurrentPrice)) : 0;
  })();

  const recent20 = closes.slice(-20);
  const volatility20d = (() => {
    if (recent20.length < 2) return 0;
    const returns: number[] = [];
    for (let i = 1; i < recent20.length; i++) {
      const prev = recent20[i - 1]!;
      const curr = recent20[i]!;
      if (prev > 0) returns.push((curr - prev) / prev);
    }
    return round(computeStdDev(returns));
  })();

  const high20 = recent20.length > 0 ? Math.max(...recent20) : safeCurrentPrice;
  const low20 = recent20.length > 0 ? Math.min(...recent20) : safeCurrentPrice;
  const distanceFromHigh20d =
    high20 > 0 ? round((safeCurrentPrice - high20) / high20) : 0;
  const distanceFromLow20d =
    low20 > 0 ? round((safeCurrentPrice - low20) / low20) : 0;

  return {
    trailingReturn5d,
    trailingReturn20d,
    trailingReturn60d,
    volatility20d,
    distanceFromHigh20d,
    distanceFromLow20d,
  };
}

function getCoveragePct(
  signals: RawSignals,
  key: keyof NonNullable<RawSignals['coverage']>
): number {
  const value = signals.coverage?.[key]?.coveragePct ?? 0;
  return round(Math.max(0, Math.min(1, value)));
}

function normalizeDaysToEarnings(daysToEarnings: number | null): number {
  if (daysToEarnings === null || daysToEarnings <= 0) return 0;
  return round(Math.max(0, Math.min(1, (31 - daysToEarnings) / 30)));
}

export function buildMlFeatureValues(
  signals: RawSignals,
  priceFeatures: MlPriceLookbackFeatures
): StrategyMlFeatureValues {
  const currentPrice = signals.currentPrice > 0 ? signals.currentPrice : 1;

  return {
    ...priceFeatures,
    taScore: round(signals.taScore),
    taTrend: round(signals.taTrend),
    taMomentum: round(signals.taMomentum),
    volumeAnalysis: round(signals.volumeAnalysis),
    supportProximity: round(signals.supportProximity),
    patternScore: round(signals.patternScore),
    atrPct: round(signals.atr14 / currentPrice),
    redditSentiment: round(signals.redditSentiment),
    redditTrendScore: round(signals.redditTrendScore),
    redditMentionsLog1p: round(Math.log1p(Math.max(0, signals.redditMentions))),
    redditCoveragePct: getCoveragePct(signals, 'reddit_sentiment'),
    newsSentiment: round(signals.newsSentiment),
    newsMentionsLog1p: round(Math.log1p(Math.max(0, signals.newsMentions))),
    newsCoveragePct: getCoveragePct(signals, 'news_sentiment'),
    sectorSentiment: round(signals.sectorSentiment),
    sectorCoveragePct: getCoveragePct(signals, 'sector_sentiment'),
    calendarCatalystScore: round(signals.calendarCatalystScore),
    daysToEarningsNormalized: normalizeDaysToEarnings(signals.daysToEarnings),
    catalystObserved: signals.daysToEarnings !== null ? 1 : 0,
  };
}

export class StrategyMlFeatureService {
  async buildFeatureRowFromSignals(
    signals: RawSignals,
    asOfDate: Date,
    options?: { horizonDays?: number; includeLabel?: boolean }
  ): Promise<StrategyMlFeatureRow | null> {
    const normalizedSymbol = signals.symbol.toUpperCase();
    const horizonDays = Math.max(1, Math.floor(options?.horizonDays ?? 5));
    const includeLabel = options?.includeLabel !== false;

    const lookbackStart = new Date(asOfDate);
    lookbackStart.setUTCDate(lookbackStart.getUTCDate() - MAX_LOOKBACK_CALENDAR_DAYS);

    const lookbackRows = await priceService.getPriceHistory(
      normalizedSymbol,
      lookbackStart,
      asOfDate,
      'daily'
    );

    const closes = lookbackRows
      .map((row) => ({
        date: new Date(row.date),
        close: parseFloat(String(row.close)),
      }))
      .filter((row) => Number.isFinite(row.close))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((row) => row.close);

    const priceFeatures = computePriceLookbackFeatures(closes, signals.currentPrice);
    const targetDate = computeEvaluationTargetDate(asOfDate, horizonDays);

    if (!includeLabel) {
      return {
        symbol: normalizedSymbol,
        asOfDate: toDayString(asOfDate),
        horizonDays,
        currentPrice: round(signals.currentPrice, 8),
        features: buildMlFeatureValues(signals, priceFeatures),
        label: {
          targetDate: toDayString(targetDate),
          observedDate: null,
          futurePrice: null,
          forwardReturnPct: null,
          hasLabel: false,
        },
      };
    }

    const futureRows = await priceService.getPriceOnOrAfter(
      normalizedSymbol,
      targetDate,
      'daily',
      LABEL_PRICE_LOOKAHEAD_DAYS
    );

    const futureRow = futureRows[0];
    const futurePrice = futureRow ? parseFloat(String(futureRow.close)) : null;
    const observedDate = futureRow ? toDayString(new Date(futureRow.date)) : null;
    const forwardReturnPct =
      futurePrice !== null
        ? round(computePctChange(signals.currentPrice, futurePrice))
        : null;

    return {
      symbol: normalizedSymbol,
      asOfDate: toDayString(asOfDate),
      horizonDays,
      currentPrice: round(signals.currentPrice, 8),
      features: buildMlFeatureValues(signals, priceFeatures),
      label: {
        targetDate: toDayString(targetDate),
        observedDate,
        futurePrice: futurePrice !== null ? round(futurePrice, 8) : null,
        forwardReturnPct,
        hasLabel: futurePrice !== null,
      },
    };
  }

  async buildFeatureRow(
    symbol: string,
    asOfDate: Date,
    options?: { horizonDays?: number }
  ): Promise<StrategyMlFeatureRow | null> {
    const normalizedSymbol = symbol.toUpperCase();
    const signals = await strategyEngine.gatherAllSignals(normalizedSymbol, asOfDate);
    if (!signals) return null;

    return this.buildFeatureRowFromSignals(signals, asOfDate, options);
  }

  async buildFeatureRows(
    symbols: string[],
    asOfDates: Date[],
    options?: { horizonDays?: number; concurrency?: number }
  ): Promise<StrategyMlFeatureRow[]> {
    const tasks: Array<{ symbol: string; asOfDate: Date }> = [];
    for (const asOfDate of asOfDates) {
      for (const symbol of symbols) {
        tasks.push({ symbol, asOfDate });
      }
    }

    const concurrency = Math.max(
      1,
      Math.floor(options?.concurrency ?? defaultSymbolParallelism())
    );

    const built = await mapPool(tasks, concurrency, async ({ symbol, asOfDate }) =>
      this.buildFeatureRow(symbol, asOfDate, options)
    );

    return built.filter((row): row is StrategyMlFeatureRow => row != null);
  }
}

export const strategyMlFeatureService = new StrategyMlFeatureService();
