import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildMlFeatureValues,
  computePriceLookbackFeatures,
  StrategyMlFeatureService,
} from './strategyMlFeatureService.js';
import { priceService } from './databaseService.js';
import { strategyEngine, type RawSignals } from './strategyEngine.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeSignals(): RawSignals {
  return {
    symbol: 'AAPL',
    currentPrice: 160,
    redditSentiment: 0.35,
    redditMentions: 30,
    redditTrendScore: 0.6,
    newsSentiment: 0.2,
    newsMentions: 12,
    taScore: 0.45,
    taSignal: 'Buy',
    taTrend: 0.5,
    taMomentum: 0.2,
    volumeAnalysis: 0.1,
    supportProximity: 0.3,
    patternScore: 0.4,
    daysToEarnings: 7,
    calendarCatalystScore: 0.8,
    sectorSentiment: 0.15,
    entryPrice: 160,
    stopLoss: 152,
    takeProfit: 172,
    atr14: 4,
    coverage: {
      reddit_sentiment: {
        observed: true,
        observations: 3,
        coveragePct: 3 / 7,
        latestObservationDate: '2023-01-05',
      },
      reddit_trend: {
        observed: true,
        observations: 3,
        coveragePct: 3 / 7,
        latestObservationDate: '2023-01-05',
      },
      news_sentiment: {
        observed: true,
        observations: 2,
        coveragePct: 2 / 7,
        latestObservationDate: '2023-01-04',
      },
      calendar_catalyst: {
        observed: true,
        observations: 1,
        coveragePct: 1,
        latestObservationDate: '2023-01-06',
      },
      sector_sentiment: {
        observed: true,
        observations: 2,
        coveragePct: 2 / 7,
        latestObservationDate: '2023-01-04',
      },
    },
  };
}

function makeDescendingPriceRows(closes: number[]) {
  return closes
    .map((close, index) => ({
      date: new Date(Date.UTC(2022, 10, 1 + index)),
      close: close.toFixed(8),
    }))
    .reverse();
}

describe('computePriceLookbackFeatures', () => {
  it('computes trailing returns and range features from ascending closes', () => {
    const closes = Array.from({ length: 61 }, (_, index) => 100 + index);
    const features = computePriceLookbackFeatures(closes, 160);

    expect(features.trailingReturn5d).toBeCloseTo(3.2258, 4);
    expect(features.trailingReturn20d).toBeCloseTo(14.2857, 4);
    expect(features.trailingReturn60d).toBeCloseTo(60, 4);
    expect(features.distanceFromHigh20d).toBe(0);
    expect(features.distanceFromLow20d).toBeCloseTo((160 - 141) / 141, 4);
    expect(features.volatility20d).toBeGreaterThan(0);
  });
});

describe('buildMlFeatureValues', () => {
  it('maps raw signals and coverage into stable ML feature values', () => {
    const features = buildMlFeatureValues(makeSignals(), {
      trailingReturn5d: 1,
      trailingReturn20d: 2,
      trailingReturn60d: 3,
      volatility20d: 0.01,
      distanceFromHigh20d: -0.02,
      distanceFromLow20d: 0.04,
    });

    expect(features.atrPct).toBeCloseTo(0.025, 4);
    expect(features.redditCoveragePct).toBeCloseTo(3 / 7, 4);
    expect(features.newsCoveragePct).toBeCloseTo(2 / 7, 4);
    expect(features.sectorCoveragePct).toBeCloseTo(2 / 7, 4);
    expect(features.daysToEarningsNormalized).toBeCloseTo(0.8, 4);
    expect(features.catalystObserved).toBe(1);
    expect(features.redditMentionsLog1p).toBeCloseTo(Math.log1p(30), 4);
  });
});

describe('StrategyMlFeatureService', () => {
  it('builds a labeled point-in-time feature row from signals and prices', async () => {
    const service = new StrategyMlFeatureService();
    vi.spyOn(strategyEngine, 'gatherAllSignals').mockResolvedValue(makeSignals());
    vi.spyOn(priceService, 'getPriceHistory').mockResolvedValue(
      makeDescendingPriceRows(Array.from({ length: 61 }, (_, index) => 100 + index)) as any
    );
    vi.spyOn(priceService, 'getPriceOnOrAfter').mockResolvedValue([
      {
        date: new Date('2023-01-11T00:00:00.000Z'),
        close: '168.00000000',
      },
    ] as any);

    const row = await service.buildFeatureRow(
      'aapl',
      new Date('2023-01-06T12:00:00.000Z')
    );

    expect(row).not.toBeNull();
    expect(row!.symbol).toBe('AAPL');
    expect(row!.asOfDate).toBe('2023-01-06');
    expect(row!.horizonDays).toBe(5);
    expect(row!.label.targetDate).toBe('2023-01-11');
    expect(row!.label.observedDate).toBe('2023-01-11');
    expect(row!.label.futurePrice).toBe(168);
    expect(row!.label.forwardReturnPct).toBe(5);
    expect(row!.label.hasLabel).toBe(true);
    expect(row!.features.trailingReturn60d).toBeCloseTo(60, 4);
    expect(row!.features.redditCoveragePct).toBeCloseTo(3 / 7, 4);
    expect(row!.features.calendarCatalystScore).toBe(0.8);
  });

  it('skips forward-price label lookup when includeLabel is false', async () => {
    const service = new StrategyMlFeatureService();
    vi.spyOn(priceService, 'getPriceHistory').mockResolvedValue(
      makeDescendingPriceRows(Array.from({ length: 61 }, (_, index) => 100 + index)) as any
    );
    const onOrAfter = vi.spyOn(priceService, 'getPriceOnOrAfter').mockResolvedValue([] as any);

    const row = await service.buildFeatureRowFromSignals(
      makeSignals(),
      new Date('2023-01-06T12:00:00.000Z'),
      { includeLabel: false }
    );

    expect(onOrAfter).not.toHaveBeenCalled();
    expect(row!.label.hasLabel).toBe(false);
    expect(row!.label.forwardReturnPct).toBeNull();
    expect(row!.features.trailingReturn60d).toBeCloseTo(60, 4);
  });
});
