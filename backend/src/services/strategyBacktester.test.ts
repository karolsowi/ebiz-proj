import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySlippage,
  computeCommission,
  isRebalanceDay,
  strategyBacktester,
  type BacktestConfig,
} from './strategyBacktester.js';
import { strategyEngine, type RawSignals, type StrategySuggestion } from './strategyEngine.js';
import { strategyMlStrategyService } from './strategyMlStrategyService.js';

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
    taScore: 0.2,
    taSignal: 'Buy',
    taTrend: 0.3,
    taMomentum: 0.1,
    volumeAnalysis: 0,
    supportProximity: 0.1,
    patternScore: 0,
    daysToEarnings: null,
    calendarCatalystScore: 0,
    sectorSentiment: 0,
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 110,
    atr14: 2,
    coverage: {},
  };
}

function makeSuggestion(
  strategy: BacktestConfig['strategy'],
  signal: StrategySuggestion['signal'],
  convictionScore: number
): StrategySuggestion {
  return {
    symbol: 'AAPL',
    strategy,
    signal,
    convictionScore,
    convictionPct: Math.round(convictionScore * 100),
    signals: makeSignals(),
    breakdown: {
      stub: {
        raw: convictionScore,
        normalized: convictionScore,
        weight: 1,
        contribution: convictionScore,
      },
    },
    suggestedPositionPct: 5,
  };
}

function makeBar(
  date: string,
  open: number,
  high = open,
  low = open,
  close = open
) {
  return { date, open, high, low, close };
}

function makeConfig(
  executionMode: BacktestConfig['executionMode']
): BacktestConfig {
  return {
    symbols: ['AAPL'],
    strategy: 'social_momentum',
    startDate: '2023-01-02',
    endDate: '2023-01-04',
    initialCapital: 10000,
    convictionThreshold: 0.55,
    maxPositionPct: 0.1,
    stopLossEnabled: true,
    takeProfitEnabled: true,
    executionMode,
    slippageBps: 0,
    commissionBps: 0,
    rebalanceIntervalDays: 1,
    barPathModel: 'legacy_stop_first',
  };
}

describe('strategy backtester execution helpers', () => {
  it('applies slippage and commissions in the expected direction', () => {
    expect(applySlippage(100, 'buy', 5)).toBe(100.05);
    expect(applySlippage(100, 'sell', 5)).toBe(99.95);
    expect(computeCommission(1000, 10)).toBe(1);
  });

  it('marks rebalance days by configured interval', () => {
    expect(isRebalanceDay(0, 1)).toBe(true);
    expect(isRebalanceDay(3, 2)).toBe(false);
    expect(isRebalanceDay(4, 2)).toBe(true);
  });
});

describe('strategy backtester next-bar execution', () => {
  function mockTradingDaysAndBars(bars: Record<string, ReturnType<typeof makeBar>>) {
    const backtester = strategyBacktester as any;
    vi.spyOn(backtester, 'getTradingDays').mockReturnValue([
      new Date('2023-01-02T12:00:00.000Z'),
      new Date('2023-01-03T12:00:00.000Z'),
      new Date('2023-01-04T12:00:00.000Z'),
    ]);

    vi.spyOn(backtester, 'getExactPriceBar').mockImplementation(
      async (...args: unknown[]) => {
        const date = args[1] as Date;
        const day = date.toISOString().slice(0, 10);
        return bars[day] ?? null;
      }
    );

    vi.spyOn(backtester, 'getLatestPriceBarOnOrBefore').mockImplementation(
      async (...args: unknown[]) => {
        const date = args[1] as Date;
        const day = date.toISOString().slice(0, 10);
        if (bars[day]) return bars[day];
        const fallback = Object.keys(bars)
          .filter((barDay) => barDay <= day)
          .sort()
          .at(-1);
        if (fallback) return bars[fallback];
        return null;
      }
    );
  }

  it('fills signal entries on the next trading day close when using next_close mode', async () => {
    mockTradingDaysAndBars({
      '2023-01-02': makeBar('2023-01-02', 99, 101, 98, 100),
      '2023-01-03': makeBar('2023-01-03', 105, 106, 104, 101),
      '2023-01-04': makeBar('2023-01-04', 102, 103, 101, 102),
    });

    vi.spyOn(strategyEngine, 'gatherAllSignals').mockResolvedValue(makeSignals());

    let callCount = 0;
    vi.spyOn(strategyEngine, 'buildSuggestion').mockImplementation(
      (_symbol, strategy, _signals) => {
        callCount += 1;
        return callCount === 1
          ? makeSuggestion(strategy, 'buy', 0.7)
          : makeSuggestion(strategy, 'hold', 0.5);
      }
    );

    const result = await strategyBacktester.runBacktest({
      ...makeConfig('next_close'),
    });

    const buy = result.trades.find((trade) => trade.side === 'buy');
    expect(buy).toBeDefined();
    expect(buy!.date).toBe('2023-01-03');
    expect(buy!.price).toBe(101);
    expect(result.strategyMetadata.executionTiming).toBe('next_close');
    expect(result.strategyMetadata.rebalanceIntervalDays).toBe(1);
  });

  it('fills signal entries on the next trading day open when using next_open mode', async () => {
    mockTradingDaysAndBars({
      '2023-01-02': makeBar('2023-01-02', 99, 101, 98, 100),
      '2023-01-03': makeBar('2023-01-03', 105, 106, 104, 101),
      '2023-01-04': makeBar('2023-01-04', 102, 103, 101, 102),
    });

    vi.spyOn(strategyEngine, 'gatherAllSignals').mockResolvedValue(makeSignals());

    let callCount = 0;
    vi.spyOn(strategyEngine, 'buildSuggestion').mockImplementation(
      (_symbol, strategy, _signals) => {
        callCount += 1;
        return callCount === 1
          ? makeSuggestion(strategy, 'buy', 0.7)
          : makeSuggestion(strategy, 'hold', 0.5);
      }
    );

    const result = await strategyBacktester.runBacktest({
      ...makeConfig('next_open'),
    });

    const buy = result.trades.find((trade) => trade.side === 'buy');
    expect(buy).toBeDefined();
    expect(buy!.date).toBe('2023-01-03');
    expect(buy!.price).toBe(105);
    expect(result.strategyMetadata.executionTiming).toBe('next_open');
  });

  it('fills signal entries at typical price when using next_vwap mode', async () => {
    mockTradingDaysAndBars({
      '2023-01-02': makeBar('2023-01-02', 99, 101, 98, 100),
      '2023-01-03': makeBar('2023-01-03', 105, 106, 104, 101),
      '2023-01-04': makeBar('2023-01-04', 102, 103, 101, 102),
    });

    vi.spyOn(strategyEngine, 'gatherAllSignals').mockResolvedValue(makeSignals());

    let callCount = 0;
    vi.spyOn(strategyEngine, 'buildSuggestion').mockImplementation(
      (_symbol, strategy, _signals) => {
        callCount += 1;
        return callCount === 1
          ? makeSuggestion(strategy, 'buy', 0.7)
          : makeSuggestion(strategy, 'hold', 0.5);
      }
    );

    const result = await strategyBacktester.runBacktest({
      ...makeConfig('next_vwap'),
    });

    const buy = result.trades.find((trade) => trade.side === 'buy');
    expect(buy).toBeDefined();
    expect(buy!.date).toBe('2023-01-03');
    const typical = (106 + 104 + 101) / 3;
    expect(buy!.price).toBeCloseTo(typical, 5);
    expect(result.strategyMetadata.executionTiming).toBe('next_vwap');
  });

  it('uses a conservative stop-loss tie-break when both stop and take-profit hit in one bar', async () => {
    mockTradingDaysAndBars({
      '2023-01-02': makeBar('2023-01-02', 100, 100, 100, 100),
      '2023-01-03': makeBar('2023-01-03', 100, 111, 94, 100),
      '2023-01-04': makeBar('2023-01-04', 100, 100, 100, 100),
    });

    vi.spyOn(strategyEngine, 'gatherAllSignals').mockResolvedValue(makeSignals());

    let callCount = 0;
    vi.spyOn(strategyEngine, 'buildSuggestion').mockImplementation(
      (_symbol, strategy, _signals) => {
        callCount += 1;
        return callCount === 1
          ? makeSuggestion(strategy, 'buy', 0.7)
          : makeSuggestion(strategy, 'hold', 0.5);
      }
    );

    const result = await strategyBacktester.runBacktest({
      ...makeConfig('next_open'),
    });

    const sell = result.trades.find((trade) => trade.side === 'sell');
    expect(sell).toBeDefined();
    expect(sell!.date).toBe('2023-01-03');
    expect(sell!.reason).toBe('stop_loss');
    expect(sell!.price).toBe(95);
  });

  it('ohlc_sequence bar path exits take-profit first when the rally to high is hit before the flush to low', async () => {
    mockTradingDaysAndBars({
      '2023-01-02': makeBar('2023-01-02', 100, 100, 100, 100),
      '2023-01-03': makeBar('2023-01-03', 100, 111, 94, 100),
      '2023-01-04': makeBar('2023-01-04', 100, 100, 100, 100),
    });

    vi.spyOn(strategyEngine, 'gatherAllSignals').mockResolvedValue(makeSignals());

    let callCount = 0;
    vi.spyOn(strategyEngine, 'buildSuggestion').mockImplementation(
      (_symbol, strategy, _signals) => {
        callCount += 1;
        return callCount === 1
          ? makeSuggestion(strategy, 'buy', 0.7)
          : makeSuggestion(strategy, 'hold', 0.5);
      }
    );

    const result = await strategyBacktester.runBacktest({
      ...makeConfig('next_open'),
      barPathModel: 'ohlc_sequence',
    });

    const sell = result.trades.find((trade) => trade.side === 'sell');
    expect(sell).toBeDefined();
    expect(sell!.date).toBe('2023-01-03');
    expect(sell!.reason).toBe('take_profit');
    expect(sell!.price).toBe(110);
  });

  it('captures ML bucket usage and fallback diagnostics in backtest metadata', async () => {
    mockTradingDaysAndBars({
      '2023-01-02': makeBar('2023-01-02', 100, 100, 100, 100),
      '2023-01-03': makeBar('2023-01-03', 101, 101, 101, 101),
      '2023-01-04': makeBar('2023-01-04', 102, 102, 102, 102),
    });

    vi.spyOn(strategyEngine, 'gatherAllSignals').mockResolvedValue(makeSignals());

    let callCount = 0;
    vi.spyOn(strategyMlStrategyService, 'buildSuggestion').mockImplementation(async () => {
      callCount += 1;
      if (callCount < 3) {
        return {
          symbol: 'AAPL',
          strategy: 'ml_baseline',
          signal: 'hold',
          convictionScore: 0.5,
          convictionPct: 50,
          signals: makeSignals(),
          breakdown: {
            ml_baseline_score: {
              raw: 0.1,
              normalized: 0.1,
              weight: 1,
              contribution: 0.1,
              observations: 24,
              meta: {
                modelVersion: 'baseline_live_2023-01-01',
                bucketStart: '2023-01-01',
                trainingStartDate: '2022-01-01',
                trainingRowCount: 24,
                trainedThroughDate: '2022-12-31',
              },
            },
          },
          suggestedPositionPct: 5,
        };
      }

      return {
        symbol: 'AAPL',
        strategy: 'ml_baseline',
        signal: 'hold',
        convictionScore: 0.5,
        convictionPct: 50,
        signals: makeSignals(),
        breakdown: {
          ml_baseline_score: {
            raw: 0,
            normalized: 0,
            weight: 1,
            contribution: 0,
            observations: 0,
            meta: {
              reason: 'Insufficient training rows for ML snapshot',
              bucketStart: '2023-01-01',
            },
          },
        },
        suggestedPositionPct: 5,
      };
    });

    const result = await strategyBacktester.runBacktest({
      ...makeConfig('next_close'),
      strategy: 'ml_baseline',
    });

    expect(result.strategyMetadata.mlDiagnostics.totalMlEvaluations).toBe(3);
    expect(result.strategyMetadata.mlDiagnostics.modelBackedEvaluations).toBe(2);
    expect(result.strategyMetadata.mlDiagnostics.fallbackEvaluations).toBe(1);
    expect(result.strategyMetadata.mlDiagnostics.yearUsage).toEqual([
      {
        year: '2023',
        bucketCount: 1,
        suggestionCount: 3,
      },
    ]);
    expect(result.strategyMetadata.mlDiagnostics.bucketUsage).toContainEqual({
      bucketStart: '2023-01-01',
      year: '2023',
      modelVersion: 'baseline_live_2023-01-01',
      trainingStartDate: '2022-01-01',
      trainedThroughDate: '2022-12-31',
      trainingRowCount: 24,
      suggestionCount: 2,
    });
    expect(result.strategyMetadata.mlDiagnostics.fallbackReasons).toEqual([
      {
        reason: 'Insufficient training rows for ML snapshot',
        count: 1,
      },
    ]);
  });
});
