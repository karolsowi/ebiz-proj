import type { ComparisonConfig, StrategyComparisonReport, StrategyResult } from './strategyComparison.js';
import type { ResearchUniverseDiagnostics } from './researchUniverseService.js';
import type { BacktestResumeState, BacktestStrategyName } from './strategyBacktester.js';

export type ComparisonJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ComparisonJobType = 'comparison' | 'auto_tune';

export interface ComparisonJobCheckpoint {
  version: 1;
  effectiveConfig: ComparisonConfig;
  universeDiagnostics: ResearchUniverseDiagnostics | null;
  completedResults: Partial<Record<BacktestStrategyName, StrategyResult>>;
  /** Per-strategy mid-run state (supports parallel in-flight backtests). */
  inFlightResumes?: Partial<Record<BacktestStrategyName, BacktestResumeState>>;
  /** @deprecated use inFlightResumes */
  currentStrategy?: BacktestStrategyName;
  /** @deprecated use inFlightResumes */
  backtestResume?: BacktestResumeState;
}

export interface ComparisonJobProgress {
  phase: string;
  overallPct?: number;
  message?: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ComparisonJobRecord {
  id: number;
  jobType: ComparisonJobType;
  status: ComparisonJobStatus;
  requestConfig: ComparisonConfig;
  checkpoint: ComparisonJobCheckpoint | null;
  progress: ComparisonJobProgress | null;
  result: StrategyComparisonReport | null;
  errorMessage: string | null;
  runIds: Record<string, number> | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export class ComparisonPausedError extends Error {
  readonly checkpoint: ComparisonJobCheckpoint;

  constructor(checkpoint: ComparisonJobCheckpoint) {
    super('Comparison paused');
    this.name = 'ComparisonPausedError';
    this.checkpoint = checkpoint;
  }
}

export class ComparisonCancelledError extends Error {
  constructor() {
    super('Comparison cancelled');
    this.name = 'ComparisonCancelledError';
  }
}
