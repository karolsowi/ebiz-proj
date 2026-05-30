import { describe, expect, it } from 'vitest';
import {
  rankFeatureRowsWithModel,
  scoreFeatureRowWithModel,
  trainBaselineMlModel,
} from './strategyMlModelService.js';
import type {
  StrategyMlFeatureRow,
  StrategyMlFeatureValues,
} from './strategyMlFeatureService.js';

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
  features: Partial<StrategyMlFeatureValues>,
  forwardReturnPct: number | null
): StrategyMlFeatureRow {
  return {
    symbol,
    asOfDate: '2023-01-02',
    horizonDays: 5,
    currentPrice: 100,
    features: makeFeatures(features),
    label: {
      targetDate: '2023-01-07',
      observedDate: forwardReturnPct !== null ? '2023-01-09' : null,
      futurePrice: forwardReturnPct !== null ? 100 + forwardReturnPct : null,
      forwardReturnPct,
      hasLabel: forwardReturnPct !== null,
    },
  };
}

describe('trainBaselineMlModel', () => {
  it('learns positive and negative feature directions from labeled rows', () => {
    const model = trainBaselineMlModel([
      makeRow('A', { taScore: -2, newsSentiment: 2 }, -8),
      makeRow('B', { taScore: -1, newsSentiment: 1 }, -4),
      makeRow('C', { taScore: 1, newsSentiment: -1 }, 4),
      makeRow('D', { taScore: 2, newsSentiment: -2 }, 8),
    ]);

    expect(model.trainingRowCount).toBe(4);
    expect(model.featureStats.taScore.weight).toBeGreaterThan(0);
    expect(model.featureStats.newsSentiment.weight).toBeLessThan(0);
  });

  it('ignores unlabeled rows when training', () => {
    const model = trainBaselineMlModel([
      makeRow('A', { taScore: -1 }, -2),
      makeRow('B', { taScore: 1 }, 2),
      makeRow('C', { taScore: 10 }, null),
    ]);

    expect(model.trainingRowCount).toBe(2);
  });
});

describe('scoreFeatureRowWithModel', () => {
  it('scores bullish rows above bearish rows using the trained model', () => {
    const model = trainBaselineMlModel([
      makeRow('A', { taScore: -2, newsSentiment: 2 }, -8),
      makeRow('B', { taScore: -1, newsSentiment: 1 }, -4),
      makeRow('C', { taScore: 1, newsSentiment: -1 }, 4),
      makeRow('D', { taScore: 2, newsSentiment: -2 }, 8),
    ]);

    const bullish = scoreFeatureRowWithModel(
      makeRow('LONG', { taScore: 1.5, newsSentiment: -1.5 }, null),
      model
    );
    const bearish = scoreFeatureRowWithModel(
      makeRow('SHORT', { taScore: -1.5, newsSentiment: 1.5 }, null),
      model
    );

    expect(bullish.score).toBeGreaterThan(0);
    expect(bullish.conviction).toBeGreaterThan(0.5);
    expect(bearish.score).toBeLessThan(0);
    expect(bearish.conviction).toBeLessThan(0.5);
    expect(bullish.predictedReturnPct).toBeGreaterThan(bearish.predictedReturnPct);
  });
});

describe('rankFeatureRowsWithModel', () => {
  it('sorts rows from highest to lowest ML score', () => {
    const model = trainBaselineMlModel([
      makeRow('A', { taScore: -2, newsSentiment: 2 }, -8),
      makeRow('B', { taScore: -1, newsSentiment: 1 }, -4),
      makeRow('C', { taScore: 1, newsSentiment: -1 }, 4),
      makeRow('D', { taScore: 2, newsSentiment: -2 }, 8),
    ]);

    const ranked = rankFeatureRowsWithModel(
      [
        makeRow('MID', { taScore: 0, newsSentiment: 0 }, null),
        makeRow('BEST', { taScore: 2, newsSentiment: -2 }, null),
        makeRow('WORST', { taScore: -2, newsSentiment: 2 }, null),
      ],
      model
    );

    expect(ranked.map((entry) => entry.row.symbol)).toEqual(['BEST', 'MID', 'WORST']);
  });
});
