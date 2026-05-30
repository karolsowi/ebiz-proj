import { describe, expect, it } from 'vitest';
import { pickComparisonWinner, type StrategyResult } from './strategyComparison.js';
import type { BacktestStrategyName } from './strategyBacktester.js';

function makeStrategyResult(
  strategy: BacktestStrategyName,
  sharpeRatio: number,
  totalReturnPct: number,
  totalTrades: number
): StrategyResult {
  return {
    strategy,
    performance: {
      totalReturnPct,
      annualizedReturnPct: totalReturnPct,
      sharpeRatio,
      sortinoRatio: sharpeRatio,
      maxDrawdownPct: 0,
      winRatePct: 50,
      totalTrades,
      winningTrades: Math.min(totalTrades, 1),
      losingTrades: Math.max(0, totalTrades - 1),
      benchmarkSymbol: 'SPY',
      benchmarkReturnPct: 0,
      alpha: 0,
      riskFreeRateAnnualized: 0.05,
      tradingDaysInPeriod: 252,
    },
    equityCurve: [
      { date: '2023-01-02', equity: 100000, cash: 100000, positionsValue: 0 },
      { date: '2023-01-03', equity: 101000, cash: 80000, positionsValue: 21000 },
    ],
    trades: [],
    backtest: {
      config: {
        symbols: ['AAPL'],
        strategy,
        startDate: '2023-01-01',
        endDate: '2023-12-31',
        initialCapital: 100000,
        convictionThreshold: 0.55,
        maxPositionPct: 0.1,
        stopLossEnabled: true,
        takeProfitEnabled: true,
        executionMode: 'next_close',
        slippageBps: 5,
        commissionBps: 1,
        rebalanceIntervalDays: 1,
      },
      trades: [],
      equityCurve: [
        { date: '2023-01-02', equity: 100000, cash: 100000, positionsValue: 0 },
      ],
      finalEquity: 101000,
      totalReturn: 1000,
      totalReturnPct,
      totalTrades,
      winningTrades: Math.min(totalTrades, 1),
      losingTrades: Math.max(0, totalTrades - 1),
      winRatePct: 50,
      maxDrawdownPct: 0,
      sharpeRatio,
      sortinoRatio: sharpeRatio,
      annualizedReturnPct: totalReturnPct,
      strategyMetadata: {
        strategyFamily: strategy === 'ml_baseline'
          ? 'ml'
          : strategy === 'hybrid_baseline'
            ? 'hybrid'
            : 'rule',
        modelVersions: [],
        bucketStarts: [],
        trainedThroughDates: [],
        executionTiming: 'next_close',
        barPathModel: 'ohlc_sequence',
        liquidityImpactSqrtCoef: 0,
        advVolumeLookbackDays: 20,
        maxAdvParticipationPct: null,
        slippageBps: 5,
        commissionBps: 1,
        rebalanceIntervalDays: 1,
        universeDiagnostics: null,
        mlDiagnostics: {
          walkForwardCadence: 'monthly',
          trainingLookbackMonths: 12,
          labelHorizonDays: 5,
          minTrainingRows: 20,
          validationHoldoutRatio: 0.12,
          totalMlEvaluations: 0,
          modelBackedEvaluations: 0,
          fallbackEvaluations: 0,
          bucketUsage: [],
          yearUsage: [],
          fallbackReasons: [],
        },
      },
    },
  };
}

describe('pickComparisonWinner', () => {
  it('excludes zero-trade strategies when active strategies exist', () => {
    const results = {
      social_momentum: makeStrategyResult('social_momentum', -1.07, 1.67, 321),
      fundamental_flow: makeStrategyResult('fundamental_flow', 0.0, 0.0, 0),
      full_spectrum: makeStrategyResult('full_spectrum', -5.0, 0.92, 24),
      ml_baseline: makeStrategyResult('ml_baseline', -0.4, 1.2, 18),
      hybrid_baseline: makeStrategyResult('hybrid_baseline', -0.2, 1.5, 26),
    };

    const picked = pickComparisonWinner(results);

    expect(picked.winner).toBe('hybrid_baseline');
    expect(picked.reason).toContain('Excluded inactive strategies: fundamental_flow (0 trades)');
    expect(picked.reason).not.toContain('fundamental_flow Sharpe 0.00');
  });

  it('falls back to Sharpe ranking when every strategy is inactive', () => {
    const results = {
      social_momentum: makeStrategyResult('social_momentum', 0.1, 0.5, 0),
      fundamental_flow: makeStrategyResult('fundamental_flow', 0.2, 0.1, 0),
      full_spectrum: makeStrategyResult('full_spectrum', -0.1, 0.3, 0),
      ml_baseline: makeStrategyResult('ml_baseline', 0.05, 0.2, 0),
      hybrid_baseline: makeStrategyResult('hybrid_baseline', 0.0, 0.4, 0),
    };

    const picked = pickComparisonWinner(results);

    expect(picked.winner).toBe('fundamental_flow');
    expect(picked.reason).toContain('No strategies met the minimum trade threshold (1)');
  });
});
