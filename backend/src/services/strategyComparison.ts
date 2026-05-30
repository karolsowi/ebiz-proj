import {
  BACKTEST_STRATEGIES,
  strategyBacktester,
  type BacktestConfig,
  type BacktestProgressEvent,
  type BacktestResult,
  type SimulatedTrade,
  type EquityPoint,
  type BacktestStrategyName,
} from './strategyBacktester.js';
import { performanceMetrics, type PerformanceReport } from './performanceMetrics.js';
import {
  researchUniverseService,
  type ResearchUniverseDiagnostics,
  type ResearchUniverseSelection,
} from './researchUniverseService.js';
import { buildSpyBenchmarkSnapshot, type SpyBenchmarkSnapshot } from './spyBenchmarkService.js';
import type { StrategyMlExecutionConfig } from './strategyMlStrategyService.js';
import {
  benchmarkOverallPct,
  parallelStrategyOverallPct,
  PROGRESS_WEIGHTS,
  strategyOverallPct,
  universeOverallPct,
} from './comparisonProgress.js';
import type { BacktestResumeState } from './strategyBacktester.js';
import type { UniverseResolveProgressCallback } from './researchUniverseService.js';
import type { ComparisonJobCheckpoint } from './comparisonJobTypes.js';
import {
  ComparisonPausedError,
} from './comparisonJobTypes.js';

const MIN_WINNER_TRADES = 1;

export interface ComparisonRunOptions {
  checkpoint?: ComparisonJobCheckpoint | null;
  shouldPause?: () => boolean | Promise<boolean>;
  onCheckpoint?: (checkpoint: ComparisonJobCheckpoint) => void | Promise<void>;
}

export type ComparisonProgressEvent =
  | { phase: 'universe_resolve_start'; overallPct: number; message: string }
  | {
      phase: 'universe_resolve_step';
      step: string;
      stepIndex: number;
      stepTotal: number;
      overallPct: number;
      message: string;
    }
  | { phase: 'universe_resolve'; symbolCount: number; overallPct: number; message: string }
  | {
      phase: 'strategy_start';
      strategy: BacktestStrategyName;
      strategyIndex: number;
      strategyTotal: number;
      symbolCount: number;
      overallPct: number;
      message: string;
    }
  | {
      phase: 'backtest_day';
      strategy: BacktestStrategyName;
      strategyIndex: number;
      strategyTotal: number;
      symbolCount: number;
      dayIndex: number;
      totalDays: number;
      date: string;
      tradesSoFar: number;
      equity: number;
      pctComplete: number;
      overallPct: number;
      message: string;
    }
  | {
      phase: 'strategy_prep';
      strategy: BacktestStrategyName;
      strategyIndex: number;
      strategyTotal: number;
      symbolCount: number;
      overallPct: number;
      message: string;
    }
  | {
      phase: 'strategy_metrics';
      strategy: BacktestStrategyName;
      strategyIndex: number;
      strategyTotal: number;
      overallPct: number;
      message: string;
    }
  | {
      phase: 'strategy_done';
      strategy: BacktestStrategyName;
      strategyIndex: number;
      strategyTotal: number;
      elapsedMs: number;
      totalReturnPct: number;
      totalTrades: number;
      overallPct: number;
      message: string;
    }
  | { phase: 'benchmark_build'; overallPct: number; message: string }
  | { phase: 'align_curves'; overallPct: number; message: string };

export type ComparisonProgressCallback = (event: ComparisonProgressEvent) => void;

export interface ComparisonConfig {
  symbols?: string[];
  universeSelection?: ResearchUniverseSelection;
  mlConfig?: StrategyMlExecutionConfig;
  startDate: string;           // 'YYYY-MM-DD'
  endDate: string;             // 'YYYY-MM-DD'
  initialCapital: number;
  convictionThreshold: number;
  maxPositionPct: number;
  stopLossEnabled: boolean;
  takeProfitEnabled: boolean;
  executionMode: BacktestConfig['executionMode'];
  slippageBps: number;
  commissionBps: number;
  rebalanceIntervalDays: number;
  barPathModel?: BacktestConfig['barPathModel'];
  liquidityImpactSqrtCoef?: number;
  advVolumeLookbackDays?: number;
  maxAdvParticipationPct?: number;
  /**
   * How many strategies to simulate at once (1 = sequential, 5 = all five in parallel).
   * Parallel mode uses more DB connections and is recommended for large universes.
   */
  strategyParallelism?: number;
  /** Concurrent symbol evaluations per rebalance day (uses CPU; default ~10–16). */
  symbolParallelism?: number;
  /** Optional live progress for scripts / long-running API jobs. */
  onProgress?: ComparisonProgressCallback;
  /**
   * On resume: drop mid-run backtest state for these strategies and run them from day 1.
   * Completed strategies in the checkpoint are never re-run.
   */
  restartStrategies?: BacktestStrategyName[];
}

export interface StrategyResult {
  strategy: BacktestStrategyName;
  performance: PerformanceReport;
  equityCurve: EquityPoint[];
  trades: SimulatedTrade[];
  backtest: BacktestResult;
}

export interface StrategyComparisonReport {
  config: ComparisonConfig;
  universeDiagnostics: ResearchUniverseDiagnostics | null;
  results: Record<BacktestStrategyName, StrategyResult>;
  winner: BacktestStrategyName;          // highest eligible Sharpe ratio
  winnerReason: string;          // includes eligibility and ranking rationale
  generatedAt: string;           // ISO timestamp
  benchmarkCurve?: EquityPoint[];
  benchmark?: SpyBenchmarkSnapshot;
}

interface WinnerEntry {
  strategy: BacktestStrategyName;
  sharpe: number;
  returnPct: number;
  totalTrades: number;
  eligible: boolean;
}

function compareWinnerEntries(a: WinnerEntry, b: WinnerEntry): number {
  if (b.sharpe !== a.sharpe) return b.sharpe - a.sharpe;
  return b.returnPct - a.returnPct;
}

export function pickComparisonWinner(
  results: Record<BacktestStrategyName, StrategyResult>
): { winner: BacktestStrategyName; reason: string } {
  const entries: WinnerEntry[] = BACKTEST_STRATEGIES.map((strategy) => ({
    strategy,
    sharpe: results[strategy].performance.sharpeRatio,
    returnPct: results[strategy].performance.totalReturnPct,
    totalTrades: results[strategy].performance.totalTrades,
    eligible: results[strategy].performance.totalTrades >= MIN_WINNER_TRADES,
  }));

  const eligibleEntries = entries.filter((entry) => entry.eligible);
  const rankedEntries = [...(eligibleEntries.length > 0 ? eligibleEntries : entries)]
    .sort(compareWinnerEntries);

  const winner = rankedEntries[0]!.strategy;
  const rankedSummary = rankedEntries
    .map((entry) =>
      `${entry.strategy} Sharpe ${entry.sharpe.toFixed(2)}, return ${entry.returnPct.toFixed(2)}%, trades ${entry.totalTrades}`
    )
    .join(' vs ');

  if (eligibleEntries.length === 0) {
    return {
      winner,
      reason: `No strategies met the minimum trade threshold (${MIN_WINNER_TRADES}). Fallback ranking used: ${rankedSummary}`,
    };
  }

  const excludedSummary = entries
    .filter((entry) => !entry.eligible)
    .map((entry) => `${entry.strategy} (${entry.totalTrades} trades)`)
    .join(', ');

  const exclusionNote = excludedSummary.length > 0
    ? ` Excluded inactive strategies: ${excludedSummary}.`
    : '';

  return {
    winner,
    reason: `Eligible strategies ranked by Sharpe, then total return: ${rankedSummary}.${exclusionNote}`,
  };
}

class StrategyComparisonService {
  private toBacktestConfig(
    config: ComparisonConfig,
    strategy: BacktestStrategyName,
    universeDiagnostics: ResearchUniverseDiagnostics | null
  ): BacktestConfig {
    return {
      symbols:             config.symbols ?? [],
      strategy,
      startDate:           config.startDate,
      endDate:             config.endDate,
      initialCapital:      config.initialCapital,
      convictionThreshold: config.convictionThreshold,
      maxPositionPct:      config.maxPositionPct,
      stopLossEnabled:     config.stopLossEnabled,
      takeProfitEnabled:   config.takeProfitEnabled,
      executionMode:       config.executionMode,
      slippageBps:         config.slippageBps,
      commissionBps:       config.commissionBps,
      rebalanceIntervalDays: config.rebalanceIntervalDays,
      ...(config.barPathModel !== undefined ? { barPathModel: config.barPathModel } : {}),
      ...(config.liquidityImpactSqrtCoef !== undefined
        ? { liquidityImpactSqrtCoef: config.liquidityImpactSqrtCoef }
        : {}),
      ...(config.advVolumeLookbackDays !== undefined
        ? { advVolumeLookbackDays: config.advVolumeLookbackDays }
        : {}),
      ...(config.maxAdvParticipationPct !== undefined
        ? { maxAdvParticipationPct: config.maxAdvParticipationPct }
        : {}),
      ...(config.mlConfig ? { mlConfig: config.mlConfig } : {}),
      ...(universeDiagnostics ? { universeDiagnostics } : {}),
      ...(config.symbolParallelism !== undefined
        ? { symbolParallelism: config.symbolParallelism }
        : {}),
    };
  }

  private async runOneComparisonStrategy(
    strategy: BacktestStrategyName,
    strategyIndex: number,
    effectiveConfig: ComparisonConfig,
    universeDiagnostics: ResearchUniverseDiagnostics | null,
    config: ComparisonConfig,
    ctx: {
      strategyTotal: number;
      symbolCount: number;
      shouldPause?: () => boolean | Promise<boolean>;
      resumeState?: BacktestResumeState;
      overallPctForInner: (innerFraction: number) => number;
      onStrategyCheckpoint?: (resume: BacktestResumeState) => void | Promise<void>;
    }
  ): Promise<StrategyResult> {
    const {
      strategyTotal,
      symbolCount,
      shouldPause,
      resumeState,
      overallPctForInner,
      onStrategyCheckpoint,
    } = ctx;

    console.log(`\n── Running backtest: ${strategy} (${strategyIndex}/${strategyTotal}) ──`);

    const resumeDay = resumeState?.nextDayIndex;
    const resumeTrades = resumeState?.allTrades.length ?? 0;
    config.onProgress?.({
      phase: 'strategy_start',
      strategy,
      strategyIndex,
      strategyTotal,
      symbolCount,
      overallPct: overallPctForInner(0),
      message:
        resumeState && resumeDay != null
          ? `Resuming ${strategy} at day ${resumeDay + 1} (${resumeTrades} trades so far)…`
          : `Starting ${strategy} (${symbolCount} symbols per day)`,
    });

    const strategyStartedAt = Date.now();
    const backtestConfig = this.toBacktestConfig(
      effectiveConfig,
      strategy,
      universeDiagnostics
    );
    let lastInnerFraction = resumeState
      ? Math.min(0.92, resumeState.nextDayIndex / Math.max(resumeState.equityCurve.length, 1))
      : 0;

    backtestConfig.onProgress = (dayEvent: BacktestProgressEvent) => {
      const inner = dayEvent.pctComplete / 100;
      lastInnerFraction = inner * 0.92;
      config.onProgress?.({
        phase: 'backtest_day',
        strategy,
        strategyIndex,
        strategyTotal,
        symbolCount,
        dayIndex: dayEvent.dayIndex,
        totalDays: dayEvent.totalDays,
        date: dayEvent.date,
        tradesSoFar: dayEvent.tradesSoFar,
        equity: dayEvent.equity,
        pctComplete: dayEvent.pctComplete,
        overallPct: overallPctForInner(lastInnerFraction),
        message: `Simulating trading day ${dayEvent.dayIndex + 1}/${dayEvent.totalDays}`,
      });
    };
    backtestConfig.onActivity = (message) => {
      config.onProgress?.({
        phase: 'strategy_prep',
        strategy,
        strategyIndex,
        strategyTotal,
        symbolCount,
        overallPct: overallPctForInner(lastInnerFraction),
        message,
      });
    };

    const resumableOpts: import('./strategyBacktester.js').BacktestResumableOptions = {};
    if (resumeState) resumableOpts.resume = resumeState;
    if (shouldPause) resumableOpts.shouldPause = shouldPause;
    if (onStrategyCheckpoint) {
      resumableOpts.onPeriodicCheckpoint = onStrategyCheckpoint;
    }

    const outcome = await strategyBacktester.runBacktestResumable(backtestConfig, resumableOpts);

    if (outcome.status === 'paused') {
      throw new ComparisonPausedError({
        version: 1,
        effectiveConfig,
        universeDiagnostics,
        completedResults: {},
        inFlightResumes: { [strategy]: outcome.resume },
        currentStrategy: strategy,
        backtestResume: outcome.resume,
      });
    }

    const backtest = outcome.result;

    config.onProgress?.({
      phase: 'strategy_metrics',
      strategy,
      strategyIndex,
      strategyTotal,
      overallPct: overallPctForInner(0.94),
      message: `Computing Sharpe, drawdown, and benchmark alpha for ${strategy}`,
    });

    const performance = await performanceMetrics.compute(backtest, backtestConfig);

    config.onProgress?.({
      phase: 'strategy_done',
      strategy,
      strategyIndex,
      strategyTotal,
      elapsedMs: Date.now() - strategyStartedAt,
      totalReturnPct: performance.totalReturnPct,
      totalTrades: performance.totalTrades,
      overallPct: overallPctForInner(1),
      message: `Completed ${strategy}: ${performance.totalReturnPct.toFixed(2)}% · ${performance.totalTrades} trades`,
    });

    return {
      strategy,
      performance,
      equityCurve: backtest.equityCurve,
      trades: backtest.trades,
      backtest,
    };
  }

  private async resolveComparisonUniverse(
    config: ComparisonConfig,
    onUniverseProgress?: UniverseResolveProgressCallback
  ): Promise<{ symbols: string[]; universeDiagnostics: ResearchUniverseDiagnostics | null }> {
    if (config.universeSelection) {
      const resolved = await researchUniverseService.resolveUniverse(
        {
          ...config.universeSelection,
          asOfDate: config.universeSelection.asOfDate ?? config.startDate,
        },
        onUniverseProgress
      );
      return {
        symbols: resolved.symbols,
        universeDiagnostics: resolved.diagnostics,
      };
    }

    if (Array.isArray(config.symbols) && config.symbols.length > 0) {
      return {
        symbols: config.symbols.map((symbol) => symbol.toUpperCase()),
        universeDiagnostics: null,
      };
    }

    throw new Error('Comparison config requires either symbols or universeSelection');
  }

  /**
   * Aligns equity curves so all compared strategies have an entry for every trading day.
   * Without alignment, charts would have mismatched x-axes.
   *
   * Algorithm:
   *   1. Collect union of all dates from all equity curves
   *   2. For each strategy: if a date is missing, carry forward the last equity value
   */
  private alignEquityCurves(
    results: Partial<Record<BacktestStrategyName, StrategyResult>>
  ): void {
    // 1. Union of all dates (sorted ascending)
    const dateSet = new Set<string>();
    for (const r of Object.values(results)) {
      if (r) r.equityCurve.forEach(p => dateSet.add(p.date));
    }
    const allDates = Array.from(dateSet).sort();

    // 2. Forward-fill each curve
    for (const r of Object.values(results)) {
      if (!r) continue;

      const byDate = new Map<string, EquityPoint>(
        r.equityCurve.map(p => [p.date, p])
      );

      let lastEquity = r.backtest.config.initialCapital;
      const aligned: EquityPoint[] = [];

      for (const date of allDates) {
        if (byDate.has(date)) {
          const point = byDate.get(date)!;
          lastEquity = point.equity;
          aligned.push(point);
        } else {
          // Forward-fill: carry last known equity
          aligned.push({
            date,
            equity:          lastEquity,
            cash:            lastEquity, // approximate (all cash, no open positions)
            positionsValue:  0,
          });
        }
      }

      r.equityCurve = aligned;
    }
  }

  /**
   * Run all configured strategies over the same period and compare.
   * Use strategyParallelism (1–5) to run multiple strategy backtests concurrently.
   */
  async compareStrategies(
    config: ComparisonConfig,
    runOptions?: ComparisonRunOptions
  ): Promise<StrategyComparisonReport> {
    const checkpoint = runOptions?.checkpoint ?? null;
    const shouldPause = runOptions?.shouldPause;
    const saveCheckpoint = runOptions?.onCheckpoint;

    const universeStepTotal = 3;

    let effectiveConfig: ComparisonConfig;
    let universeDiagnostics: ResearchUniverseDiagnostics | null;
    const results = {
      ...(checkpoint?.completedResults ?? {}),
    } as Record<BacktestStrategyName, StrategyResult>;

    if (checkpoint?.effectiveConfig) {
      effectiveConfig = {
        ...checkpoint.effectiveConfig,
        symbols: checkpoint.effectiveConfig.symbols ?? [],
        ...(config.mlConfig ? { mlConfig: { ...checkpoint.effectiveConfig.mlConfig, ...config.mlConfig } } : {}),
        ...(config.strategyParallelism !== undefined
          ? { strategyParallelism: config.strategyParallelism }
          : {}),
        ...(config.symbolParallelism !== undefined
          ? { symbolParallelism: config.symbolParallelism }
          : {}),
        ...(config.rebalanceIntervalDays !== undefined
          ? { rebalanceIntervalDays: config.rebalanceIntervalDays }
          : {}),
      };
      universeDiagnostics = checkpoint.universeDiagnostics;
      const symbolCountResolved = (effectiveConfig.symbols ?? []).length;
      config.onProgress?.({
        phase: 'universe_resolve',
        symbolCount: symbolCountResolved,
        overallPct: PROGRESS_WEIGHTS.universeEnd,
        message: `Resuming — ${symbolCountResolved} symbols, ${Object.keys(results).length}/${BACKTEST_STRATEGIES.length} strategies done`,
      });
    } else {
      config.onProgress?.({
        phase: 'universe_resolve_start',
        overallPct: universeOverallPct(0, universeStepTotal),
        message: config.universeSelection
          ? 'Point-in-time index universe (this can take a few minutes for S&P 500)…'
          : 'Preparing symbol list…',
      });

      const resolvedUniverse = await this.resolveComparisonUniverse(config, (step) => {
        config.onProgress?.({
          phase: 'universe_resolve_step',
          step: step.step,
          stepIndex: step.stepIndex,
          stepTotal: step.stepTotal,
          overallPct: universeOverallPct(step.stepIndex, step.stepTotal),
          message: step.message,
        });
      });

      effectiveConfig = {
        ...config,
        symbols: resolvedUniverse.symbols,
        ...(config.universeSelection ? { universeSelection: config.universeSelection } : {}),
      };
      universeDiagnostics = resolvedUniverse.universeDiagnostics;

      config.onProgress?.({
        phase: 'universe_resolve',
        symbolCount: resolvedUniverse.symbols.length,
        overallPct: PROGRESS_WEIGHTS.universeEnd,
        message: `${resolvedUniverse.symbols.length} symbols ready — running ${BACKTEST_STRATEGIES.length} strategies`,
      });
    }

    const resolvedSymbols = effectiveConfig.symbols ?? [];
    effectiveConfig = { ...effectiveConfig, symbols: resolvedSymbols };

    const strategyTotal = BACKTEST_STRATEGIES.length;
    const symbolCount = resolvedSymbols.length;
    const parallelism = Math.min(
      strategyTotal,
      Math.max(1, Math.floor(config.strategyParallelism ?? 1))
    );
    const inFlightInner = new Map<number, number>();
    let completedCount = BACKTEST_STRATEGIES.filter((s) => results[s]).length;

    const overallPctForStrategy = (
      strategyIndex: number,
      innerFraction: number
    ): number => {
      if (parallelism <= 1) {
        return strategyOverallPct(strategyIndex, strategyTotal, innerFraction);
      }
      inFlightInner.set(strategyIndex, innerFraction);
      return parallelStrategyOverallPct(strategyTotal, completedCount, inFlightInner);
    };

    let checkpointChain = Promise.resolve();

    const inFlightResumes: Partial<Record<BacktestStrategyName, BacktestResumeState>> = {
      ...(checkpoint?.inFlightResumes ?? {}),
    };
    if (
      checkpoint?.currentStrategy &&
      checkpoint.backtestResume &&
      !results[checkpoint.currentStrategy]
    ) {
      inFlightResumes[checkpoint.currentStrategy] = checkpoint.backtestResume;
    }
    const restartStrategies = config.restartStrategies ?? [];
    for (const strategy of restartStrategies) {
      delete inFlightResumes[strategy];
    }

    const persistCheckpoint = (partial?: Partial<ComparisonJobCheckpoint>) => {
      if (partial?.inFlightResumes) {
        Object.assign(inFlightResumes, partial.inFlightResumes);
      }
      const cp: ComparisonJobCheckpoint = {
        version: 1,
        effectiveConfig,
        universeDiagnostics,
        completedResults: { ...results },
        inFlightResumes: { ...inFlightResumes },
        ...partial,
      };
      cp.completedResults = { ...results };
      cp.inFlightResumes = { ...inFlightResumes };
      checkpointChain = checkpointChain.then(() => saveCheckpoint?.(cp) ?? Promise.resolve());
      return checkpointChain;
    };

    if (parallelism > 1) {
      config.onProgress?.({
        phase: 'universe_resolve',
        symbolCount,
        overallPct: PROGRESS_WEIGHTS.universeEnd,
        message: `${symbolCount} symbols — ${strategyTotal} strategies in parallel (${parallelism} workers)`,
      });
    }

    const runStrategy = async (
      strategy: BacktestStrategyName,
      resumeState?: BacktestResumeState
    ): Promise<void> => {
      const strategyIndex = BACKTEST_STRATEGIES.indexOf(strategy) + 1;
      let lastPeriodicCheckpointMs = 0;
      try {
        results[strategy] = await this.runOneComparisonStrategy(
          strategy,
          strategyIndex,
          effectiveConfig,
          universeDiagnostics,
          config,
          {
            strategyTotal,
            symbolCount,
            ...(shouldPause ? { shouldPause } : {}),
            ...(resumeState ? { resumeState } : {}),
            overallPctForInner: (inner) => overallPctForStrategy(strategyIndex, inner),
            onStrategyCheckpoint: async (resume) => {
              const now = Date.now();
              if (now - lastPeriodicCheckpointMs < 30_000) return;
              lastPeriodicCheckpointMs = now;
              await persistCheckpoint({
                inFlightResumes: { [strategy]: resume },
              });
            },
          }
        );
        inFlightInner.delete(strategyIndex);
        completedCount += 1;
        delete inFlightResumes[strategy];
        await persistCheckpoint();
      } catch (err) {
        inFlightInner.delete(strategyIndex);
        if (err instanceof ComparisonPausedError) {
          err.checkpoint.completedResults = { ...results, ...err.checkpoint.completedResults };
          if (err.checkpoint.inFlightResumes) {
            Object.assign(inFlightResumes, err.checkpoint.inFlightResumes);
          } else if (err.checkpoint.currentStrategy && err.checkpoint.backtestResume) {
            inFlightResumes[err.checkpoint.currentStrategy] = err.checkpoint.backtestResume;
          }
          await persistCheckpoint({
            inFlightResumes: { ...inFlightResumes },
          });
        }
        throw err;
      }
    };

    const pending = BACKTEST_STRATEGIES.filter((s) => !results[s]);

    for (let offset = 0; offset < pending.length; ) {
      if (shouldPause && (await shouldPause())) {
        const cp: ComparisonJobCheckpoint = {
          version: 1,
          effectiveConfig,
          universeDiagnostics,
          completedResults: { ...results },
        };
        await persistCheckpoint();
        throw new ComparisonPausedError(cp);
      }

      const batch = pending.slice(offset, offset + parallelism);
      offset += batch.length;

      const batchResults = await Promise.allSettled(
        batch.map((strategy) =>
          runStrategy(strategy, inFlightResumes[strategy])
        )
      );

      for (const outcome of batchResults) {
        if (outcome.status === 'rejected') {
          throw outcome.reason;
        }
      }
    }

    await checkpointChain;

    config.onProgress?.({
      phase: 'align_curves',
      overallPct: benchmarkOverallPct(0.2),
      message: 'Aligning equity curves across strategies…',
    });

    // Align equity curves before returning (so all have same date set)
    this.alignEquityCurves(results);

    config.onProgress?.({
      phase: 'benchmark_build',
      overallPct: benchmarkOverallPct(0.5),
      message: 'Building S&P 500 buy-and-hold benchmark…',
    });

    const firstCurve = Object.values(results)[0]?.equityCurve || [];
    const benchmark =
      firstCurve.length > 0
        ? await buildSpyBenchmarkSnapshot(
            firstCurve.map((p) => p.date),
            effectiveConfig.initialCapital
          )
        : null;

    config.onProgress?.({
      phase: 'benchmark_build',
      overallPct: PROGRESS_WEIGHTS.benchmarkEnd,
      message: 'Benchmark ready',
    });
    const benchmarkCurve = benchmark?.equityCurve;

    const { winner, reason } = pickComparisonWinner(results);

    console.log(`\n🏆 Winner: ${winner} (${reason})`);

    return {
      config: effectiveConfig,
      universeDiagnostics,
      results,
      winner,
      winnerReason: reason,
      generatedAt: new Date().toISOString(),
      ...(benchmarkCurve ? { benchmarkCurve } : {}),
      ...(benchmark ? { benchmark } : {}),
    };
  }
}

export const strategyComparison = new StrategyComparisonService();
