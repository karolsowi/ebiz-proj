import {
  strategyEngine,
  type RawSignals,
  type RuleBasedStrategyName,
  type StrategySuggestion,
} from './strategyEngine.js';
import { strategyMlFeatureService } from './strategyMlFeatureService.js';
import {
  scoreFeatureRowWithModel,
  trainBaselineMlModel,
  pearsonCorrelation,
  type BaselineMlModelArtifact,
  type BaselineMlScore,
} from './strategyMlModelService.js';
import {
  getWalkForwardBucketStart,
  splitTimeOrderedTrainValidation,
  type WalkForwardCadence,
} from './strategyMlWalkForwardService.js';

function buildBucketStartsInRange(
  startDate: string,
  endDate: string,
  cadence: WalkForwardCadence
): string[] {
  const buckets = new Set<string>();
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    buckets.add(getWalkForwardBucketStart(cursor, cadence));
  }
  return Array.from(buckets).sort();
}

export type MlExecutionStrategyName = 'ml_baseline' | 'hybrid_baseline';

interface MlModelSnapshot {
  bucketStart: string;
  model: BaselineMlModelArtifact;
  modelVersion: string;
  trainingStartDate: string | null;
  trainingRowCount: number;
  trainingEndDate: string | null;
  validationSampleSize: number;
  validationScoreLabelCorrelation: number | null;
}

export const ML_WALK_FORWARD_CADENCE = 'monthly' as const;
export const ML_TRAINING_LOOKBACK_MONTHS = 12;
export const ML_MIN_TRAINING_ROWS = 20;
export const ML_LABEL_HORIZON_DAYS = 5;
/** Most recent labeled rows reserved for score–label correlation before fitting. */
export const ML_VALIDATION_HOLDOUT_RATIO = 0.12;

export interface StrategyMlExecutionConfig {
  walkForwardCadence?: WalkForwardCadence;
  trainingLookbackMonths?: number;
  minTrainingRows?: number;
  labelHorizonDays?: number;
  /** 0 disables time-ordered validation holdout. */
  validationHoldoutRatio?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round(value: number, digits = 4): number {
  return parseFloat(value.toFixed(digits));
}

function buildTrainingDates(bucketStart: string, lookbackMonths: number): Date[] {
  const dates: Date[] = [];
  const bucketDate = new Date(`${bucketStart}T00:00:00.000Z`);

  for (let monthsBack = lookbackMonths; monthsBack >= 1; monthsBack--) {
    const date = new Date(Date.UTC(
      bucketDate.getUTCFullYear(),
      bucketDate.getUTCMonth() - monthsBack,
      1
    ));
    dates.push(date);
  }

  return dates;
}

function buildUniverseKey(symbols: string[]): string {
  return [...symbols].map((symbol) => symbol.toUpperCase()).sort().join(',');
}

function resolveMlConfig(
  config?: StrategyMlExecutionConfig
): Required<StrategyMlExecutionConfig> {
  const rawRatio = config?.validationHoldoutRatio ?? ML_VALIDATION_HOLDOUT_RATIO;
  const validationHoldoutRatio = Number.isFinite(rawRatio)
    ? Math.min(0.45, Math.max(0, rawRatio))
    : ML_VALIDATION_HOLDOUT_RATIO;
  return {
    walkForwardCadence: config?.walkForwardCadence ?? ML_WALK_FORWARD_CADENCE,
    trainingLookbackMonths: Math.max(1, Math.floor(
      config?.trainingLookbackMonths ?? ML_TRAINING_LOOKBACK_MONTHS
    )),
    minTrainingRows: Math.max(1, Math.floor(
      config?.minTrainingRows ?? ML_MIN_TRAINING_ROWS
    )),
    labelHorizonDays: Math.max(1, Math.floor(
      config?.labelHorizonDays ?? ML_LABEL_HORIZON_DAYS
    )),
    validationHoldoutRatio,
  };
}

export class StrategyMlStrategyService {
  private modelCache = new Map<string, MlModelSnapshot | null>();
  /** Coalesce concurrent snapshot builds (parallel symbol pool must not retrain N times). */
  private modelLoadInFlight = new Map<string, Promise<MlModelSnapshot | null>>();

  clearModelCache(): void {
    this.modelCache.clear();
    this.modelLoadInFlight.clear();
  }

  private buildNeutralMlSuggestion(
    symbol: string,
    strategy: MlExecutionStrategyName,
    signals: RawSignals,
    reason: string,
    meta?: Record<string, unknown>
  ): StrategySuggestion {
    return {
      symbol: symbol.toUpperCase(),
      strategy,
      signal: 'hold',
      convictionScore: 0.5,
      convictionPct: 50,
      signals,
      breakdown: {
        ml_baseline_score: {
          raw: 0,
          normalized: 0,
          weight: 1,
          contribution: 0,
          observed: false,
          observations: 0,
          coveragePct: 0,
          latestObservationDate: null,
          meta: { reason, ...meta },
        },
      },
      suggestedPositionPct: strategyEngine.computePositionSize(0.5),
    };
  }

  private buildMlOnlySuggestion(
    symbol: string,
    strategy: MlExecutionStrategyName,
    signals: RawSignals,
    mlScore: BaselineMlScore,
    snapshot: MlModelSnapshot,
    mlConfig: Required<StrategyMlExecutionConfig>
  ): StrategySuggestion {
    const conviction = clamp(mlScore.conviction, 0, 1);
    const normalizedScore = clamp(conviction * 2 - 1, -1, 1);

    return {
      symbol: symbol.toUpperCase(),
      strategy,
      signal: strategyEngine.convictionToSignal(conviction),
      convictionScore: round(conviction),
      convictionPct: Math.round(conviction * 100),
      signals,
      breakdown: {
        ml_baseline_score: {
          raw: round(mlScore.score, 6),
          normalized: round(normalizedScore),
          weight: 1,
          contribution: round(normalizedScore),
          observed: true,
          observations: snapshot.trainingRowCount,
          coveragePct: 1,
          latestObservationDate: snapshot.trainingEndDate,
          meta: {
            modelVersion: snapshot.modelVersion,
            bucketStart: snapshot.bucketStart,
            trainingStartDate: snapshot.trainingStartDate,
            trainingRowCount: snapshot.trainingRowCount,
            trainedThroughDate: snapshot.trainingEndDate,
            walkForwardCadence: mlConfig.walkForwardCadence,
            trainingLookbackMonths: mlConfig.trainingLookbackMonths,
            labelHorizonDays: mlConfig.labelHorizonDays,
            minTrainingRows: mlConfig.minTrainingRows,
            validationHoldoutRatio: mlConfig.validationHoldoutRatio,
            validationSampleSize: snapshot.validationSampleSize,
            validationScoreLabelCorrelation: snapshot.validationScoreLabelCorrelation,
            predictedReturnPct: mlScore.predictedReturnPct,
          },
        },
      },
      suggestedPositionPct: strategyEngine.computePositionSize(conviction),
    };
  }

  private buildHybridSuggestion(
    symbol: string,
    signals: RawSignals,
    ruleSuggestion: StrategySuggestion,
    mlScore: BaselineMlScore,
    snapshot: MlModelSnapshot,
    asOfDate: Date,
    mlConfig: Required<StrategyMlExecutionConfig>
  ): StrategySuggestion {
    const ruleDirectional = clamp(ruleSuggestion.convictionScore * 2 - 1, -1, 1);
    const mlDirectional = clamp(mlScore.conviction * 2 - 1, -1, 1);
    const combinedDirectional = clamp((ruleDirectional + mlDirectional) / 2, -1, 1);
    const conviction = (combinedDirectional + 1) / 2;

    return {
      symbol: symbol.toUpperCase(),
      strategy: 'hybrid_baseline',
      signal: strategyEngine.convictionToSignal(conviction),
      convictionScore: round(conviction),
      convictionPct: Math.round(conviction * 100),
      signals,
      breakdown: {
        hybrid_rule_score: {
          raw: round(ruleDirectional),
          normalized: round(ruleDirectional),
          weight: 0.5,
          contribution: round(ruleDirectional * 0.5),
          observed: true,
          observations: 1,
          coveragePct: 1,
          latestObservationDate: toDayString(asOfDate),
          meta: {
            sourceStrategy: ruleSuggestion.strategy,
            sourceSignal: ruleSuggestion.signal,
          },
        },
        hybrid_ml_score: {
          raw: round(mlScore.score, 6),
          normalized: round(mlDirectional),
          weight: 0.5,
          contribution: round(mlDirectional * 0.5),
          observed: true,
          observations: snapshot.trainingRowCount,
          coveragePct: 1,
          latestObservationDate: snapshot.trainingEndDate,
          meta: {
            modelVersion: snapshot.modelVersion,
            bucketStart: snapshot.bucketStart,
            trainingStartDate: snapshot.trainingStartDate,
            trainingRowCount: snapshot.trainingRowCount,
            trainedThroughDate: snapshot.trainingEndDate,
            walkForwardCadence: mlConfig.walkForwardCadence,
            trainingLookbackMonths: mlConfig.trainingLookbackMonths,
            labelHorizonDays: mlConfig.labelHorizonDays,
            minTrainingRows: mlConfig.minTrainingRows,
            validationHoldoutRatio: mlConfig.validationHoldoutRatio,
            validationSampleSize: snapshot.validationSampleSize,
            validationScoreLabelCorrelation: snapshot.validationScoreLabelCorrelation,
            predictedReturnPct: mlScore.predictedReturnPct,
          },
        },
      },
      suggestedPositionPct: strategyEngine.computePositionSize(conviction),
    };
  }

  private async getModelSnapshot(
    asOfDate: Date,
    universeSymbols: string[],
    config?: StrategyMlExecutionConfig,
    onActivity?: (message: string) => void
  ): Promise<MlModelSnapshot | null> {
    const mlConfig = resolveMlConfig(config);
    const bucketStart = getWalkForwardBucketStart(asOfDate, mlConfig.walkForwardCadence);
    const cacheKey = `${bucketStart}|${buildUniverseKey(universeSymbols)}|${JSON.stringify(mlConfig)}`;
    if (this.modelCache.has(cacheKey)) {
      return this.modelCache.get(cacheKey) ?? null;
    }
    const inflight = this.modelLoadInFlight.get(cacheKey);
    if (inflight) return inflight;

    const loadPromise = this.buildModelSnapshot(
      bucketStart,
      universeSymbols,
      mlConfig,
      cacheKey,
      onActivity
    );
    this.modelLoadInFlight.set(cacheKey, loadPromise);
    try {
      return await loadPromise;
    } finally {
      this.modelLoadInFlight.delete(cacheKey);
    }
  }

  private async buildModelSnapshot(
    bucketStart: string,
    universeSymbols: string[],
    mlConfig: Required<StrategyMlExecutionConfig>,
    cacheKey: string,
    onActivity?: (message: string) => void
  ): Promise<MlModelSnapshot | null> {
    const trainingDates = buildTrainingDates(bucketStart, mlConfig.trainingLookbackMonths);
    onActivity?.(
      `Building ML features for ${universeSymbols.length} symbols (${trainingDates.length} training dates)…`
    );
    const trainingRows = await strategyMlFeatureService.buildFeatureRows(
      universeSymbols,
      trainingDates,
      { horizonDays: mlConfig.labelHorizonDays }
    );
    onActivity?.('Training ML model for this month…');

    const labeledRows = trainingRows.filter(
      (row) =>
        row.asOfDate < bucketStart &&
        row.label.hasLabel &&
        row.label.forwardReturnPct !== null
    );

    if (labeledRows.length < mlConfig.minTrainingRows) {
      this.modelCache.set(cacheKey, null);
      return null;
    }

    const { trainRows, validationRows } = splitTimeOrderedTrainValidation(
      labeledRows,
      mlConfig.minTrainingRows,
      mlConfig.validationHoldoutRatio
    );

    const modelVersion = `baseline_live_${bucketStart}`;
    const model = trainBaselineMlModel(trainRows, modelVersion);

    let validationScoreLabelCorrelation: number | null = null;
    let validationSampleSize = 0;
    if (validationRows.length >= 2) {
      const xs = validationRows.map((row) => scoreFeatureRowWithModel(row, model).score);
      const ys = validationRows.map((row) => row.label.forwardReturnPct!);
      validationScoreLabelCorrelation = pearsonCorrelation(xs, ys);
      validationSampleSize = validationRows.length;
    }

    const snapshot: MlModelSnapshot = {
      bucketStart,
      model,
      modelVersion,
      trainingStartDate: trainRows[0]?.asOfDate ?? null,
      trainingRowCount: trainRows.length,
      trainingEndDate: trainRows[trainRows.length - 1]?.asOfDate ?? null,
      validationSampleSize,
      validationScoreLabelCorrelation,
    };

    this.modelCache.set(cacheKey, snapshot);
    return snapshot;
  }

  async buildSuggestion(
    symbol: string,
    strategy: MlExecutionStrategyName,
    signals: RawSignals,
    asOfDate: Date,
    universeSymbols: string[],
    config?: StrategyMlExecutionConfig,
    options?: { onActivity?: (message: string) => void }
  ): Promise<StrategySuggestion> {
    const mlConfig = resolveMlConfig(config);
    const bucketStart = getWalkForwardBucketStart(asOfDate, mlConfig.walkForwardCadence);
    const snapshot = await this.getModelSnapshot(
      asOfDate,
      universeSymbols,
      mlConfig,
      options?.onActivity
    );
    const ruleSuggestion = strategyEngine.buildSuggestion(
      symbol,
      'full_spectrum' as RuleBasedStrategyName,
      signals
    );

    if (!snapshot) {
      if (strategy === 'hybrid_baseline') {
        return {
          ...ruleSuggestion,
          strategy: 'hybrid_baseline',
          breakdown: {
            ...ruleSuggestion.breakdown,
            hybrid_ml_score: {
              raw: 0,
              normalized: 0,
              weight: 0.5,
              contribution: 0,
              observed: false,
              observations: 0,
              coveragePct: 0,
              latestObservationDate: null,
              meta: {
                reason: 'Insufficient training rows for ML snapshot',
                bucketStart,
                walkForwardCadence: mlConfig.walkForwardCadence,
                trainingLookbackMonths: mlConfig.trainingLookbackMonths,
                labelHorizonDays: mlConfig.labelHorizonDays,
                requiredTrainingRows: mlConfig.minTrainingRows,
              },
            },
          },
        };
      }

      return this.buildNeutralMlSuggestion(
        symbol,
        strategy,
        signals,
        'Insufficient training rows for ML snapshot',
        {
          bucketStart,
          walkForwardCadence: mlConfig.walkForwardCadence,
          trainingLookbackMonths: mlConfig.trainingLookbackMonths,
          labelHorizonDays: mlConfig.labelHorizonDays,
          requiredTrainingRows: mlConfig.minTrainingRows,
        }
      );
    }

    const featureRow = await strategyMlFeatureService.buildFeatureRowFromSignals(
      signals,
      asOfDate,
      { horizonDays: mlConfig.labelHorizonDays, includeLabel: false }
    );
    if (!featureRow) {
      return this.buildNeutralMlSuggestion(
        symbol,
        strategy,
        signals,
        'Unable to build ML feature row',
        {
          bucketStart,
          walkForwardCadence: mlConfig.walkForwardCadence,
          trainingLookbackMonths: mlConfig.trainingLookbackMonths,
          labelHorizonDays: mlConfig.labelHorizonDays,
          requiredTrainingRows: mlConfig.minTrainingRows,
        }
      );
    }

    const mlScore = scoreFeatureRowWithModel(featureRow, snapshot.model);

    if (strategy === 'hybrid_baseline') {
      return this.buildHybridSuggestion(
        symbol,
        signals,
        ruleSuggestion,
        mlScore,
        snapshot,
        asOfDate,
        mlConfig
      );
    }

    return this.buildMlOnlySuggestion(symbol, strategy, signals, mlScore, snapshot, mlConfig);
  }

  /**
   * Train and cache all walk-forward buckets for a backtest window (skips already-cached buckets).
   */
  async prewarmModelSnapshots(
    universeSymbols: string[],
    startDate: string,
    endDate: string,
    config?: StrategyMlExecutionConfig,
    onActivity?: (message: string) => void
  ): Promise<void> {
    const mlConfig = resolveMlConfig(config);
    const bucketStarts = buildBucketStartsInRange(
      startDate,
      endDate,
      mlConfig.walkForwardCadence
    );
    if (bucketStarts.length === 0) return;

    onActivity?.(
      `Pre-warming ${bucketStarts.length} ML bucket(s) for ${universeSymbols.length} symbols…`
    );
    for (let i = 0; i < bucketStarts.length; i++) {
      const bucketStart = bucketStarts[i]!;
      onActivity?.(`Pre-warming ML bucket ${i + 1}/${bucketStarts.length} (${bucketStart})…`);
      await this.getModelSnapshot(
        new Date(`${bucketStart}T12:00:00.000Z`),
        universeSymbols,
        mlConfig,
        onActivity
      );
    }
  }
}

export const strategyMlStrategyService = new StrategyMlStrategyService();
