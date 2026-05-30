export type BacktestStrategyName = 'social_momentum' | 'fundamental_flow' | 'full_spectrum' | 'ml_baseline' | 'hybrid_baseline';

export interface PerformanceReport {
  totalReturnPct: number;
  annualizedReturnPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  winRatePct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  benchmarkSymbol?: 'SPY' | null;
  benchmarkReturnPct?: number | null;
  alpha?: number | null;
}

export interface EquityPoint {
  date: string;
  equity: number;
  cash: number;
  positionsValue: number;
}

export interface SimulatedTrade {
  symbol: string;
  strategy: BacktestStrategyName;
  side: 'buy' | 'sell';
  date: string;
  price: number;
  quantity: number;
  value: number;
  reason?: string;
  conviction: number;
  pnl?: number;
}

export interface StrategyMetadata {
  modelVersions: string[];
  [key: string]: unknown;
}

export interface StrategyResult {
  strategy: BacktestStrategyName;
  performance: PerformanceReport;
  equityCurve: EquityPoint[];
  trades: SimulatedTrade[];
  backtest: {
    strategyMetadata: StrategyMetadata;
  };
}

export interface ResearchUniverseSelection {
  methodology?: string;
  indexCode?: string;
  asOfDate: string;
  priceFilter?: string;
  minHistoryTradingDays?: number;
}

export interface StrategyMlExecutionConfig {
  walkForwardCadence?: 'monthly' | 'quarterly';
  trainingLookbackMonths?: number;
  minTrainingRows?: number;
  labelHorizonDays?: number;
  /** Fraction of recent training rows held out for diagnostics (0–0.45). */
  validationHoldoutRatio?: number;
}

export interface BacktestComparisonConfig {
  symbols?: string[];
  universeSelection?: ResearchUniverseSelection;
  startDate: string;
  endDate: string;
  initialCapital: number;
  convictionThreshold: number;
  maxPositionPct: number;
  stopLossEnabled: boolean;
  takeProfitEnabled: boolean;
  executionMode?: string;
  slippageBps?: number;
  commissionBps?: number;
  rebalanceIntervalDays?: number;
  barPathModel?: string;
  liquidityImpactSqrtCoef?: number;
  advVolumeLookbackDays?: number;
  maxAdvParticipationPct?: number;
  /** Walk-forward ML settings for ml_baseline and hybrid_baseline. */
  mlConfig?: StrategyMlExecutionConfig;
  /** ATR multiplier for stop-loss distance. Default 2.0 (entry - 2×ATR). Higher = wider stop. */
  stopLossAtrMultiplier?: number;
  /** ATR multiplier for take-profit distance. Default 4.0 (entry + 4×ATR). Higher = more room. */
  takeProfitAtrMultiplier?: number;
  /** 1 = sequential, 5 = run all five strategies in parallel (faster, more DB load). */
  strategyParallelism?: number;
  /** Concurrent symbol signal evaluations per rebalance day (default ~12 on 6-core CPUs). */
  symbolParallelism?: number;
  /** Resume only: restart these strategies from day 1 (keeps completedResults). */
  restartStrategies?: BacktestStrategyName[];
}

export interface ComparisonJobResumeOptions {
  config?: Partial<BacktestComparisonConfig>;
  restartStrategies?: BacktestStrategyName[];
}

export interface ResearchUniverseDiagnostics {
  methodology: string;
  indexCode?: string;
  asOfDate: string;
  priceFilter: string;
  minHistoryTradingDays?: number;
  totalConstituents?: number;
  resolvedSymbols?: number;
  excludedForPriceData?: number;
  /** @deprecated legacy API shape */
  resolvedSymbolsCount?: number;
  /** @deprecated legacy API shape */
  droppedDueToPriceFilter?: number;
  coverageStatus?: string;
  notes?: string[];
}

export interface SpyBenchmarkSnapshot {
  symbol: 'SPY';
  label: string;
  equityCurve: EquityPoint[];
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  tradingDaysInPeriod: number;
}

export interface StrategyComparisonReport {
  config: BacktestComparisonConfig;
  universeDiagnostics: ResearchUniverseDiagnostics | null;
  results: Record<BacktestStrategyName, StrategyResult>;
  winner: BacktestStrategyName;
  winnerReason: string;
  generatedAt: string;
  runIds: Record<BacktestStrategyName, number>;
  benchmarkCurve?: EquityPoint[];
  benchmark?: SpyBenchmarkSnapshot;
}

export type AutoTuneObjective = 'alpha' | 'beat_spy' | 'sharpe';

export interface AutoTuneTrialSummary {
  trialIndex: number;
  label: string;
  config: BacktestComparisonConfig;
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
  bestConfig: BacktestComparisonConfig;
  bestStrategy: BacktestStrategyName;
  bestScore: number;
  developmentReport: StrategyComparisonReport;
  validationReport: StrategyComparisonReport | null;
  trials: AutoTuneTrialSummary[];
}

export interface PastRun {
  id: number;
  strategy: BacktestStrategyName;
  startDate: string;
  endDate: string;
  symbols: string[];
  totalReturnPct: number;
  sharpeRatio: number;
  winRatePct: number;
  totalTrades: number;
  modelVersion: string | null;
  comparisonWinner: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface RunAnalysisParameterChange {
  param: string;
  oldValue: number | boolean;
  newValue: number | boolean;
  reason: string;
  expectedImpact: string;
}

export interface RunAnalysisResult {
  analysisId: number;
  runId: number;
  originalConfig: Record<string, unknown>;
  proposedConfig: Record<string, unknown>;
  parameterChanges: RunAnalysisParameterChange[];
  analysis: {
    convictionSensitivity: {
      rangeMin: number;
      rangeMax: number;
      tradeCount: number;
      winRate: number;
      avgPnl: number;
      totalPnl: number;
    }[];
    positionSizeImpact: {
      avgPositionPct: number;
      maxPositionPct: number;
      drawdownContributionBySize: { bucket: string; drawdownContribution: number }[];
      suggestedMaxPositionPct: number | null;
    };
    rebalanceTimingAnalysis: {
      currentIntervalDays: number;
      avgHoldingPeriodDays: number;
      shortHoldWinRate: number;
      longHoldWinRate: number;
      suggestedIntervalDays: number | null;
    };
    riskParamAnalysis: {
      stopLossHits: number;
      stopLossWhipsaws: number;
      takeProfitHits: number;
      takeProfitLeftOnTable: number;
      suggestTighterStopLoss: boolean;
      suggestLoosertakeProfit: boolean;
    };
  };
}
