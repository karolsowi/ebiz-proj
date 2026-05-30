import type { ComparisonConfig } from './strategyComparison.js';
import {
  buildDefaultPointInTimeUniverseSelection,
  type ResearchUniverseDiagnostics,
} from './researchUniverseService.js';

const EXPLICIT_SYMBOLS_MAX = 15;

export interface StoredComparisonSnapshot {
  config: ComparisonConfig;
  universeDiagnostics: ResearchUniverseDiagnostics | null;
}

export function stripComparisonConfigForStorage(
  config: ComparisonConfig
): ComparisonConfig {
  const { onProgress: _onProgress, ...rest } = config;
  return rest;
}

export function buildComparisonSnapshot(
  config: ComparisonConfig,
  universeDiagnostics: ResearchUniverseDiagnostics | null
): StoredComparisonSnapshot {
  return {
    config: stripComparisonConfigForStorage(config),
    universeDiagnostics,
  };
}

type RunRow = {
  symbols: unknown;
  startDate: string;
  endDate: string;
  initialCapital: string | null;
  convictionThreshold: string | null;
  maxPositionPct: string | null;
  stopLossEnabled: boolean;
  takeProfitEnabled: boolean;
  comparisonConfig: unknown;
};

export function restoreComparisonSnapshotFromRun(run: RunRow): StoredComparisonSnapshot {
  const stored = run.comparisonConfig as StoredComparisonSnapshot | null | undefined;
  if (stored?.config?.startDate && stored?.config?.endDate) {
    return {
      config: stored.config,
      universeDiagnostics: stored.universeDiagnostics ?? null,
    };
  }

  const symbols = Array.isArray(run.symbols)
    ? (run.symbols as string[]).map((s) => String(s).toUpperCase())
    : [];
  const usedUniverse = symbols.length > EXPLICIT_SYMBOLS_MAX;

  const config: ComparisonConfig = {
    startDate: run.startDate,
    endDate: run.endDate,
    initialCapital: run.initialCapital ? parseFloat(run.initialCapital) : 100_000,
    convictionThreshold: run.convictionThreshold ? parseFloat(run.convictionThreshold) : 0.55,
    maxPositionPct: run.maxPositionPct ? parseFloat(run.maxPositionPct) : 0.1,
    stopLossEnabled: run.stopLossEnabled,
    takeProfitEnabled: run.takeProfitEnabled,
    executionMode: 'next_close',
    slippageBps: 5,
    commissionBps: 1,
    rebalanceIntervalDays: 1,
    barPathModel: 'ohlc_sequence',
    liquidityImpactSqrtCoef: 0,
    advVolumeLookbackDays: 20,
    ...(usedUniverse
      ? { universeSelection: buildDefaultPointInTimeUniverseSelection(run.startDate) }
      : { symbols }),
  };

  const universeSelection = config.universeSelection;
  return {
    config,
    universeDiagnostics: usedUniverse
      ? {
          methodology: universeSelection?.methodology ?? 'point_in_time_index',
          indexCode: universeSelection?.indexCode ?? 'SP500',
          asOfDate: run.startDate,
          priceFilter: universeSelection?.priceFilter ?? 'min_history',
          minHistoryTradingDays: universeSelection?.minHistoryTradingDays ?? 60,
          totalConstituents: symbols.length,
          resolvedSymbols: symbols.length,
          excludedForPriceData: 0,
          coverageStatus: 'point_in_time' as const,
          notes: ['Reconstructed from stored run (legacy — full config was not saved).'],
          excludedSymbolsSample: [],
        }
      : null,
  };
}
