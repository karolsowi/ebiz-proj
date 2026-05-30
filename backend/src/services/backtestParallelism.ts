import os from 'os';

/** Default concurrent symbol evaluations per rebalance day (CPU-bound + DB). */
export function defaultSymbolParallelism(): number {
  const raw = process.env.BACKTEST_SYMBOL_CONCURRENCY;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.min(32, parsed);
    }
  }
  const cpus = os.cpus().length || 6;
  return Math.min(20, Math.max(8, cpus));
}

export function defaultStrategyParallelism(): number {
  const raw = process.env.BACKTEST_STRATEGY_CONCURRENCY;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.min(5, parsed);
    }
  }
  return 5;
}
