import {
  strategyComparison,
  type ComparisonConfig,
  type ComparisonProgressCallback,
  type StrategyComparisonReport,
} from './strategyComparison.js';
import {
  BACKTEST_STRATEGIES,
  type BacktestStrategyName,
} from './strategyBacktester.js';

export type AutoTuneObjective = 'alpha' | 'beat_spy' | 'sharpe';

export interface AutoTuneRequest {
  /** Development-window comparison settings (dates = tune period). */
  baseConfig: ComparisonConfig;
  maxTrials?: number;
  objective?: AutoTuneObjective;
  /** Run 2023 (or custom) validation once with the winning config. */
  runValidation?: boolean;
  validationStartDate?: string;
  validationEndDate?: string;
}

export interface AutoTuneTrialSummary {
  trialIndex: number;
  label: string;
  config: ComparisonConfig;
  score: number;
  bestStrategy: BacktestStrategyName;
  bestReturnPct: number;
  spyReturnPct: number | null;
  beatSpy: boolean;
}

export interface AutoTuneResult {
  objective: AutoTuneObjective;
  trialsRun: number;
  bestLabel: string;
  bestConfig: ComparisonConfig;
  bestStrategy: BacktestStrategyName;
  bestScore: number;
  developmentReport: StrategyComparisonReport;
  validationReport: StrategyComparisonReport | null;
  trials: AutoTuneTrialSummary[];
}

export type AutoTuneProgressEvent =
  | { phase: 'auto_tune_start'; totalTrials: number; objective: AutoTuneObjective; message: string }
  | {
      phase: 'auto_tune_trial_start';
      trialIndex: number;
      totalTrials: number;
      label: string;
      overallPct: number;
      message: string;
    }
  | {
      phase: 'auto_tune_trial_done';
      trialIndex: number;
      totalTrials: number;
      label: string;
      score: number;
      bestStrategy: BacktestStrategyName;
      beatSpy: boolean;
      overallPct: number;
      message: string;
    }
  | {
      phase: 'auto_tune_validation_start';
      overallPct: number;
      message: string;
    }
  | { phase: 'auto_tune_complete'; overallPct: number; message: string }
  | {
      phase: 'comparison_progress';
      trialIndex: number;
      totalTrials: number;
      innerPct: number;
      overallPct: number;
      message: string;
      strategy?: BacktestStrategyName;
      strategyIndex?: number;
      strategyTotal?: number;
      innerPhase?: string;
      pctComplete?: number;
      dayIndex?: number;
      totalDays?: number;
      date?: string;
      tradesSoFar?: number;
    };

const DEFAULT_MAX_TRIALS = 6;

const CONVICTION_GRID = [0.58, 0.62, 0.66] as const;
const POSITION_GRID = [0.12, 0.18, 0.24] as const;
const REBALANCE_GRID = [3, 7] as const;

function spyReturnPct(report: StrategyComparisonReport): number | null {
  if (report.benchmark?.totalReturnPct != null) return report.benchmark.totalReturnPct;
  const first = Object.values(report.results)[0];
  return first?.performance.benchmarkReturnPct ?? null;
}

function trialLabel(config: ComparisonConfig): string {
  return `conv=${config.convictionThreshold.toFixed(2)} pos=${config.maxPositionPct.toFixed(2)} reb=${config.rebalanceIntervalDays}d`;
}

function strategyFieldsFromComparisonEvent(
  evt: Parameters<ComparisonProgressCallback>[0]
): Pick<
  AutoTuneProgressEvent & { phase: 'comparison_progress' },
  | 'strategy'
  | 'strategyIndex'
  | 'strategyTotal'
  | 'innerPhase'
  | 'pctComplete'
  | 'dayIndex'
  | 'totalDays'
  | 'date'
  | 'tradesSoFar'
> {
  const out: ReturnType<typeof strategyFieldsFromComparisonEvent> = {};
  if ('strategy' in evt && evt.strategy) out.strategy = evt.strategy;
  if ('strategyIndex' in evt && typeof evt.strategyIndex === 'number') {
    out.strategyIndex = evt.strategyIndex;
  }
  if ('strategyTotal' in evt && typeof evt.strategyTotal === 'number') {
    out.strategyTotal = evt.strategyTotal;
  }
  if ('phase' in evt && typeof evt.phase === 'string') out.innerPhase = evt.phase;
  if ('pctComplete' in evt && typeof evt.pctComplete === 'number') {
    out.pctComplete = evt.pctComplete;
  }
  if ('dayIndex' in evt && typeof evt.dayIndex === 'number') out.dayIndex = evt.dayIndex;
  if ('totalDays' in evt && typeof evt.totalDays === 'number') out.totalDays = evt.totalDays;
  if ('date' in evt && typeof evt.date === 'string') out.date = evt.date;
  if ('tradesSoFar' in evt && typeof evt.tradesSoFar === 'number') {
    out.tradesSoFar = evt.tradesSoFar;
  }
  return out;
}

function buildCandidateConfigs(base: ComparisonConfig, maxTrials: number): ComparisonConfig[] {
  const candidates: ComparisonConfig[] = [];
  for (const convictionThreshold of CONVICTION_GRID) {
    for (const maxPositionPct of POSITION_GRID) {
      for (const rebalanceIntervalDays of REBALANCE_GRID) {
        candidates.push({
          ...base,
          convictionThreshold,
          maxPositionPct,
          rebalanceIntervalDays,
        });
      }
    }
  }

  if (candidates.length <= maxTrials) return candidates;

  const picked: ComparisonConfig[] = [];
  const step = candidates.length / maxTrials;
  for (let i = 0; i < maxTrials; i++) {
    picked.push(candidates[Math.min(Math.floor(i * step), candidates.length - 1)]!);
  }
  return picked;
}

function scoreTrial(
  report: StrategyComparisonReport,
  objective: AutoTuneObjective
): { score: number; bestStrategy: BacktestStrategyName; beatSpy: boolean; bestReturnPct: number } {
  const spy = spyReturnPct(report);
  let bestStrategy: BacktestStrategyName = 'ml_baseline';
  let bestScore = -Infinity;
  let bestReturnPct = -Infinity;
  let beatSpy = false;

  for (const strategy of BACKTEST_STRATEGIES) {
    const p = report.results[strategy].performance;
    const beats = spy != null && p.totalReturnPct > spy;
    let score: number;
    if (objective === 'sharpe') {
      score = p.sharpeRatio;
    } else if (objective === 'beat_spy') {
      const alpha = p.alpha ?? (spy != null ? p.totalReturnPct - spy : p.totalReturnPct);
      score = beats ? 1000 + alpha : alpha;
    } else {
      score = p.alpha ?? (spy != null ? p.totalReturnPct - spy : p.totalReturnPct);
    }
    if (score > bestScore) {
      bestScore = score;
      bestStrategy = strategy;
      bestReturnPct = p.totalReturnPct;
      beatSpy = beats;
    }
  }

  return { score: bestScore, bestStrategy, beatSpy, bestReturnPct };
}

export async function runStrategyAutoTune(
  request: AutoTuneRequest,
  onProgress?: (event: AutoTuneProgressEvent) => void
): Promise<AutoTuneResult> {
  const maxTrials = Math.min(18, Math.max(1, request.maxTrials ?? DEFAULT_MAX_TRIALS));
  const objective = request.objective ?? 'alpha';
  const candidates = buildCandidateConfigs(request.baseConfig, maxTrials);
  const totalTrials = candidates.length;

  onProgress?.({
    phase: 'auto_tune_start',
    totalTrials,
    objective,
    message: `Auto-tune: ${totalTrials} development trials (objective: ${objective})`,
  });

  const trials: AutoTuneTrialSummary[] = [];
  let bestConfig = candidates[0]!;
  let bestReport: StrategyComparisonReport | null = null;
  let bestScore = -Infinity;
  let bestStrategy: BacktestStrategyName = 'ml_baseline';
  let bestLabel = trialLabel(bestConfig);

  for (let i = 0; i < candidates.length; i++) {
    const trialIndex = i + 1;
    const config = candidates[i]!;
    const label = trialLabel(config);
    const trialBasePct = (i / totalTrials) * 88;

    onProgress?.({
      phase: 'auto_tune_trial_start',
      trialIndex,
      totalTrials,
      label,
      overallPct: trialBasePct,
      message: `Trial ${trialIndex}/${totalTrials}: ${label}`,
    });

    const comparisonProgress: ComparisonProgressCallback = (evt) => {
      const inner =
        'overallPct' in evt && typeof evt.overallPct === 'number' ? evt.overallPct : 0;
      const mapped = trialBasePct + (inner / 100) * (88 / totalTrials);
      onProgress?.({
        phase: 'comparison_progress',
        trialIndex,
        totalTrials,
        innerPct: inner,
        overallPct: mapped,
        message:
          'message' in evt && typeof evt.message === 'string'
            ? `Trial ${trialIndex}/${totalTrials}: ${evt.message}`
            : `Trial ${trialIndex}/${totalTrials}`,
        ...strategyFieldsFromComparisonEvent(evt),
      });
    };

    const report = await strategyComparison.compareStrategies({
      ...config,
      onProgress: comparisonProgress,
    });

    const { score, bestStrategy: strat, beatSpy, bestReturnPct } = scoreTrial(report, objective);
    trials.push({
      trialIndex,
      label,
      config,
      score,
      bestStrategy: strat,
      beatSpy,
      bestReturnPct,
      spyReturnPct: spyReturnPct(report),
    });

    if (score > bestScore) {
      bestScore = score;
      bestConfig = config;
      bestReport = report;
      bestStrategy = strat;
      bestLabel = label;
    }

    onProgress?.({
      phase: 'auto_tune_trial_done',
      trialIndex,
      totalTrials,
      label,
      score,
      bestStrategy: strat,
      beatSpy,
      overallPct: ((i + 1) / totalTrials) * 88,
      message: `Trial ${trialIndex} done — ${strat} score ${score.toFixed(2)}${beatSpy ? ' (beat SPY)' : ''}`,
    });
  }

  if (!bestReport) {
    throw new Error('Auto-tune produced no successful trials');
  }

  let validationReport: StrategyComparisonReport | null = null;
  const runValidation = request.runValidation !== false;
  const valStart = request.validationStartDate ?? '2023-01-01';
  const valEnd = request.validationEndDate ?? '2023-12-31';

  if (runValidation) {
    onProgress?.({
      phase: 'auto_tune_validation_start',
      overallPct: 90,
      message: `Out-of-sample validation ${valStart} → ${valEnd} with best trial (${bestLabel})`,
    });

    validationReport = await strategyComparison.compareStrategies({
      ...bestConfig,
      startDate: valStart,
      endDate: valEnd,
      onProgress: (evt) => {
        const inner = 'overallPct' in evt && typeof evt.overallPct === 'number' ? evt.overallPct : 0;
        const mapped = 90 + (inner / 100) * 10;
        onProgress?.({
          phase: 'comparison_progress',
          trialIndex: totalTrials,
          totalTrials,
          innerPct: inner,
          overallPct: mapped,
          message:
            'message' in evt && typeof evt.message === 'string'
              ? `Validation: ${evt.message}`
              : 'Validation run',
          ...strategyFieldsFromComparisonEvent(evt),
        });
      },
    });
  }

  onProgress?.({
    phase: 'auto_tune_complete',
    overallPct: 100,
    message: `Best: ${bestLabel} → ${bestStrategy}${validationReport ? ' · validation complete' : ''}`,
  });

  return {
    objective,
    trialsRun: totalTrials,
    bestLabel,
    bestConfig,
    bestStrategy,
    bestScore,
    developmentReport: bestReport,
    validationReport,
    trials,
  };
}
