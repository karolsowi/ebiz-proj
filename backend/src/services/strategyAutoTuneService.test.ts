import { describe, it, expect, vi, beforeEach } from 'vitest';
import { strategyComparison, type ComparisonConfig, type StrategyComparisonReport } from './strategyComparison.js';
import { runStrategyAutoTune } from './strategyAutoTuneService.js';
import { BACKTEST_STRATEGIES } from './strategyBacktester.js';
import type { PerformanceReport } from './performanceMetrics.js';

const baseConfig: ComparisonConfig = {
  startDate: '2021-01-01',
  endDate: '2021-03-31',
  symbols: ['AAPL', 'MSFT'],
  initialCapital: 100_000,
  convictionThreshold: 0.6,
  maxPositionPct: 0.15,
  rebalanceIntervalDays: 5,
  stopLossEnabled: true,
  takeProfitEnabled: true,
  executionMode: 'next_close',
  slippageBps: 5,
  commissionBps: 1,
};

function perf(totalReturnPct: number, spy = 5): PerformanceReport {
  return {
    totalReturnPct,
    annualizedReturnPct: totalReturnPct,
    sharpeRatio: totalReturnPct / 5,
    sortinoRatio: 0,
    maxDrawdownPct: 0,
    winRatePct: 50,
    totalTrades: 10,
    winningTrades: 5,
    losingTrades: 5,
    benchmarkSymbol: 'SPY',
    benchmarkReturnPct: spy,
    alpha: totalReturnPct - spy,
    riskFreeRateAnnualized: 0.05,
    tradingDaysInPeriod: 60,
  };
}

function mockReport(mlReturn: number, config: ComparisonConfig): StrategyComparisonReport {
  const results = {} as StrategyComparisonReport['results'];
  for (const strategy of BACKTEST_STRATEGIES) {
    results[strategy] = {
      strategy,
      performance: perf(strategy === 'ml_baseline' ? mlReturn : 1),
      equityCurve: [],
      trades: [],
      backtest: { trades: [], equityCurve: [], config } as unknown as StrategyComparisonReport['results']['ml_baseline']['backtest'],
    };
  }
  return {
    config,
    universeDiagnostics: null,
    results,
    winner: 'ml_baseline',
    winnerReason: 'test',
    generatedAt: new Date().toISOString(),
    benchmark: {
      symbol: 'SPY',
      label: 'SPY',
      equityCurve: [],
      totalReturnPct: 5,
      annualizedReturnPct: 5,
      maxDrawdownPct: 0,
      tradingDaysInPeriod: 60,
    },
  };
}

describe('runStrategyAutoTune', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('selects the development trial with the highest alpha', async () => {
    vi.spyOn(strategyComparison, 'compareStrategies').mockImplementation(async (config) => {
      const conv = config.convictionThreshold;
      const mlReturn = conv === 0.66 ? 20 : conv === 0.62 ? 12 : 8;
      return mockReport(mlReturn, config);
    });

    const result = await runStrategyAutoTune({
      baseConfig,
      maxTrials: 3,
      objective: 'alpha',
      runValidation: false,
    });

    expect(result.trialsRun).toBe(3);
    expect(result.bestConfig.convictionThreshold).toBe(0.66);
    expect(result.bestScore).toBeCloseTo(15, 1);
  });
});
