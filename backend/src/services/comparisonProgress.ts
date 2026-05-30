/** Overall 0–100 progress weights for multi-strategy comparison runs. */
export const PROGRESS_WEIGHTS = {
  universeStart: 1,
  universeEnd: 9,
  strategiesStart: 9,
  strategiesEnd: 88,
  benchmarkStart: 88,
  benchmarkEnd: 96,
} as const;

export function universeOverallPct(stepIndex: number, stepTotal: number): number {
  const span = PROGRESS_WEIGHTS.universeEnd - PROGRESS_WEIGHTS.universeStart;
  return PROGRESS_WEIGHTS.universeStart + span * (stepIndex / Math.max(1, stepTotal));
}

/** @param innerFraction 0–1 progress within the current strategy slot */
export function strategyOverallPct(
  strategyIndex: number,
  strategyTotal: number,
  innerFraction: number
): number {
  const span = PROGRESS_WEIGHTS.strategiesEnd - PROGRESS_WEIGHTS.strategiesStart;
  const perStrategy = span / Math.max(1, strategyTotal);
  const clamped = Math.min(1, Math.max(0, innerFraction));
  return PROGRESS_WEIGHTS.strategiesStart + perStrategy * (strategyIndex - 1 + clamped);
}

export function benchmarkOverallPct(innerFraction: number): number {
  const span = PROGRESS_WEIGHTS.benchmarkEnd - PROGRESS_WEIGHTS.benchmarkStart;
  return PROGRESS_WEIGHTS.benchmarkStart + span * Math.min(1, Math.max(0, innerFraction));
}

/** Aggregate progress when multiple strategies run concurrently. */
export function parallelStrategyOverallPct(
  strategyTotal: number,
  completedCount: number,
  inFlightInnerByIndex: ReadonlyMap<number, number>
): number {
  const span = PROGRESS_WEIGHTS.strategiesEnd - PROGRESS_WEIGHTS.strategiesStart;
  const perStrategy = span / Math.max(1, strategyTotal);
  let accumulated = completedCount * perStrategy;
  for (const inner of inFlightInnerByIndex.values()) {
    accumulated += perStrategy * Math.min(1, Math.max(0, inner)) * 0.92;
  }
  return PROGRESS_WEIGHTS.strategiesStart + accumulated;
}
