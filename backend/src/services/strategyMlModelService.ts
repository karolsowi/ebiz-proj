import type {
  StrategyMlFeatureRow,
  StrategyMlFeatureValues,
} from './strategyMlFeatureService.js';

export type MlFeatureName = keyof StrategyMlFeatureValues;

export interface BaselineFeatureStat {
  mean: number;
  stdDev: number;
  weight: number;
}

export interface BaselineLabelStat {
  mean: number;
  stdDev: number;
}

export interface BaselineMlModelArtifact {
  modelType: 'correlation_ranker_v1';
  modelVersion: string;
  trainedAt: string;
  trainingRowCount: number;
  featureStats: Record<MlFeatureName, BaselineFeatureStat>;
  labelStats: BaselineLabelStat;
}

export interface BaselineMlScore {
  score: number;
  predictedReturnPct: number;
  conviction: number;
  contributions: Partial<Record<MlFeatureName, number>>;
}

function round(value: number, digits = 6): number {
  return parseFloat(value.toFixed(digits));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[], avg?: number): number {
  if (values.length < 2) return 0;
  const mu = avg ?? mean(values);
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - mu, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function correlation(xValues: number[], yValues: number[]): number {
  if (xValues.length !== yValues.length || xValues.length < 2) return 0;

  const xMean = mean(xValues);
  const yMean = mean(yValues);
  const xStd = stdDev(xValues, xMean);
  const yStd = stdDev(yValues, yMean);
  if (xStd === 0 || yStd === 0) return 0;

  let covariance = 0;
  for (let i = 0; i < xValues.length; i++) {
    covariance += (xValues[i]! - xMean) * (yValues[i]! - yMean);
  }
  covariance /= xValues.length;

  return covariance / (xStd * yStd);
}

/** Pearson r between paired series; null if degenerate. */
export function pearsonCorrelation(
  xValues: number[],
  yValues: number[]
): number | null {
  if (xValues.length !== yValues.length || xValues.length < 2) return null;
  const xMean = mean(xValues);
  const yMean = mean(yValues);
  const xStd = stdDev(xValues, xMean);
  const yStd = stdDev(yValues, yMean);
  if (xStd === 0 || yStd === 0) return null;
  let covariance = 0;
  for (let i = 0; i < xValues.length; i++) {
    covariance += (xValues[i]! - xMean) * (yValues[i]! - yMean);
  }
  covariance /= xValues.length;
  const r = covariance / (xStd * yStd);
  return Number.isFinite(r) ? round(r, 6) : null;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function labeledRows(rows: StrategyMlFeatureRow[]): StrategyMlFeatureRow[] {
  return rows.filter(
    (row) => row.label.hasLabel && row.label.forwardReturnPct !== null
  );
}

export function trainBaselineMlModel(
  rows: StrategyMlFeatureRow[],
  modelVersion = 'baseline_v1'
): BaselineMlModelArtifact {
  const trainingRows = labeledRows(rows);
  if (trainingRows.length === 0) {
    throw new Error('Cannot train baseline ML model without labeled feature rows');
  }

  const featureNames = Object.keys(trainingRows[0]!.features) as MlFeatureName[];
  const labels = trainingRows.map((row) => row.label.forwardReturnPct!);
  const labelMean = mean(labels);
  const labelStd = stdDev(labels, labelMean);

  const featureStats = Object.fromEntries(
    featureNames.map((featureName) => {
      const values = trainingRows.map((row) => row.features[featureName]);
      const featureMean = mean(values);
      const featureStd = stdDev(values, featureMean);
      const weight = round(correlation(values, labels));

      return [
        featureName,
        {
          mean: round(featureMean),
          stdDev: round(featureStd),
          weight,
        },
      ];
    })
  ) as Record<MlFeatureName, BaselineFeatureStat>;

  return {
    modelType: 'correlation_ranker_v1',
    modelVersion,
    trainedAt: new Date().toISOString(),
    trainingRowCount: trainingRows.length,
    featureStats,
    labelStats: {
      mean: round(labelMean),
      stdDev: round(labelStd),
    },
  };
}

export function scoreFeatureRowWithModel(
  row: StrategyMlFeatureRow,
  model: BaselineMlModelArtifact
): BaselineMlScore {
  const contributions: Partial<Record<MlFeatureName, number>> = {};
  let score = 0;

  for (const [featureName, stat] of Object.entries(model.featureStats) as Array<
    [MlFeatureName, BaselineFeatureStat]
  >) {
    const rawValue = row.features[featureName];
    const zScore = stat.stdDev > 0 ? (rawValue - stat.mean) / stat.stdDev : 0;
    const contribution = zScore * stat.weight;
    contributions[featureName] = round(contribution);
    score += contribution;
  }

  const roundedScore = round(score);
  const predictedReturnPct = round(
    model.labelStats.mean + roundedScore * (model.labelStats.stdDev || 1)
  );

  return {
    score: roundedScore,
    predictedReturnPct,
    conviction: round(sigmoid(roundedScore)),
    contributions,
  };
}

export function rankFeatureRowsWithModel(
  rows: StrategyMlFeatureRow[],
  model: BaselineMlModelArtifact
): Array<{
  row: StrategyMlFeatureRow;
  score: BaselineMlScore;
}> {
  return rows
    .map((row) => ({
      row,
      score: scoreFeatureRowWithModel(row, model),
    }))
    .sort((a, b) => b.score.score - a.score.score);
}
