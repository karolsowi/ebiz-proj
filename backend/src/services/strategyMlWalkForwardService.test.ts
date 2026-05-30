import { describe, expect, it } from 'vitest';
import {
  buildWalkForwardBucketStarts,
  getWalkForwardBucketStart,
  StrategyMlWalkForwardService,
} from './strategyMlWalkForwardService.js';
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

describe('walk-forward bucket helpers', () => {
  it('computes monthly and quarterly bucket starts', () => {
    expect(getWalkForwardBucketStart('2023-02-17', 'monthly')).toBe('2023-02-01');
    expect(getWalkForwardBucketStart('2023-05-17', 'quarterly')).toBe('2023-04-01');
  });

  it('builds sorted unique bucket starts', () => {
    const rows = [
      makeRow('A', '2023-03-15', 1, 1),
      makeRow('B', '2023-01-10', -1, -1),
      makeRow('C', '2023-03-01', 0, 0),
      makeRow('D', '2023-02-05', 2, 2),
    ];

    expect(buildWalkForwardBucketStarts(rows, 'monthly')).toEqual([
      '2023-01-01',
      '2023-02-01',
      '2023-03-01',
    ]);
  });
});

describe('StrategyMlWalkForwardService', () => {
  it('trains only on prior labeled rows and scores later buckets', () => {
    const service = new StrategyMlWalkForwardService();
    const rows = [
      makeRow('JAN_NEG', '2023-01-05', -1, -3),
      makeRow('JAN_POS', '2023-01-20', 1, 3),
      makeRow('FEB_POS', '2023-02-05', 1.5, 4),
      makeRow('FEB_NEG', '2023-02-20', -1.5, -4),
      makeRow('MAR_POS', '2023-03-05', 2, 5),
    ];

    const result = service.runWalkForward(rows, {
      cadence: 'monthly',
      minTrainingRows: 2,
      modelVersionPrefix: 'wf',
      validationHoldoutRatio: 0,
    });

    expect(result.skippedBuckets).toEqual([
      {
        bucketStart: '2023-01-01',
        reason: 'Need at least 2 labeled rows before 2023-01-01, got 0',
      },
    ]);

    expect(result.snapshots.map((snapshot) => snapshot.bucketStart)).toEqual([
      '2023-02-01',
      '2023-03-01',
    ]);
    expect(result.snapshots[0]!.validationRowCount).toBe(0);
    expect(result.snapshots[0]!.validationScoreLabelCorrelation).toBeNull();
    expect(result.snapshots[0]!.trainingRowCount).toBe(2);
    expect(result.snapshots[0]!.trainingEndDate).toBe('2023-01-20');
    expect(result.snapshots[1]!.trainingRowCount).toBe(4);
    expect(result.snapshots[1]!.trainingEndDate).toBe('2023-02-20');

    const febScores = result.scoredRows.filter((row) => row.bucketStart === '2023-02-01');
    expect(febScores).toHaveLength(2);
    expect(febScores[0]!.modelVersion).toBe('wf_2023-02-01');
    expect(febScores[0]!.trainedThroughDate).toBe('2023-01-20');
    expect(febScores.find((row) => row.row.symbol === 'FEB_POS')!.score.score).toBeGreaterThan(
      febScores.find((row) => row.row.symbol === 'FEB_NEG')!.score.score
    );
  });
});
