import { describe, expect, it } from 'vitest';
import {
  aggregateSentimentWindowRows,
  buildSuggestionEngineVersion,
  normalizeUniverseSymbols,
  StrategyEngine,
  type RawSignals,
} from './strategyEngine.js';

/**
 * Updated task 4.7 worked example: optional trend/catalyst overlays are now
 * positive-only when present and neutral when absent.
 */
function nvdaPhase47Signals(): RawSignals {
  return {
    symbol: 'NVDA',
    currentPrice: 100,
    redditSentiment: 0.6,
    redditMentions: 40,
    redditTrendScore: 0.8,
    newsSentiment: 0,
    newsMentions: 0,
    taScore: 0,
    taSignal: 'Neutral',
    taTrend: 0.4,
    taMomentum: -0.2,
    volumeAnalysis: 0,
    supportProximity: 0.3,
    patternScore: 0,
    daysToEarnings: null,
    calendarCatalystScore: 0,
    sectorSentiment: 0,
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 105,
    atr14: 1,
  };
}

describe('StrategyEngine conviction scoring (phase 4)', () => {
  it('matches task 4.7 worked example for social_momentum', () => {
    const engine = new StrategyEngine();
    const signals = nvdaPhase47Signals();
    const sug = engine.buildSuggestion('nvda', 'social_momentum', signals);

    expect(sug.symbol).toBe('NVDA');
    expect(sug.strategy).toBe('social_momentum');

    // weightedSum = 0.45 → conviction = (0.45 + 1) / 2 = 0.725
    expect(sug.breakdown.reddit_sentiment!.weight).toBe(0.35);
    expect(sug.breakdown.reddit_sentiment!.raw).toBeCloseTo(0.6, 10);
    expect(sug.breakdown.reddit_sentiment!.contribution).toBeCloseTo(0.21, 10);

    expect(sug.breakdown.reddit_trend!.weight).toBe(0.2);
    expect(sug.breakdown.reddit_trend!.raw).toBeCloseTo(0.8, 10);
    expect(sug.breakdown.reddit_trend!.contribution).toBeCloseTo(0.16, 10);

    expect(sug.breakdown.ta_trend!.weight).toBe(0.2);
    expect(sug.breakdown.ta_trend!.raw).toBeCloseTo(0.4, 10);
    expect(sug.breakdown.ta_trend!.contribution).toBeCloseTo(0.08, 10);

    expect(sug.breakdown.ta_momentum!.weight).toBe(0.15);
    expect(sug.breakdown.ta_momentum!.raw).toBeCloseTo(-0.2, 10);
    expect(sug.breakdown.ta_momentum!.contribution).toBeCloseTo(-0.03, 10);

    expect(sug.breakdown.support_proximity!.weight).toBe(0.1);
    expect(sug.breakdown.support_proximity!.raw).toBeCloseTo(0.3, 10);
    expect(sug.breakdown.support_proximity!.contribution).toBeCloseTo(0.03, 10);

    expect(sug.convictionScore).toBeCloseTo(0.725, 10);
    expect(sug.convictionPct).toBe(73);
    expect(sug.signal).toBe('strong_buy');
    expect(sug.suggestedPositionPct).toBe(6.04);
  });

  it('keeps missing optional overlays neutral in fundamental_flow', () => {
    const engine = new StrategyEngine();
    const signals: RawSignals = {
      symbol: 'MSFT',
      currentPrice: 100,
      redditSentiment: 0,
      redditMentions: 0,
      redditTrendScore: 0,
      newsSentiment: 0,
      newsMentions: 0,
      taScore: 0.4,
      taSignal: 'Buy',
      taTrend: 0.8,
      taMomentum: 0.4,
      volumeAnalysis: 0.2,
      supportProximity: 0,
      patternScore: 0,
      daysToEarnings: null,
      calendarCatalystScore: 0,
      sectorSentiment: 0,
      entryPrice: 100,
      stopLoss: 95,
      takeProfit: 108,
      atr14: 1.2,
      coverage: {
        news_sentiment: {
          observed: false,
          observations: 0,
          coveragePct: 0,
          latestObservationDate: null,
        },
        calendar_catalyst: {
          observed: false,
          observations: 0,
          coveragePct: 0,
          latestObservationDate: null,
        },
      },
    };

    const sug = engine.buildSuggestion('msft', 'fundamental_flow', signals);

    expect(sug.breakdown.news_sentiment!.contribution).toBe(0);
    expect(sug.breakdown.news_sentiment!.observed).toBe(false);
    expect(sug.breakdown.calendar_catalyst!.contribution).toBe(0);
    expect(sug.breakdown.calendar_catalyst!.observed).toBe(false);

    expect(sug.convictionScore).toBeCloseTo(0.625, 10);
    expect(sug.signal).toBe('buy');
  });
});

describe('aggregateSentimentWindowRows', () => {
  it('aggregates all rows in the 7-day window instead of taking the latest row', () => {
    const aggregated = aggregateSentimentWindowRows([
      {
        date: new Date('2023-12-10T00:00:00.000Z'),
        totalMentions: 10,
        weightedSentiment: '0.4000',
        averageSentiment: '0.3000',
      },
      {
        date: new Date('2023-12-12T00:00:00.000Z'),
        totalMentions: 30,
        weightedSentiment: '-0.2000',
        averageSentiment: '-0.1000',
      },
      {
        date: new Date('2023-12-15T00:00:00.000Z'),
        totalMentions: 5,
        weightedSentiment: '0.9000',
        averageSentiment: '0.8000',
      },
    ]);

    expect(aggregated.mentions).toBe(45);
    expect(aggregated.sentiment).toBeCloseTo(0.0556, 4);
    expect(aggregated.observationCount).toBe(3);
    expect(aggregated.coveragePct).toBeCloseTo(3 / 7, 4);
    expect(aggregated.latestObservationDate).toBe('2023-12-15');
    expect(aggregated.hasData).toBe(true);
  });

  it('returns an empty neutral aggregate when no rows are present', () => {
    const aggregated = aggregateSentimentWindowRows([]);

    expect(aggregated).toEqual({
      sentiment: 0,
      mentions: 0,
      observationCount: 0,
      coveragePct: 0,
      latestObservationDate: null,
      hasData: false,
    });
  });
});

describe('normalizeUniverseSymbols', () => {
  it('uppercases, deduplicates, and removes invalid entries', () => {
    const normalized = normalizeUniverseSymbols([
      'aapl',
      'AAPL',
      ' msft ',
      'BRK.B',
      'BAD SYMBOL',
      '',
    ]);

    expect(normalized).toEqual(['AAPL', 'MSFT', 'BRK.B']);
  });
});

describe('buildSuggestionEngineVersion', () => {
  it('keeps the base engine version for rule-based suggestions', () => {
    const engine = new StrategyEngine();
    const suggestion = engine.buildSuggestion('AAPL', 'full_spectrum', nvdaPhase47Signals());

    expect(buildSuggestionEngineVersion(suggestion)).toBe('v2');
  });

  it('embeds the model version for ML-backed suggestions', () => {
    expect(
      buildSuggestionEngineVersion({
        symbol: 'AAPL',
        strategy: 'ml_baseline',
        signal: 'buy',
        convictionScore: 0.71,
        convictionPct: 71,
        signals: nvdaPhase47Signals(),
        breakdown: {
          ml_baseline_score: {
            raw: 0.42,
            normalized: 0.42,
            weight: 1,
            contribution: 0.42,
            meta: { modelVersion: 'baseline_live_2023-01-01' },
          },
        },
        suggestedPositionPct: 5.92,
      })
    ).toBe('v2:baseline_live_2023-01-01');
  });
});
