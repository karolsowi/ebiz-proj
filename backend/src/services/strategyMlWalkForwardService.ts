import type { StrategyMlFeatureRow } from './strategyMlFeatureService.js';
import {
  pearsonCorrelation,
  scoreFeatureRowWithModel,
  trainBaselineMlModel,
  type BaselineMlModelArtifact,
  type BaselineMlScore,
} from './strategyMlModelService.js';

export type WalkForwardCadence = 'monthly' | 'quarterly';

export interface WalkForwardConfig {
  cadence?: WalkForwardCadence;
  minTrainingRows?: number;
  lookbackDays?: number;
  modelVersionPrefix?: string;
  /** Fraction of most recent training rows held out for in-sample correlation diagnostics (0 disables). */
  validationHoldoutRatio?: number;
}

export interface WalkForwardModelSnapshot {
  bucketStart: string;
  trainingStartDate: string | null;
  trainingEndDate: string | null;
  trainingRowCount: number;
  validationRowCount: number;
  validationScoreLabelCorrelation: number | null;
  modelVersion: string;
  model: BaselineMlModelArtifact;
}

export interface WalkForwardScoredRow {
  bucketStart: string;
  modelVersion: string;
  trainedThroughDate: string | null;
  row: StrategyMlFeatureRow;
  score: BaselineMlScore;
}

export interface WalkForwardSkippedBucket {
  bucketStart: string;
  reason: string;
}

export interface WalkForwardResult {
  snapshots: WalkForwardModelSnapshot[];
  scoredRows: WalkForwardScoredRow[];
  skippedBuckets: WalkForwardSkippedBucket[];
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00.000Z`);
}

function toDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getWalkForwardBucketStart(
  value: string | Date,
  cadence: WalkForwardCadence = 'monthly'
): string {
  const date = toDate(value);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  if (cadence === 'quarterly') {
    const quarterMonth = Math.floor(month / 3) * 3;
    return toDayString(new Date(Date.UTC(year, quarterMonth, 1)));
  }

  return toDayString(new Date(Date.UTC(year, month, 1)));
}

export function buildWalkForwardBucketStarts(
  rows: StrategyMlFeatureRow[],
  cadence: WalkForwardCadence = 'monthly'
): string[] {
  return Array.from(
    new Set(rows.map((row) => getWalkForwardBucketStart(row.asOfDate, cadence)))
  ).sort();
}

function addDays(value: string, days: number): string {
  const date = toDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDayString(date);
}

/** Time-ordered holdout of the most recent labeled rows before the inference bucket. */
export function splitTimeOrderedTrainValidation(
  labeledRows: StrategyMlFeatureRow[],
  minTrainingRows: number,
  holdoutRatio: number
): { trainRows: StrategyMlFeatureRow[]; validationRows: StrategyMlFeatureRow[] } {
  const sorted = [...labeledRows].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  if (holdoutRatio <= 0 || sorted.length < minTrainingRows + 2) {
    return { trainRows: sorted, validationRows: [] };
  }
  const maxHoldout = Math.max(0, sorted.length - minTrainingRows);
  if (maxHoldout < 2) {
    return { trainRows: sorted, validationRows: [] };
  }
  const desired = Math.max(2, Math.floor(sorted.length * holdoutRatio));
  const nVal = Math.min(desired, maxHoldout);
  const validationRows = sorted.slice(-nVal);
  const trainRows = sorted.slice(0, -nVal);
  if (trainRows.length < minTrainingRows) {
    return { trainRows: sorted, validationRows: [] };
  }
  return { trainRows, validationRows };
}

function isWithinLookback(
  rowDate: string,
  bucketStart: string,
  lookbackDays: number | undefined
): boolean {
  if (!lookbackDays || lookbackDays <= 0) return true;
  const earliest = addDays(bucketStart, -lookbackDays);
  return rowDate >= earliest && rowDate < bucketStart;
}

export class StrategyMlWalkForwardService {
  runWalkForward(
    rows: StrategyMlFeatureRow[],
    config?: WalkForwardConfig
  ): WalkForwardResult {
    const cadence = config?.cadence ?? 'monthly';
    const minTrainingRows = Math.max(1, config?.minTrainingRows ?? 20);
    const modelVersionPrefix = config?.modelVersionPrefix ?? 'baseline_walkforward';
    const holdoutRatio = config?.validationHoldoutRatio ?? 0.12;
    const sortedRows = [...rows].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    const bucketStarts = buildWalkForwardBucketStarts(sortedRows, cadence);

    const snapshots: WalkForwardModelSnapshot[] = [];
    const scoredRows: WalkForwardScoredRow[] = [];
    const skippedBuckets: WalkForwardSkippedBucket[] = [];

    for (const bucketStart of bucketStarts) {
      const inferenceRows = sortedRows.filter(
        (row) => getWalkForwardBucketStart(row.asOfDate, cadence) === bucketStart
      );
      const trainingRows = sortedRows.filter(
        (row) =>
          row.asOfDate < bucketStart &&
          row.label.hasLabel &&
          row.label.forwardReturnPct !== null &&
          isWithinLookback(row.asOfDate, bucketStart, config?.lookbackDays)
      );

      if (trainingRows.length < minTrainingRows) {
        skippedBuckets.push({
          bucketStart,
          reason: `Need at least ${minTrainingRows} labeled rows before ${bucketStart}, got ${trainingRows.length}`,
        });
        continue;
      }

      const { trainRows, validationRows } = splitTimeOrderedTrainValidation(
        trainingRows,
        minTrainingRows,
        holdoutRatio
      );

      const modelVersion = `${modelVersionPrefix}_${bucketStart}`;
      const model = trainBaselineMlModel(trainRows, modelVersion);
      const trainingStartDate = trainRows[0]?.asOfDate ?? null;
      const trainingEndDate = trainRows[trainRows.length - 1]?.asOfDate ?? null;

      let validationScoreLabelCorrelation: number | null = null;
      let validationRowCount = 0;
      if (validationRows.length >= 2) {
        const xs = validationRows.map((row) => scoreFeatureRowWithModel(row, model).score);
        const ys = validationRows.map((row) => row.label.forwardReturnPct!);
        validationScoreLabelCorrelation = pearsonCorrelation(xs, ys);
        validationRowCount = validationRows.length;
      }

      snapshots.push({
        bucketStart,
        trainingStartDate,
        trainingEndDate,
        trainingRowCount: trainRows.length,
        validationRowCount,
        validationScoreLabelCorrelation,
        modelVersion,
        model,
      });

      for (const row of inferenceRows) {
        scoredRows.push({
          bucketStart,
          modelVersion,
          trainedThroughDate: trainingEndDate,
          row,
          score: scoreFeatureRowWithModel(row, model),
        });
      }
    }

    return {
      snapshots,
      scoredRows,
      skippedBuckets,
    };
  }
}

export const strategyMlWalkForwardService = new StrategyMlWalkForwardService();
