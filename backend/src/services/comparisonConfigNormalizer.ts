import type { ComparisonConfig } from './strategyComparison.js';
import {
  defaultStrategyParallelism,
  defaultSymbolParallelism,
} from './backtestParallelism.js';
import { buildDefaultPointInTimeUniverseSelection } from './researchUniverseService.js';

/** Apply route-level defaults for a comparison / auto-tune config. */
export function normalizeComparisonConfig(config: ComparisonConfig): ComparisonConfig {
  const hasSymbols = Array.isArray(config.symbols) && config.symbols.length > 0;
  return {
    ...config,
    ...(hasSymbols
      ? {}
      : {
          universeSelection:
            config.universeSelection ??
            buildDefaultPointInTimeUniverseSelection(config.startDate),
        }),
    maxPositionPct: config.maxPositionPct ?? 0.1,
    stopLossEnabled: config.stopLossEnabled ?? true,
    takeProfitEnabled: config.takeProfitEnabled ?? true,
    executionMode: config.executionMode ?? 'next_close',
    slippageBps: config.slippageBps ?? 5,
    commissionBps: config.commissionBps ?? 1,
    rebalanceIntervalDays: config.rebalanceIntervalDays ?? 1,
    barPathModel: config.barPathModel ?? 'ohlc_sequence',
    liquidityImpactSqrtCoef: config.liquidityImpactSqrtCoef ?? 0,
    advVolumeLookbackDays: config.advVolumeLookbackDays ?? 20,
    ...(config.maxAdvParticipationPct !== undefined
      ? { maxAdvParticipationPct: config.maxAdvParticipationPct }
      : {}),
    strategyParallelism: config.strategyParallelism ?? defaultStrategyParallelism(),
    symbolParallelism: config.symbolParallelism ?? defaultSymbolParallelism(),
  };
}
