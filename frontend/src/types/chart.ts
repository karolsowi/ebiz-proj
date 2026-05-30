/** Shared ApexCharts helpers for market charts */

export interface ApexChartPoint {
  x: number;
  y: number;
}

export interface ApexCandlePoint {
  x: number;
  y: [number, number, number, number];
}

export interface SupportResistanceLevel {
  price: number;
  type: 'resistance' | 'support';
  strength: string;
}

export interface DetectedPattern {
  date: string;
  type: string;
  name?: string;
}

export interface StockChartIndicators {
  sma20?: number[];
  sma50?: number[];
  ema20?: number[];
  vwap?: number[];
  bbUpper?: number[];
  bbLower?: number[];
  obv?: number[];
  supportResistanceLevels?: SupportResistanceLevel[];
  detectedPatterns?: DetectedPattern[];
}

export interface ApexChartSeries {
  name: string;
  type: string;
  data: ApexChartPoint[] | ApexCandlePoint[];
}

export function isValidChartPoint(val: { x?: number; y: number }): val is ApexChartPoint {
  return val.x !== undefined && !Number.isNaN(val.y);
}

export function mapIndicatorSeries(
  values: number[],
  candlestickData: Array<{ x: number }>
): ApexChartPoint[] {
  return values
    .map((val, i) => ({
      x: candlestickData[i]?.x ?? 0,
      y: val,
    }))
    .filter(isValidChartPoint);
}
