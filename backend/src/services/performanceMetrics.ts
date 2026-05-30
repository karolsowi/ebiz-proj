import { priceService } from './databaseService.js';
import type { BacktestResult, BacktestConfig, EquityPoint } from './strategyBacktester.js';

export interface PerformanceReport {
  // Return
  totalReturnPct: number;
  annualizedReturnPct: number;

  // Risk-adjusted
  sharpeRatio: number;
  sortinoRatio: number;

  // Drawdown
  maxDrawdownPct: number;

  // Win/loss
  winRatePct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;

  // Benchmark
  benchmarkSymbol: 'SPY' | null;
  benchmarkReturnPct: number | null;
  alpha: number | null;               // annualized strategy return − benchmark return

  // Parameters used (for research traceability)
  riskFreeRateAnnualized: number;
  tradingDaysInPeriod: number;
}

// Annual risk-free rate assumption (US T-Bill rate approx)
const RISK_FREE_RATE_ANNUAL = 0.05;

class PerformanceMetricsService {
  private getDailyReturns(equityCurve: EquityPoint[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1]!.equity;
      const curr = equityCurve[i]!.equity;
      if (prev > 0) {
        returns.push((curr - prev) / prev);
      }
    }
    return returns;
  }

  private mean(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private stdDev(arr: number[], mu?: number): number {
    if (arr.length < 2) return 0;
    const m = mu ?? this.mean(arr);
    const variance = arr.reduce((acc, v) => acc + Math.pow(v - m, 2), 0) / arr.length;
    return Math.sqrt(variance);
  }

  /**
   * Annualized Sharpe Ratio.
   *
   * Formula:
   *   dailyRfr = RISK_FREE_RATE_ANNUAL / 252
   *   excessReturns = dailyReturns − dailyRfr (per element)
   *   sharpe = mean(excessReturns) / stdDev(excessReturns) × √252
   *
   * Interpretation:
   *   > 1.0 : good (more return per unit of risk than the market average)
   *   > 2.0 : excellent
   *   < 0   : strategy returns less than risk-free rate
   */
  private computeSharpe(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0;

    const dailyRfr = RISK_FREE_RATE_ANNUAL / 252;
    const excess   = dailyReturns.map(r => r - dailyRfr);
    const mu       = this.mean(excess);
    const sigma    = this.stdDev(excess, mu);

    if (sigma < 1e-9) return 0;
    return parseFloat((mu / sigma * Math.sqrt(252)).toFixed(4));
  }

  /**
   * Annualized Sortino Ratio.
   *
   * Like Sharpe but only penalizes DOWNSIDE volatility — it doesn't punish
   * a strategy for having high upside variance.
   *
   * Formula:
   *   dailyRfr = RISK_FREE_RATE_ANNUAL / 252
   *   downsideReturns = dailyReturns where r < dailyRfr
   *   downsideDeviation = √( mean( (r − dailyRfr)² for r in downsideReturns ) )
   *   sortino = (mean(dailyReturns) − dailyRfr) / downsideDeviation × √252
   *
   * Interpretation:
   *   Higher than Sharpe → upside volatility was significant (good)
   *   Lower than Sharpe  → losses were more volatile than gains (bad)
   */
  private computeSortino(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0;

    const dailyRfr    = RISK_FREE_RATE_ANNUAL / 252;
    const mu          = this.mean(dailyReturns);
    const downside    = dailyReturns.filter(r => r < dailyRfr);

    if (downside.length === 0) return mu > 0 ? 99 : 0; // No losing days

    const downsideVariance = downside.reduce(
      (acc, r) => acc + Math.pow(r - dailyRfr, 2), 0
    ) / downside.length;
    const downsideDev = Math.sqrt(downsideVariance);

    if (downsideDev < 1e-9) return 0;
    return parseFloat(((mu - dailyRfr) / downsideDev * Math.sqrt(252)).toFixed(4));
  }

  /**
   * Compound Annual Growth Rate (CAGR).
   *
   * Formula:
   *   tradingDays = number of equity curve points
   *   CAGR = (finalEquity / initialCapital) ^ (252 / tradingDays) − 1
   *
   * Interpretation:
   *   What constant annual return would have produced the same result?
   *   e.g. total return 18.4% over 6 months → CAGR ≈ 40% (annualized)
   */
  private computeAnnualizedReturn(result: BacktestResult, config: BacktestConfig): number {
    const tradingDays = result.equityCurve.length;
    if (tradingDays === 0 || config.initialCapital === 0) return 0;

    const ratio = result.finalEquity / config.initialCapital;
    if (ratio <= 0) return -100;

    const cagr = Math.pow(ratio, 252 / tradingDays) - 1;
    return parseFloat((cagr * 100).toFixed(4)); // return as percentage
  }

  private async getBenchmarkReturn(
    startDate: string,
    endDate: string
  ): Promise<number | null> {
    try {
      const rows = await priceService.getPriceHistory(
        'SPY',
        new Date(startDate),
        new Date(endDate),
        'daily'
      );

      if (rows.length < 2) return null; // Not enough SPY data

      // rows are DESC order — last element is oldest (startDate), first is newest (endDate)
      const startPrice = parseFloat(rows[rows.length - 1]!.close);
      const endPrice   = parseFloat(rows[0]!.close);

      if (startPrice <= 0 || isNaN(startPrice) || isNaN(endPrice)) return null;

      const returnPct = (endPrice - startPrice) / startPrice * 100;
      return parseFloat(returnPct.toFixed(4));
    } catch {
      return null; // SPY data not available — skip benchmark
    }
  }

  async compute(
    result: BacktestResult,
    config: BacktestConfig
  ): Promise<PerformanceReport> {
    const dailyReturns       = this.getDailyReturns(result.equityCurve);
    const sharpeRatio        = this.computeSharpe(dailyReturns);
    const sortinoRatio       = this.computeSortino(dailyReturns);
    const annualizedReturnPct = this.computeAnnualizedReturn(result, config);
    const benchmarkReturnPct = await this.getBenchmarkReturn(config.startDate, config.endDate);

    // Compute benchmark annualized return for alpha
    let alpha: number | null = null;
    if (benchmarkReturnPct !== null) {
      // Approximate: same annualization factor as strategy
      const tradingDays = result.equityCurve.length;
      const benchmarkAnnualized = tradingDays > 0
        ? (Math.pow(1 + benchmarkReturnPct / 100, 252 / tradingDays) - 1) * 100
        : benchmarkReturnPct;
      alpha = parseFloat((annualizedReturnPct - benchmarkAnnualized).toFixed(4));
    }

    // Mutate result so Phase 14 comparison has these values
    result.sharpeRatio         = sharpeRatio;
    result.sortinoRatio        = sortinoRatio;
    result.annualizedReturnPct = annualizedReturnPct;

    return {
      totalReturnPct:      result.totalReturnPct,
      annualizedReturnPct,
      sharpeRatio,
      sortinoRatio,
      maxDrawdownPct:      result.maxDrawdownPct,
      winRatePct:          result.winRatePct,
      totalTrades:         result.totalTrades,
      winningTrades:       result.winningTrades,
      losingTrades:        result.losingTrades,
      benchmarkSymbol:     benchmarkReturnPct !== null ? 'SPY' : null,
      benchmarkReturnPct,
      alpha,
      riskFreeRateAnnualized: RISK_FREE_RATE_ANNUAL,
      tradingDaysInPeriod: result.equityCurve.length,
    };
  }
}

export const performanceMetrics = new PerformanceMetricsService();
