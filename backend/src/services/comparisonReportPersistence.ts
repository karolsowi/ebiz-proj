import { db } from '../db/connection.js';
import { strategyBacktestRuns, strategyBacktestTrades } from '../db/schema.js';
import { buildComparisonSnapshot } from './backtestRunConfigService.js';
import type { StrategyComparisonReport } from './strategyComparison.js';

export async function persistComparisonReport(
  report: StrategyComparisonReport
): Promise<Record<string, number>> {
  const comparisonSnapshot = buildComparisonSnapshot(
    report.config,
    report.universeDiagnostics
  );
  const runIds: Record<string, number> = {};
  const batchCompletedAt = new Date();

  for (const [strategy, result] of Object.entries(report.results)) {
    const p = result.performance;
    const metadata = result.backtest.strategyMetadata;
    const modelVersion =
      metadata.modelVersions.length === 1
        ? metadata.modelVersions[0] ?? null
        : metadata.modelVersions.length > 1
          ? `walkforward:${metadata.modelVersions.length}`
          : null;

    const [row] = await db
      .insert(strategyBacktestRuns)
      .values({
        symbols: report.config.symbols ?? [],
        strategy,
        startDate: report.config.startDate,
        endDate: report.config.endDate,
        initialCapital: report.config.initialCapital.toFixed(2),
        convictionThreshold: report.config.convictionThreshold.toFixed(3),
        maxPositionPct: report.config.maxPositionPct.toFixed(3),
        stopLossEnabled: report.config.stopLossEnabled,
        takeProfitEnabled: report.config.takeProfitEnabled,
        status: 'completed',
        totalReturnPct: p.totalReturnPct.toFixed(4),
        annualizedReturnPct: p.annualizedReturnPct.toFixed(4),
        sharpeRatio: p.sharpeRatio.toFixed(4),
        sortinoRatio: p.sortinoRatio.toFixed(4),
        maxDrawdownPct: p.maxDrawdownPct.toFixed(4),
        winRatePct: p.winRatePct.toFixed(2),
        totalTrades: p.totalTrades,
        winningTrades: p.winningTrades,
        losingTrades: p.losingTrades,
        benchmarkReturnPct: p.benchmarkReturnPct?.toFixed(4) ?? null,
        alpha: p.alpha?.toFixed(4) ?? null,
        equityCurve: result.equityCurve,
        comparisonWinner: report.winner,
        comparisonWinnerReason: report.winnerReason,
        modelVersion,
        modelMetadata: metadata,
        comparisonConfig: comparisonSnapshot,
        completedAt: batchCompletedAt,
      })
      .returning({ id: strategyBacktestRuns.id });

    const runId = row!.id;
    runIds[strategy] = runId;

    if (result.trades.length > 0) {
      const TRADE_BATCH = 500;
      const tradeRows = result.trades.map((t) => ({
        runId,
        symbol: t.symbol,
        strategy: t.strategy,
        side: t.side,
        date: t.date,
        price: t.price.toFixed(8),
        quantity: t.quantity,
        value: t.value.toFixed(4),
        reason: t.reason,
        conviction: t.conviction.toFixed(4),
        pnl: t.pnl?.toFixed(4) ?? null,
      }));
      for (let i = 0; i < tradeRows.length; i += TRADE_BATCH) {
        await db.insert(strategyBacktestTrades).values(tradeRows.slice(i, i + TRADE_BATCH));
      }
    }
  }

  return runIds;
}
