import { priceService } from './databaseService.js';
import type { EquityPoint } from './strategyBacktester.js';

export interface SpyBenchmarkSnapshot {
  symbol: 'SPY';
  label: string;
  equityCurve: EquityPoint[];
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  tradingDaysInPeriod: number;
}

function maxDrawdownFromCurve(curve: EquityPoint[]): number {
  if (curve.length === 0) return 0;
  let peak = curve[0]!.equity;
  let maxDd = 0;
  for (const point of curve) {
    if (point.equity > peak) peak = point.equity;
    if (peak > 0) {
      const dd = ((peak - point.equity) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return parseFloat(maxDd.toFixed(4));
}

/**
 * Buy-and-hold SPY curve aligned to backtest trading dates (same initial capital).
 */
export async function buildSpyBenchmarkSnapshot(
  dates: string[],
  initialCapital: number
): Promise<SpyBenchmarkSnapshot | null> {
  if (dates.length === 0) return null;

  try {
    const minDate = dates[0]!;
    const maxDate = dates[dates.length - 1]!;
    const spyPrices = await priceService.getPriceHistory(
      'SPY',
      new Date(minDate),
      new Date(maxDate),
      'daily'
    );
    const ascPrices = [...spyPrices].reverse();
    if (ascPrices.length < 2) return null;

    const startPrice = parseFloat(ascPrices[0]!.close);
    if (startPrice <= 0 || Number.isNaN(startPrice)) return null;

    const spyMap = new Map<string, number>();
    for (const p of ascPrices) {
      spyMap.set(p.date.toISOString().split('T')[0]!, parseFloat(p.close));
    }

    let lastSpyPrice = startPrice;
    const equityCurve: EquityPoint[] = dates.map((dateStr) => {
      const price = spyMap.get(dateStr);
      if (price !== undefined) lastSpyPrice = price;
      const equity = (lastSpyPrice / startPrice) * initialCapital;
      return { date: dateStr, equity, cash: 0, positionsValue: equity };
    });

    const endEquity = equityCurve[equityCurve.length - 1]!.equity;
    const totalReturnPct = parseFloat(
      (((endEquity - initialCapital) / initialCapital) * 100).toFixed(4)
    );
    const tradingDays = equityCurve.length;
    const annualizedReturnPct =
      tradingDays > 0
        ? parseFloat(
            ((Math.pow(1 + totalReturnPct / 100, 252 / tradingDays) - 1) * 100).toFixed(4)
          )
        : totalReturnPct;

    return {
      symbol: 'SPY',
      label: 'S&P 500 (Buy & Hold)',
      equityCurve,
      totalReturnPct,
      annualizedReturnPct,
      maxDrawdownPct: maxDrawdownFromCurve(equityCurve),
      tradingDaysInPeriod: tradingDays,
    };
  } catch (err) {
    console.error('Failed to build SPY benchmark snapshot', err);
    return null;
  }
}

/** Rebuild snapshot when only stored total return is available (no curve). */
export function spyBenchmarkFromStoredReturn(
  benchmarkReturnPct: number,
  tradingDays: number
): Pick<SpyBenchmarkSnapshot, 'symbol' | 'label' | 'totalReturnPct' | 'annualizedReturnPct' | 'tradingDaysInPeriod'> {
  const annualizedReturnPct =
    tradingDays > 0
      ? parseFloat(
          ((Math.pow(1 + benchmarkReturnPct / 100, 252 / tradingDays) - 1) * 100).toFixed(4)
        )
      : benchmarkReturnPct;
  return {
    symbol: 'SPY',
    label: 'S&P 500 (Buy & Hold)',
    totalReturnPct: benchmarkReturnPct,
    annualizedReturnPct,
    tradingDaysInPeriod: tradingDays,
  };
}
