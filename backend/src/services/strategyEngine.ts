import { db } from '../db/connection.js';
import { desc, gte, and, eq, sql } from 'drizzle-orm';
import {
  sentimentScores,
  strategySuggestions,
  suggestionSignals,
} from '../db/schema.js';
import { technicalAnalysisService } from './technicalAnalysisService.js';
import { priceService } from './databaseService.js';
import { stockSectorDetectionService } from './stockSectorDetectionService.js';
import {
  buildDefaultPointInTimeUniverseSelection,
  researchUniverseService,
  type ResearchUniverseDiagnostics,
  type ResearchUniverseSelection,
} from './researchUniverseService.js';
import {
  earningsEventService,
  scoreCalendarCatalyst,
} from './earningsEventService.js';
// ─── Types ────────────────────────────────────────────────────────────────────

export type StrategyName =
  | 'social_momentum'
  | 'fundamental_flow'
  | 'full_spectrum'
  | 'ml_baseline'
  | 'hybrid_baseline';

export type RuleBasedStrategyName =
  | 'social_momentum'
  | 'fundamental_flow'
  | 'full_spectrum';

export const RULE_BASED_STRATEGIES: RuleBasedStrategyName[] = [
  'social_momentum',
  'fundamental_flow',
  'full_spectrum',
];

export const EXECUTION_STRATEGIES: StrategyName[] = [
  ...RULE_BASED_STRATEGIES,
  'ml_baseline',
  'hybrid_baseline',
];

export type SignalLabel =
  | 'strong_buy'
  | 'buy'
  | 'hold'
  | 'sell'
  | 'strong_sell';

export type StrategySignalKey =
  | 'reddit_sentiment'
  | 'reddit_trend'
  | 'news_sentiment'
  | 'calendar_catalyst'
  | 'ta_trend'
  | 'ta_momentum'
  | 'volume_analysis'
  | 'support_proximity'
  | 'pattern_recognition'
  | 'sector_sentiment';

export interface SignalCoverageInfo {
  observed: boolean;
  observations: number;
  coveragePct: number;
  latestObservationDate: string | null;
}

export type SignalCoverageMap = Partial<Record<StrategySignalKey, SignalCoverageInfo>>;

interface SentimentWindowRow {
  date: Date | string | null;
  totalMentions: number | null;
  weightedSentiment: string | null;
  averageSentiment: string | null;
}

export interface AggregatedSentimentWindow {
  sentiment: number;
  mentions: number;
  observationCount: number;
  coveragePct: number;
  latestObservationDate: string | null;
  hasData: boolean;
}

const SENTIMENT_WINDOW_DAYS = 7;
const REDDIT_TREND_MENTION_CAP = 50;

function parseSentimentValue(value: string | null | undefined): number {
  const parsed = value !== null && value !== undefined ? parseFloat(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDayKey(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function aggregateSentimentWindowRows(
  rows: ReadonlyArray<SentimentWindowRow>,
  windowDays: number = SENTIMENT_WINDOW_DAYS
): AggregatedSentimentWindow {
  if (rows.length === 0) {
    return {
      sentiment: 0,
      mentions: 0,
      observationCount: 0,
      coveragePct: 0,
      latestObservationDate: null,
      hasData: false,
    };
  }

  let totalMentions = 0;
  let weightedSentimentSum = 0;
  let weightedRows = 0;
  let fallbackSentimentSum = 0;
  let fallbackRows = 0;
  const observedDays = new Set<string>();

  for (const row of rows) {
    const mentions = Math.max(0, row.totalMentions ?? 0);
    const sentiment = parseSentimentValue(
      row.weightedSentiment ?? row.averageSentiment ?? '0'
    );

    totalMentions += mentions;
    if (mentions > 0) {
      weightedSentimentSum += sentiment * mentions;
      weightedRows += mentions;
    } else {
      fallbackSentimentSum += sentiment;
      fallbackRows += 1;
    }

    const dayKey = toDayKey(row.date);
    if (dayKey) observedDays.add(dayKey);
  }

  let aggregatedSentiment = 0;
  if (weightedRows > 0) {
    aggregatedSentiment = weightedSentimentSum / weightedRows;
  } else if (fallbackRows > 0) {
    aggregatedSentiment = fallbackSentimentSum / fallbackRows;
  }

  const latestObservationDate =
    observedDays.size > 0 ? Array.from(observedDays).sort().at(-1) ?? null : null;
  const coveragePct = Math.max(
    0,
    Math.min(1, observedDays.size / Math.max(1, windowDays))
  );

  return {
    sentiment: parseFloat(aggregatedSentiment.toFixed(4)),
    mentions: totalMentions,
    observationCount: rows.length,
    coveragePct: parseFloat(coveragePct.toFixed(4)),
    latestObservationDate,
    hasData: true,
  };
}

export function normalizeUniverseSymbols(symbols: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const symbol of symbols) {
    const candidate = symbol.trim().toUpperCase();
    if (
      candidate.length < 1 ||
      candidate.length > 10 ||
      candidate.includes(' ') ||
      seen.has(candidate)
    ) {
      continue;
    }

    seen.add(candidate);
    normalized.push(candidate);
  }

  return normalized;
}

export function isRuleBasedStrategy(
  strategy: StrategyName
): strategy is RuleBasedStrategyName {
  return RULE_BASED_STRATEGIES.includes(strategy as RuleBasedStrategyName);
}

export function buildSuggestionEngineVersion(
  suggestion: StrategySuggestion
): string {
  const modelVersion = Object.values(suggestion.breakdown)
    .map((value) => value.meta?.modelVersion)
    .find((value): value is string => typeof value === 'string' && value.length > 0);

  return modelVersion ? `v2:${modelVersion}` : 'v2';
}

/**
 * All raw signal values for one symbol at one point in time.
 * All numeric fields are normalized to their natural range before scoring.
 */
export interface RawSignals {
  symbol: string;
  currentPrice: number;

  // Reddit signals
  redditSentiment: number;     // -1 .. 1 (weighted average sentiment)
  redditMentions: number;      // raw count over last 7 days
  redditTrendScore: number;    // 0 .. 1 (normalized: 50 mentions = 1.0)

  // News signals
  newsSentiment: number;       // -1 .. 1 (weighted average sentiment)
  newsMentions: number;        // raw count over last 7 days

  // Technical signals (extracted from TechnicalAnalysisService output)
  taScore: number;             // -1 .. 1 (overall weighted TA score)
  taSignal: string;            // 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell'
  taTrend: number;             // -1 .. 1 (average of SMA20, SMA50, EMA21 buy/sell signals)
  taMomentum: number;          // -1 .. 1 (derived from RSI: oversold=+1, overbought=-1)
  volumeAnalysis: number;      // -1 .. 1 (OBV signal mapped to -0.5/0/+0.5)
  supportProximity: number;    // -1 .. 1 (how close price is to nearest support)
  patternScore: number;        // -1 .. 1 (sum of bullish/bearish pattern weights, capped)

  // Calendar signals
  daysToEarnings: number | null;       // null = no earnings data found
  calendarCatalystScore: number;       // 0 .. 1 (tier-based scoring from daysToEarnings)

  // Sector sentiment
  sectorSentiment: number;     // -1 .. 1 (news_sector sentiment for symbol's sector)

  // Price targets (from Phase 2 method)
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  atr14: number;

  // Optional-source coverage metadata used to distinguish "missing" from "neutral"
  coverage?: SignalCoverageMap;
}

/**
 * One completed suggestion: symbol + strategy + signal + breakdown + price targets.
 * Three of these are produced per symbol (one per strategy) on each engine run.
 */
export interface StrategySuggestion {
  symbol: string;
  strategy: StrategyName;
  signal: SignalLabel;
  convictionScore: number;        // 0 .. 1
  convictionPct: number;          // 0 .. 100
  signals: RawSignals;
  breakdown: Record<string, {
    raw: number;
    normalized: number;
    weight: number;
    contribution: number;
    observed?: boolean;
    observations?: number;
    coveragePct?: number;
    latestObservationDate?: string | null;
    meta?: Record<string, unknown>;
  }>;
  suggestedPositionPct: number;   // 1.0 .. 10.0
}

/**
 * Signal weights for each strategy.
 * All weights within one strategy must sum to exactly 1.0.
 *
 * Derived from VISION.md investment strategy definitions:
 * - social_momentum:  driven by Reddit crowd behaviour + TA timing
 * - fundamental_flow: driven by news + upcoming catalysts + TA
 * - full_spectrum:    all signals combined with balanced weights
 */
const WEIGHTS: Record<RuleBasedStrategyName, Record<string, number>> = {
  social_momentum: {
    reddit_sentiment:  0.35,
    reddit_trend:      0.20,
    ta_trend:          0.20,
    ta_momentum:       0.15,
    support_proximity: 0.10,
  },
  fundamental_flow: {
    news_sentiment:    0.30,
    calendar_catalyst: 0.20,
    ta_trend:          0.20,
    ta_momentum:       0.15,
    volume_analysis:   0.15,
  },
  full_spectrum: {
    reddit_sentiment:    0.15,
    reddit_trend:        0.10,
    news_sentiment:      0.15,
    calendar_catalyst:   0.10,
    ta_trend:            0.15,
    ta_momentum:         0.10,
    volume_analysis:     0.10,
    pattern_recognition: 0.10,
    sector_sentiment:    0.05,
  },
} as const;

/**
 * Maps each weight key name to its corresponding value from RawSignals.
 *
 * IMPORTANT: signals that are naturally 0..1 (redditTrendScore, calendarCatalystScore)
 * keep 0 as neutral and 1 as maximally bullish. Missing optional data is treated
 * separately through coverage metadata instead of being forced into a bearish value.
 *
 * Examples:
 *   redditTrendScore = 0.0  →  0.0 (no observed trend = neutral)
 *   redditTrendScore = 0.5  → +0.5 (moderate mentions = mildly bullish)
 *   redditTrendScore = 1.0  → +1.0 (high mentions = bullish trend signal)
 *
 *   calendarCatalystScore = 0.8 → +0.8 (earnings in 7 days = positive catalyst)
 *   calendarCatalystScore = 0.0 →  0.0 (no near catalyst = neutral)
 */
function buildSignalMap(signals: RawSignals): Record<string, number> {
  return {
    reddit_sentiment:    signals.redditSentiment,
    reddit_trend:        signals.redditTrendScore,
    news_sentiment:      signals.newsSentiment,
    calendar_catalyst:   signals.calendarCatalystScore,
    ta_trend:            signals.taTrend,
    ta_momentum:         signals.taMomentum,
    volume_analysis:     signals.volumeAnalysis,
    support_proximity:   signals.supportProximity,
    pattern_recognition: signals.patternScore,
    sector_sentiment:    signals.sectorSentiment,
  };
}

// ─── Engine class ─────────────────────────────────────────────────────────────

export class StrategyEngine {

  private buildCoverage(
    observed: boolean,
    observations: number,
    coveragePct: number,
    latestObservationDate: string | null
  ): SignalCoverageInfo {
    return {
      observed,
      observations: Math.max(0, observations),
      coveragePct: Math.max(0, Math.min(1, coveragePct)),
      latestObservationDate,
    };
  }

  private buildPointCoverage(
    observed: boolean,
    asOfDate: Date,
    observationDate?: string | null
  ): SignalCoverageInfo {
    return this.buildCoverage(
      observed,
      observed ? 1 : 0,
      observed ? 1 : 0,
      observed ? (observationDate ?? asOfDate.toISOString().slice(0, 10)) : null
    );
  }

  private async gatherSentimentWindow(
    symbol: string,
    source: 'reddit' | 'news' | 'news_sector',
    asOfDate: Date
  ): Promise<AggregatedSentimentWindow> {
    const since = new Date(asOfDate.getTime() - SENTIMENT_WINDOW_DAYS * 86_400_000);

    const rows = await db
      .select({
        date: sentimentScores.date,
        totalMentions: sentimentScores.totalMentions,
        weightedSentiment: sentimentScores.weightedSentiment,
        averageSentiment: sentimentScores.averageSentiment,
      })
      .from(sentimentScores)
      .where(and(
        eq(sentimentScores.symbol, symbol.toUpperCase()),
        eq(sentimentScores.source, source),
        gte(sentimentScores.date, since),
        sql`${sentimentScores.date} <= ${asOfDate}`
      ));

    return aggregateSentimentWindowRows(rows);
  }

  // ── Phase 3 methods (signal gathering) ─────────────────────────────────────

  private async gatherRedditSignals(
    symbol: string,
    asOfDate: Date
  ): Promise<{
    sentiment: number;
    mentions: number;
    trendScore: number;
    coverage: SignalCoverageInfo;
  }> {
    const window = await this.gatherSentimentWindow(symbol, 'reddit', asOfDate);

    return {
      sentiment: window.sentiment,
      mentions: window.mentions,
      trendScore: window.hasData
        ? Math.min(1, window.mentions / REDDIT_TREND_MENTION_CAP)
        : 0,
      coverage: this.buildCoverage(
        window.hasData,
        window.observationCount,
        window.coveragePct,
        window.latestObservationDate
      ),
    };
  }

  private async gatherNewsSignals(
    symbol: string,
    asOfDate: Date
  ): Promise<{
    sentiment: number;
    mentions: number;
    coverage: SignalCoverageInfo;
  }> {
    const window = await this.gatherSentimentWindow(symbol, 'news', asOfDate);

    return {
      sentiment: window.sentiment,
      mentions: window.mentions,
      coverage: this.buildCoverage(
        window.hasData,
        window.observationCount,
        window.coveragePct,
        window.latestObservationDate
      ),
    };
  }

  private async gatherCalendarSignals(
    symbol: string,
    asOfDate: Date
  ): Promise<{
    daysToEarnings: number | null;
    catalystScore: number;
    coverage: SignalCoverageInfo;
  }> {
    let nextEvent = await earningsEventService.getNextEarningsEvent(
      symbol,
      asOfDate
    );

    if (!nextEvent) {
      await earningsEventService.ensureRecentSymbolCoverage(symbol, asOfDate);
      nextEvent = await earningsEventService.getNextEarningsEvent(symbol, asOfDate);
    }

    const daysToEarnings = nextEvent?.daysToEarnings ?? null;
    const catalystScore = scoreCalendarCatalyst(daysToEarnings);

    return {
      daysToEarnings,
      catalystScore,
      coverage: this.buildPointCoverage(
        nextEvent !== null,
        asOfDate,
        nextEvent?.eventDate ?? null
      ),
    };
  }

  private async gatherTASignals(
    symbol: string,
    currentPrice: number,
    asOfDate: Date
  ): Promise<{
    taScore: number;
    taSignal: string;
    taTrend: number;
    taMomentum: number;
    volumeAnalysis: number;
    supportProximity: number;
    patternScore: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    atr14: number;
  }> {
    const zero = {
      taScore: 0, taSignal: 'Neutral', taTrend: 0, taMomentum: 0,
      volumeAnalysis: 0, supportProximity: 0, patternScore: 0,
      entryPrice: currentPrice,
      stopLoss: parseFloat((currentPrice * 0.95).toFixed(8)),
      takeProfit: parseFloat((currentPrice * 1.05).toFixed(8)),
      atr14: 0,
    };

    try {
      const indicators = await technicalAnalysisService.analyzeSymbol(symbol, 'daily', asOfDate);
      if (!indicators) return zero;

      const sigToNum = (s: string) =>
        s === 'buy' ? 1 : s === 'sell' ? -1 : 0;

      const taTrend = (
        sigToNum(indicators.sma20.signal) +
        sigToNum(indicators.sma50.signal) +
        sigToNum(indicators.ema21.signal)
      ) / 3;

      const rsi = indicators.rsi14.value;
      let taMomentum = 0;
      if (rsi < 30) taMomentum = (30 - rsi) / 30;
      else if (rsi > 70) taMomentum = -(rsi - 70) / 30;

      const volumeAnalysis = sigToNum(indicators.obv.signal) * 0.5;

      const supports = indicators.supportResistanceLevels
        .filter(l => l.type === 'support' && l.price < currentPrice)
        .sort((a, b) => b.price - a.price);
      let supportProximity = 0;
      if (supports.length > 0) {
        const gap = (currentPrice - supports[0]!.price) / currentPrice;
        supportProximity = Math.max(-1, Math.min(1, 1 - gap * 10));
      }

      let patternScore = 0;
      for (const p of indicators.detectedPatterns) {
        if (p.type === 'bullish') patternScore += 0.3;
        if (p.type === 'bearish') patternScore -= 0.3;
      }
      patternScore = Math.max(-1, Math.min(1, patternScore));

      const targets = technicalAnalysisService.getEntryStopTarget(
        indicators,
        currentPrice
      );

      return {
        taScore: indicators.overallScore,
        taSignal: indicators.overallSignal,
        taTrend,
        taMomentum,
        volumeAnalysis,
        supportProximity,
        patternScore,
        entryPrice: targets.entry,
        stopLoss: targets.stopLoss,
        takeProfit: targets.takeProfit,
        atr14: indicators.atr14,
      };
    } catch {
      return zero;
    }
  }

  private async gatherSectorSignals(
    symbol: string,
    asOfDate: Date
  ): Promise<{ sentiment: number; coverage: SignalCoverageInfo }> {
    try {
      const info = stockSectorDetectionService.getStockInfo(symbol.toUpperCase());
      if (!info?.sector) {
        return {
          sentiment: 0,
          coverage: this.buildCoverage(false, 0, 0, null),
        };
      }

      const sectorKey = info.sector.toUpperCase().replace(/\s+/g, '_');
      const window = await this.gatherSentimentWindow(
        sectorKey,
        'news_sector',
        asOfDate
      );

      return {
        sentiment: window.sentiment,
        coverage: this.buildCoverage(
          window.hasData,
          window.observationCount,
          window.coveragePct,
          window.latestObservationDate
        ),
      };
    } catch {
      return {
        sentiment: 0,
        coverage: this.buildCoverage(false, 0, 0, null),
      };
    }
  }

  async gatherAllSignals(
    symbol: string,
    asOfDate: Date = new Date()
  ): Promise<RawSignals | null> {
    const priceRows = await priceService.getPriceHistory(
      symbol.toUpperCase(),
      undefined,
      asOfDate,
      'daily'
    );
    if (priceRows.length === 0) return null;
    const currentPrice = parseFloat(String(priceRows[0]!.close));

    const [reddit, news, ta, calendar, sector] = await Promise.all([
      this.gatherRedditSignals(symbol, asOfDate),
      this.gatherNewsSignals(symbol, asOfDate),
      this.gatherTASignals(symbol, currentPrice, asOfDate),
      this.gatherCalendarSignals(symbol, asOfDate),
      this.gatherSectorSignals(symbol, asOfDate),
    ]);

    return {
      symbol: symbol.toUpperCase(),
      currentPrice,
      redditSentiment: reddit.sentiment,
      redditMentions: reddit.mentions,
      redditTrendScore: reddit.trendScore,
      newsSentiment: news.sentiment,
      newsMentions: news.mentions,
      taScore: ta.taScore,
      taSignal: ta.taSignal,
      taTrend: ta.taTrend,
      taMomentum: ta.taMomentum,
      volumeAnalysis: ta.volumeAnalysis,
      supportProximity: ta.supportProximity,
      patternScore: ta.patternScore,
      daysToEarnings: calendar.daysToEarnings,
      calendarCatalystScore: calendar.catalystScore,
      sectorSentiment: sector.sentiment,
      entryPrice: ta.entryPrice,
      stopLoss: ta.stopLoss,
      takeProfit: ta.takeProfit,
      atr14: ta.atr14,
      coverage: {
        reddit_sentiment: reddit.coverage,
        reddit_trend: reddit.coverage,
        news_sentiment: news.coverage,
        calendar_catalyst: calendar.coverage,
        sector_sentiment: sector.coverage,
      },
    };
  }

  // ── Phase 4 methods (scoring) ───────────────────────────────────────────────

  /**
   * Core scoring function. Computes a weighted sum of normalized signals
   * for a specific strategy, then maps the result to a 0..1 conviction score.
   *
   * Algorithm:
   * 1. For each weight key in the strategy: look up signal value from signalMap
   * 2. Clamp signal to -1..1
   * 3. Multiply by weight → weighted contribution
   * 4. Sum all contributions → score in -1..1
   * 5. Map score to conviction: (score + 1) / 2 → 0..1
   *
   * Example for social_momentum:
   *   reddit_sentiment = 0.4,  weight = 0.35 → contribution = +0.140
   *   reddit_trend     = 0.2,  weight = 0.20 → contribution = +0.040
   *   ta_trend         = -0.1, weight = 0.20 → contribution = -0.020
   *   ta_momentum      = 0.0,  weight = 0.15 → contribution =  0.000
   *   support_proximity= 0.5,  weight = 0.10 → contribution = +0.050
   *   ─────────────────────────────────────────────────────────────────
   *   weightedSum = +0.210  →  conviction = (0.210 + 1) / 2 = 0.605  → 'buy'
   */
  private computeConviction(
    signals: RawSignals,
    strategy: RuleBasedStrategyName
  ): {
    score: number;
    conviction: number;
    breakdown: StrategySuggestion['breakdown'];
  } {
    const weights = WEIGHTS[strategy];
    const signalMap = buildSignalMap(signals);
    let weightedSum = 0;
    const breakdown: StrategySuggestion['breakdown'] = {};

    for (const [key, weight] of Object.entries(weights)) {
      const raw = signalMap[key] ?? 0;
      const normalized = Math.max(-1, Math.min(1, raw)); // clamp
      const contribution = normalized * weight;
      const coverage = signals.coverage?.[key as StrategySignalKey];
      const observed = coverage?.observed ?? true;
      weightedSum += contribution;
      breakdown[key] = {
        raw,
        normalized,
        weight,
        contribution,
        observed,
        observations: coverage?.observations ?? (observed ? 1 : 0),
        coveragePct: coverage?.coveragePct ?? (observed ? 1 : 0),
        latestObservationDate: coverage?.latestObservationDate ?? null,
      };
    }

    const score = Math.max(-1, Math.min(1, weightedSum));
    const conviction = (score + 1) / 2; // map -1..1 → 0..1

    return { score, conviction, breakdown };
  }

  /**
   * Maps a 0..1 conviction score to a signal label.
   *
   * Thresholds:
   *  ≥ 0.65 → strong_buy    (clear bullish consensus across signals)
   *  ≥ 0.55 → buy           (majority bullish)
   *  ≤ 0.25 → strong_sell   (clear bearish consensus)
   *  ≤ 0.35 → sell          (majority bearish)
   *  else   → hold          (mixed signals, 0.36..0.54 range)
   *
   * Note: these thresholds can be tuned without changing the scoring math.
   * For a more aggressive strategy, lower buy/strong_buy thresholds.
   * For a conservative strategy, raise them.
   */
  convictionToSignal(conviction: number): SignalLabel {
    if (conviction >= 0.65) return 'strong_buy';
    if (conviction >= 0.55) return 'buy';
    if (conviction <= 0.25) return 'strong_sell';
    if (conviction <= 0.35) return 'sell';
    return 'hold';
  }

  /**
   * Scales suggested position size by conviction.
   *
   * Formula:
   *   base = 5% of portfolio
   *   scaled = 5% × (conviction / 0.60)
   *   clamped to [1%, 10%]
   *
   * Examples:
   *   conviction = 0.60 → 5% × (0.60/0.60) = 5.00%
   *   conviction = 0.75 → 5% × (0.75/0.60) = 6.25%
   *   conviction = 0.90 → 5% × (0.90/0.60) = 7.50%
   *   conviction = 0.40 → 5% × (0.40/0.60) = 3.33% → clamped to min 1%? No: 3.33 > 1
   *   conviction = 0.10 → 5% × (0.10/0.60) = 0.83% → clamped to 1%
   */
  computePositionSize(conviction: number): number {
    const base = 5.0;
    const scaled = base * (conviction / 0.60);
    const clamped = Math.min(10.0, Math.max(1.0, scaled));
    return parseFloat(clamped.toFixed(2));
  }

  /**
   * Combines signal gathering output with conviction scoring to produce
   * a complete StrategySuggestion for one (symbol, strategy) pair.
   *
   * Called by:
   *  - runForSymbol()     (Phase 5) — for live engine runs
   *  - strategyBacktester (Phase 12) — for historical simulation
   */
  buildSuggestion(
    symbol: string,
    strategy: RuleBasedStrategyName,
    signals: RawSignals
  ): StrategySuggestion {
    const { conviction, breakdown } = this.computeConviction(signals, strategy);
    const signal = this.convictionToSignal(conviction);
    const suggestedPositionPct = this.computePositionSize(conviction);

    return {
      symbol:           symbol.toUpperCase(),
      strategy,
      signal,
      convictionScore:  parseFloat(conviction.toFixed(4)),
      convictionPct:    Math.round(conviction * 100),
      signals,
      breakdown,
      suggestedPositionPct,
    };
  }

  // ── Phase 5 methods (persistence + run) ────────────────────────────────────

  private async persistSuggestion(s: StrategySuggestion): Promise<number> {
    const sig = s.signals;

    const rows = await db
      .insert(strategySuggestions)
      .values({
        symbol: s.symbol,
        strategy: s.strategy,
        signal: s.signal,
        convictionScore: s.convictionScore.toFixed(4),
        convictionPct: s.convictionPct,
        redditSentiment: sig.redditSentiment.toFixed(4),
        redditMentions: sig.redditMentions,
        redditTrendScore: sig.redditTrendScore.toFixed(4),
        newsSentiment: sig.newsSentiment.toFixed(4),
        newsMentions: sig.newsMentions,
        taScore: sig.taScore.toFixed(4),
        taSignal: sig.taSignal,
        daysToEarnings: sig.daysToEarnings,
        calendarCatalystScore: sig.calendarCatalystScore.toFixed(4),
        currentPrice: sig.currentPrice.toFixed(8),
        entryPrice: sig.entryPrice.toFixed(8),
        stopLoss: sig.stopLoss.toFixed(8),
        takeProfit: sig.takeProfit.toFixed(8),
        suggestedPositionPct: s.suggestedPositionPct.toFixed(2),
        signalBreakdown: s.breakdown,
        horizonDays: 5,
        engineVersion: buildSuggestionEngineVersion(s),
      })
      .returning({ id: strategySuggestions.id });

    return rows[0]!.id;
  }

  private async persistSignalRows(
    suggestionId: number,
    breakdown: StrategySuggestion['breakdown']
  ): Promise<void> {
    const rows = Object.entries(breakdown).map(([signalName, v]) => ({
      suggestionId,
      signalName,
      rawValue: v.raw.toFixed(6),
      normalizedValue: v.normalized.toFixed(4),
      weight: v.weight.toFixed(4),
      weightedContribution: v.contribution.toFixed(4),
    }));

    if (rows.length > 0) {
      await db.insert(suggestionSignals).values(rows);
    }
  }

  private async buildExecutionSuggestions(
    symbol: string,
    signals: RawSignals,
    universeSymbols: string[],
    asOfDate: Date = new Date()
  ): Promise<StrategySuggestion[]> {
    const results: StrategySuggestion[] = [];

    for (const strategy of RULE_BASED_STRATEGIES) {
      results.push(this.buildSuggestion(symbol, strategy, signals));
    }

    const { strategyMlStrategyService } = await import('./strategyMlStrategyService.js');
    for (const strategy of ['ml_baseline', 'hybrid_baseline'] as const) {
      results.push(
        await strategyMlStrategyService.buildSuggestion(
          symbol,
          strategy,
          signals,
          asOfDate,
          universeSymbols
        )
      );
    }

    return results;
  }

  async runForSymbol(
    symbol: string,
    universeSymbols?: string[],
    asOfDate: Date = new Date()
  ): Promise<StrategySuggestion[]> {
    const asOfDay = asOfDate.toISOString().slice(0, 10);
    const symbols =
      universeSymbols ??
      (await this.discoverUniverse({
        methodology: 'static_current_constituents',
        asOfDate: asOfDay,
      })).symbols;
    const signals = await this.gatherAllSignals(symbol.toUpperCase(), asOfDate);
    if (!signals) {
      throw new Error(
        `No price data for ${symbol.toUpperCase()} — ensure historical_prices has data for this symbol`
      );
    }

    const suggestions = await this.buildExecutionSuggestions(
      symbol.toUpperCase(),
      signals,
      symbols,
      asOfDate
    );
    const results: StrategySuggestion[] = [];

    for (const suggestion of suggestions) {
      const id = await this.persistSuggestion(suggestion);
      await this.persistSignalRows(id, suggestion.breakdown);
      results.push(suggestion);
    }

    return results;
  }

  private async discoverUniverse(
    selection: ResearchUniverseSelection
  ): Promise<{ symbols: string[]; diagnostics: ResearchUniverseDiagnostics | null }> {
    const resolved = await researchUniverseService.resolveUniverse(selection);
    return {
      symbols: resolved.symbols,
      diagnostics: resolved.diagnostics,
    };
  }

  async runForUniverse(options?: {
    universeSelection?: ResearchUniverseSelection;
    asOfDate?: Date;
  }): Promise<{
    processed: number;
    skipped: number;
    errors: string[];
    universeDiagnostics: ResearchUniverseDiagnostics | null;
  }> {
    const asOfDate = options?.asOfDate ?? new Date();
    const asOfDay = asOfDate.toISOString().slice(0, 10);
    const selection: ResearchUniverseSelection = options?.universeSelection
      ? {
          ...options.universeSelection,
          asOfDate: options.universeSelection.asOfDate ?? asOfDay,
        }
      : buildDefaultPointInTimeUniverseSelection(asOfDay);

    const resolvedUniverse = await this.discoverUniverse(selection);
    const symbols = resolvedUniverse.symbols;
    const result = {
      processed: 0,
      skipped: 0,
      errors: [] as string[],
      universeDiagnostics: resolvedUniverse.diagnostics,
    };

    console.log(`🧠 Strategy engine: processing ${symbols.length} symbols`);

    for (const symbol of symbols) {
      try {
        await this.runForSymbol(symbol, symbols, asOfDate);
        result.processed++;
        console.log(`  ✅ ${symbol} — ${EXECUTION_STRATEGIES.length} suggestions generated`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${symbol}: ${msg}`);
        result.skipped++;
        console.warn(`  ⚠️  ${symbol} — skipped: ${msg}`);
      }
    }

    console.log(
      `🏁 Universe run complete: ${result.processed} processed, ${result.skipped} skipped`
    );
    return result;
  }

  // ── Phase 6 methods (read API) ──────────────────────────────────────────────

  async getLatestSuggestions(opts?: {
    strategy?: StrategyName;
    signal?: string;
    limit?: number;
  }): Promise<(typeof strategySuggestions.$inferSelect)[]> {
    const limit = opts?.limit ?? 50;
    const conditions: ReturnType<typeof eq>[] = [];

    if (opts?.strategy) {
      conditions.push(eq(strategySuggestions.strategy, opts.strategy));
    }
    if (opts?.signal) {
      conditions.push(eq(strategySuggestions.signal, opts.signal));
    }

    if (conditions.length > 0) {
      return db
        .select()
        .from(strategySuggestions)
        .where(and(...conditions))
        .orderBy(desc(strategySuggestions.generatedAt))
        .limit(limit);
    }

    return db
      .select()
      .from(strategySuggestions)
      .orderBy(desc(strategySuggestions.generatedAt))
      .limit(limit);
  }

  async getSuggestionsForSymbol(
    symbol: string
  ): Promise<(typeof strategySuggestions.$inferSelect)[]> {
    return db
      .select()
      .from(strategySuggestions)
      .where(eq(strategySuggestions.symbol, symbol.toUpperCase()))
      .orderBy(desc(strategySuggestions.generatedAt))
      .limit(EXECUTION_STRATEGIES.length);
  }

  async getPerformanceStats(): Promise<
    Record<StrategyName, { total: number; correct: number; winRate: number }>
  > {
    const rows = await db
      .select({
        strategy: strategySuggestions.strategy,
        total: sql<number>`COUNT(*)::int`,
        correct: sql<number>`SUM(CASE WHEN prediction_correct THEN 1 ELSE 0 END)::int`,
      })
      .from(strategySuggestions)
      .where(sql`evaluated_at IS NOT NULL`)
      .groupBy(strategySuggestions.strategy);

    const result: Record<string, { total: number; correct: number; winRate: number }> = {
      social_momentum:  { total: 0, correct: 0, winRate: 0 },
      fundamental_flow: { total: 0, correct: 0, winRate: 0 },
      full_spectrum:    { total: 0, correct: 0, winRate: 0 },
      ml_baseline:      { total: 0, correct: 0, winRate: 0 },
      hybrid_baseline:  { total: 0, correct: 0, winRate: 0 },
    };

    for (const row of rows) {
      const total = Number(row.total) || 0;
      const correct = Number(row.correct) || 0;
      const winRate =
        total > 0 ? parseFloat(((correct / total) * 100).toFixed(2)) : 0;
      result[row.strategy] = { total, correct, winRate };
    }

    return result as Record<
      StrategyName,
      { total: number; correct: number; winRate: number }
    >;
  }

}

export const strategyEngine = new StrategyEngine();
