import { afterEach, describe, expect, it, vi } from 'vitest';
import { strategyEngine, type RawSignals, type StrategySuggestion } from './strategyEngine.js';
import {
  StrategyMlStrategyService,
} from './strategyMlStrategyService.js';
import { strategyMlFeatureService, type StrategyMlFeatureRow, type StrategyMlFeatureValues } from './strategyMlFeatureService.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeSignals(): RawSignals {
  return {
    symbol: 'AAPL',
    currentPrice: 100,
    redditSentiment: 0,
    redditMentions: 0,
    redditTrendScore: 0,
    newsSentiment: 0,
    newsMentions: 0,
    taScore: 0.3,
    taSignal: 'Buy',
    taTrend: 0.4,
    taMomentum: 0.2,
    volumeAnalysis: 0.1,
    supportProximity: 0.2,
    patternScore: 0.1,
    daysToEarnings: 7,
    calendarCatalystScore: 0.8,
    sectorSentiment: 0.05,
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 110,
    atr14: 2,
    coverage: {},
  };
}

function makeFeatures(
  overrides: Partial<StrategyMlFeatureValues> = {}
): StrategyMlFeatureValues {
  return {
    trailingReturn5d: 0,
    trailingReturn20d: 0,
    trailingReturn60d: 0,
    volatility20d: 0,
    distanceFromHigh20d: 0,
    distanceFromLow20d: 0,
    taScore: 0,
    taTrend: 0,
    taMomentum: 0,
    volumeAnalysis: 0,
    supportProximity: 0,
    patternScore: 0,
    atrPct: 0,
    redditSentiment: 0,
    redditTrendScore: 0,
    redditMentionsLog1p: 0,
    redditCoveragePct: 0,
    newsSentiment: 0,
    newsMentionsLog1p: 0,
    newsCoveragePct: 0,
    sectorSentiment: 0,
    sectorCoveragePct: 0,
    calendarCatalystScore: 0,
    daysToEarningsNormalized: 0,
    catalystObserved: 0,
    ...overrides,
  };
}

function makeRow(
  symbol: string,
  asOfDate: string,
  taScore: number,
  forwardReturnPct: number | null
): StrategyMlFeatureRow {
  return {
    symbol,
    asOfDate,
    horizonDays: 5,
    currentPrice: 100,
    features: makeFeatures({ taScore }),
    label: {
      targetDate: asOfDate,
      observedDate: forwardReturnPct !== null ? asOfDate : null,
      futurePrice: forwardReturnPct !== null ? 100 + forwardReturnPct : null,
      forwardReturnPct,
      hasLabel: forwardReturnPct !== null,
    },
  };
}

describe('StrategyMlStrategyService', () => {
  it('builds a standalone ml suggestion from a trained snapshot', async () => {
    const service = new StrategyMlStrategyService();
    vi.spyOn(strategyMlFeatureService, 'buildFeatureRows').mockResolvedValue([
      ...Array.from({ length: 10 }, (_, index) =>
        makeRow(`NEG_${index}`, '2022-01-01', -1 - index / 10, -4 - index / 10)
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        makeRow(`POS_${index}`, '2022-06-01', 1 + index / 10, 4 + index / 10)
      ),
    ]);
    vi.spyOn(strategyMlFeatureService, 'buildFeatureRowFromSignals').mockResolvedValue(
      makeRow('AAPL', '2023-01-06', 2, null)
    );

    const suggestion = await service.buildSuggestion(
      'AAPL',
      'ml_baseline',
      makeSignals(),
      new Date('2023-01-06T12:00:00.000Z'),
      ['AAPL', 'MSFT']
    );

    expect(suggestion.strategy).toBe('ml_baseline');
    expect(['buy', 'strong_buy']).toContain(suggestion.signal);
    expect(suggestion.convictionScore).toBeGreaterThan(0.5);
    expect(suggestion.breakdown.ml_baseline_score).toBeDefined();
    expect(
      suggestion.breakdown.ml_baseline_score!.meta?.modelVersion
    ).toBe('baseline_live_2023-01-01');
    expect(
      suggestion.breakdown.ml_baseline_score!.meta?.bucketStart
    ).toBe('2023-01-01');
    expect(
      suggestion.breakdown.ml_baseline_score!.meta?.trainingStartDate
    ).toBe('2022-01-01');
    expect(
      suggestion.breakdown.ml_baseline_score!.meta?.trainingRowCount
    ).toBe(20);
    expect(
      suggestion.breakdown.ml_baseline_score!.meta?.trainedThroughDate
    ).toBe('2022-06-01');
  });

  it('falls back to the rule suggestion for hybrid mode when ML training is unavailable', async () => {
    const service = new StrategyMlStrategyService();
    vi.spyOn(strategyMlFeatureService, 'buildFeatureRows').mockResolvedValue([]);

    const ruleSuggestion: StrategySuggestion = {
      symbol: 'AAPL',
      strategy: 'full_spectrum',
      signal: 'buy',
      convictionScore: 0.61,
      convictionPct: 61,
      signals: makeSignals(),
      breakdown: {
        rule_only: {
          raw: 0.22,
          normalized: 0.22,
          weight: 1,
          contribution: 0.22,
        },
      },
      suggestedPositionPct: 5.08,
    };

    vi.spyOn(strategyEngine, 'buildSuggestion').mockReturnValue(ruleSuggestion);

    const suggestion = await service.buildSuggestion(
      'AAPL',
      'hybrid_baseline',
      makeSignals(),
      new Date('2023-01-06T12:00:00.000Z'),
      ['AAPL', 'MSFT']
    );

    expect(suggestion.strategy).toBe('hybrid_baseline');
    expect(suggestion.signal).toBe('buy');
    expect(suggestion.convictionScore).toBe(0.61);
    expect(suggestion.breakdown.hybrid_ml_score).toBeDefined();
    expect(
      suggestion.breakdown.hybrid_ml_score!.meta?.reason
    ).toBe('Insufficient training rows for ML snapshot');
  });

  it('stamps trained hybrid rule metadata with the as-of date', async () => {
    const service = new StrategyMlStrategyService();
    vi.spyOn(strategyMlFeatureService, 'buildFeatureRows').mockResolvedValue([
      ...Array.from({ length: 10 }, (_, index) =>
        makeRow(`NEG_${index}`, '2022-01-01', -1 - index / 10, -4 - index / 10)
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        makeRow(`POS_${index}`, '2022-06-01', 1 + index / 10, 4 + index / 10)
      ),
    ]);
    vi.spyOn(strategyMlFeatureService, 'buildFeatureRowFromSignals').mockResolvedValue(
      makeRow('AAPL', '2023-01-06', 2, null)
    );

    const suggestion = await service.buildSuggestion(
      'AAPL',
      'hybrid_baseline',
      makeSignals(),
      new Date('2023-01-06T12:00:00.000Z'),
      ['AAPL', 'MSFT']
    );

    expect(suggestion.strategy).toBe('hybrid_baseline');
    expect(suggestion.breakdown.hybrid_rule_score?.latestObservationDate).toBe('2023-01-06');
    expect(
      suggestion.breakdown.hybrid_ml_score?.meta?.trainingStartDate
    ).toBe('2022-01-01');
  });

  it('propagates custom ML execution settings into suggestion metadata', async () => {
    const service = new StrategyMlStrategyService();
    vi.spyOn(strategyMlFeatureService, 'buildFeatureRows').mockResolvedValue([
      ...Array.from({ length: 10 }, (_, index) =>
        makeRow(`NEG_${index}`, '2022-01-01', -1 - index / 10, -4 - index / 10)
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        makeRow(`POS_${index}`, '2022-06-01', 1 + index / 10, 4 + index / 10)
      ),
    ]);
    vi.spyOn(strategyMlFeatureService, 'buildFeatureRowFromSignals').mockResolvedValue(
      makeRow('AAPL', '2023-05-06', 2, null)
    );

    const suggestion = await service.buildSuggestion(
      'AAPL',
      'ml_baseline',
      makeSignals(),
      new Date('2023-05-06T12:00:00.000Z'),
      ['AAPL', 'MSFT'],
      {
        walkForwardCadence: 'quarterly',
        trainingLookbackMonths: 6,
        minTrainingRows: 10,
        labelHorizonDays: 10,
      }
    );

    expect(suggestion.breakdown.ml_baseline_score?.meta?.bucketStart).toBe('2023-04-01');
    expect(suggestion.breakdown.ml_baseline_score?.meta?.walkForwardCadence).toBe('quarterly');
    expect(suggestion.breakdown.ml_baseline_score?.meta?.trainingLookbackMonths).toBe(6);
    expect(suggestion.breakdown.ml_baseline_score?.meta?.minTrainingRows).toBe(10);
    expect(suggestion.breakdown.ml_baseline_score?.meta?.labelHorizonDays).toBe(10);
  });
});
