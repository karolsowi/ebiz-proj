import { priceService } from './databaseService.js';

export interface OHLCV {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorSignal {
  value: number;
  signal: 'buy' | 'sell' | 'neutral';
  strength?: number; // 0 to 1
  label: string;
}

export interface DetectedPattern {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  date: string;
  significance: 'high' | 'medium' | 'low';
}

export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: 'strong' | 'weak';
}

export interface TechnicalIndicators {
  sma20: IndicatorSignal;
  sma50: IndicatorSignal;
  sma200: IndicatorSignal;
  ema9: IndicatorSignal;
  ema21: IndicatorSignal;
  rsi14: IndicatorSignal;
  macd: {
    value: number;
    signal: number;
    histogram: number;
    tradeSignal: 'buy' | 'sell' | 'neutral';
    label: string;
  };
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
    tradeSignal: 'buy' | 'sell' | 'neutral';
    label: string;
  };
  atr14: number; // Volatility measure, no direct buy/sell signal
  
  obv: IndicatorSignal;
  vwap: IndicatorSignal;
  supportResistanceLevels: SupportResistanceLevel[];
  detectedPatterns: DetectedPattern[];
  fibonacci: {
    level0: number;
    level236: number;
    level382: number;
    level500: number;
    level618: number;
    level1000: number;
  };
  
  // Aggregate
  overallScore: number; // -1 (Strong Sell) to 1 (Strong Buy)
  overallSignal: 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell';
  multiTimeframe: {
    aggregatedScore: number;
    aggregatedSignal: 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell';
    confidence: number;
    breakdown: Array<{
      timeframe: string;
      score: number;
      signal: 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell';
    }>;
  };
}

export class TechnicalAnalysisService {
  private insufficientHistoryWarnings = new Set<string>();

  private buildInsufficientHistoryKey(symbol: string, timeframe: string): string {
    return `${symbol.toUpperCase()}:${timeframe}`;
  }

  private warnInsufficientHistory(symbol: string, timeframe: string, availableDays: number): void {
    const key = this.buildInsufficientHistoryKey(symbol, timeframe);
    if (this.insufficientHistoryWarnings.has(key)) return;

    this.insufficientHistoryWarnings.add(key);
    console.warn(
      `Not enough data for ${symbol.toUpperCase()} TA analysis (${timeframe}). ` +
      `Need at least 50 days, got ${availableDays}. Further repeats suppressed until history catches up.`
    );
  }

  private clearInsufficientHistoryWarning(symbol: string, timeframe: string): void {
    this.insufficientHistoryWarnings.delete(this.buildInsufficientHistoryKey(symbol, timeframe));
  }
  
  /**
   * Main entry point to get technical analysis for a stock symbol
   */
  async analyzeSymbol(
    symbol: string,
    timeframe: string = 'daily',
    asOfDate?: Date
  ): Promise<TechnicalIndicators | null> {
    const baseIndicators = await this.analyzeSingleTimeframe(symbol, timeframe, asOfDate);
    if (!baseIndicators) return null;

    const breakdown = await this.getTimeframeBreakdown(
      symbol.toUpperCase(),
      ['daily', 'weekly', 'monthly'],
      asOfDate
    );
    const multiTimeframe = this.calculateMultiTimeframeAggregation(breakdown);

    baseIndicators.multiTimeframe = multiTimeframe;
    return baseIndicators;
  }

  private async analyzeSingleTimeframe(
    symbol: string,
    timeframe: string = 'daily',
    asOfDate?: Date
  ): Promise<TechnicalIndicators | null> {
    // We need at least 200 days of data for the SMA200
    // Fetch 250 records (approx 1 year of trading days)
    const rawData = await priceService.getPriceHistory(
      symbol.toUpperCase(),
      undefined,
      asOfDate,
      timeframe
    );
    
    // Sort ascending (chronological: oldest to newest) for proper EMA/RSI calculations
    const data: OHLCV[] = rawData
      .map(r => ({
        date: new Date(r.date),
        open: parseFloat(r.open),
        high: parseFloat(r.high),
        low: parseFloat(r.low),
        close: parseFloat(r.close),
        volume: r.volume || 0
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (data.length < 50) {
      this.warnInsufficientHistory(symbol, timeframe, data.length);
      return null;
    }

    this.clearInsufficientHistoryWarning(symbol, timeframe);

    const prices = data.map(d => d.close);
    const highs = data.map(d => d.high);
    const lows = data.map(d => d.low);
    const volumes = data.map(d => d.volume);
    const currentPrice = prices[prices.length - 1]!;

    // 1. Moving Averages
    const sma20 = this.calculateSMA(prices, 20);
    const sma50 = this.calculateSMA(prices, 50);
    const sma200 = data.length >= 200 ? this.calculateSMA(prices, 200) : null;
    
    const ema9 = this.calculateEMA(prices, 9);
    const ema21 = this.calculateEMA(prices, 21);
    
    // 2. Momentum (RSI & MACD)
    const rsi14 = this.calculateRSI(prices, 14);
    const macd = this.calculateMACD(prices);
    
    // 3. Volatility
    const bb = this.calculateBollingerBands(prices, 20, 2);
    const atr14 = this.calculateATR(highs, lows, prices, 14);

    // 4. Volume
    const obvArray = this.calculateOBV(prices, volumes);
    const vwapArray = this.calculateRollingVWAP(highs, lows, prices, volumes, 14);

    // 5. Patterns & Levels
    const detectedPatterns = this.detectCandlestickPatterns(data);
    const supportResistanceLevels = this.calculateSupportResistanceLevels(highs, lows, 20);
    const fibonacci = this.calculateFibonacciRetracements(highs, lows, 90);

    // Build signals
    const indicators: TechnicalIndicators = {
      sma20: this.getMovingAverageSignal(currentPrice, sma20, 'SMA (20)'),
      sma50: this.getMovingAverageSignal(currentPrice, sma50, 'SMA (50)'),
      sma200: sma200 ? this.getMovingAverageSignal(currentPrice, sma200, 'SMA (200)') : { value: 0, signal: 'neutral', label: 'SMA (200)' },
      ema9: this.getMovingAverageSignal(currentPrice, ema9, 'EMA (9)'),
      ema21: this.getMovingAverageSignal(currentPrice, ema21, 'EMA (21)'),
      
      rsi14: this.getRsiSignal(rsi14),
      macd: this.getMacdSignal(macd),
      bollingerBands: this.getBollingerSignal(currentPrice, bb),
      atr14: atr14[atr14.length - 1] || 0,
      
      obv: this.getOBVSignal(obvArray),
      vwap: this.getMovingAverageSignal(currentPrice, vwapArray, 'VWAP (14)'),
      supportResistanceLevels,
      detectedPatterns,
      fibonacci,

      overallScore: 0,
      overallSignal: 'Neutral',
      multiTimeframe: {
        aggregatedScore: 0,
        aggregatedSignal: 'Neutral',
        confidence: 0,
        breakdown: [],
      }
    };

    // Calculate aggregate score
    const score = this.calculateOverallScore(indicators);
    indicators.overallScore = score;
    
    if (score >= 0.5) indicators.overallSignal = 'Strong Buy';
    else if (score >= 0.15) indicators.overallSignal = 'Buy';
    else if (score <= -0.5) indicators.overallSignal = 'Strong Sell';
    else if (score <= -0.15) indicators.overallSignal = 'Sell';
    else indicators.overallSignal = 'Neutral';

    indicators.multiTimeframe = {
      aggregatedScore: indicators.overallScore,
      aggregatedSignal: indicators.overallSignal,
      confidence: Math.min(Math.abs(indicators.overallScore), 1),
      breakdown: [{ timeframe, score: indicators.overallScore, signal: indicators.overallSignal }],
    };

    return indicators;
  }

  /**
   * Returns array overlays for charting
   */
  async getChartIndicators(symbol: string, timeframe: string = 'daily'): Promise<any> {
    const rawData = await priceService.getPriceHistory(symbol.toUpperCase(), undefined, undefined, timeframe);
    const data: OHLCV[] = rawData
      .map(r => ({
        date: new Date(r.date),
        open: parseFloat(r.open),
        high: parseFloat(r.high),
        low: parseFloat(r.low),
        close: parseFloat(r.close),
        volume: r.volume || 0
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (data.length === 0) return null;

    const prices = data.map(d => d.close);
    const highs = data.map(d => d.high);
    const lows = data.map(d => d.low);
    const volumes = data.map(d => d.volume);

    const sma20 = this.calculateSMA(prices, 20);
    const sma50 = this.calculateSMA(prices, 50);
    const ema20 = this.calculateEMA(prices, 20);
    const bb = this.calculateBollingerBands(prices, 20, 2);
    const vwap = this.calculateRollingVWAP(highs, lows, prices, volumes, 14);

    const supportResistanceLevels = this.calculateSupportResistanceLevels(highs, lows, 20);
    const detectedPatterns = this.detectCandlestickPatterns(data);

    return {
      sma20,
      sma50,
      ema20,
      obv: this.calculateOBV(prices, volumes),
      bbUpper: bb.upper,
      bbLower: bb.lower,
      vwap,
      supportResistanceLevels,
      detectedPatterns
    };
  }

  /**
   * Derive concrete entry, stop-loss, and take-profit prices from
   * already-computed TechnicalIndicators. Reads support/resistance levels
   * and ATR — no additional DB calls required.
   *
   * Entry:      Nearest support level below currentPrice.
   *             Fallback: currentPrice (enter at market).
   *
   * Stop-loss:  entry − 2 × ATR14.
   *             Floored at entry × 0.90 (caps stop at 10% loss max).
   *             If ATR14 is 0 (insufficient data), uses 1% of price.
   *
   * Take-profit: Nearest resistance level above entry.
   *              Fallback: entry + 4 × ATR14 (gives a 2:1 risk/reward ratio).
   *              Ceiled at entry × 1.01 minimum (at least 1% upside required).
   */
  getEntryStopTarget(
    indicators: TechnicalIndicators,
    currentPrice: number
  ): { entry: number; stopLoss: number; takeProfit: number } {
    const levels = indicators.supportResistanceLevels;
    const atr = indicators.atr14 > 0 ? indicators.atr14 : currentPrice * 0.01;

    // Entry: nearest support below current price (descending sort → nearest first)
    const supports = levels
      .filter(l => l.type === 'support' && l.price < currentPrice)
      .sort((a, b) => b.price - a.price);
    const entry = supports.length > 0 ? supports[0]!.price : currentPrice;

    // Stop-loss: 2×ATR below entry, floored at 90% of entry
    const rawStop = entry - 2 * atr;
    const stopLoss = Math.max(rawStop, entry * 0.90);

    // Take-profit: nearest resistance above entry (ascending sort → nearest first)
    const resistances = levels
      .filter(l => l.type === 'resistance' && l.price > entry)
      .sort((a, b) => a.price - b.price);
    const rawTarget = resistances.length > 0
      ? resistances[0]!.price
      : entry + 4 * atr;
    const takeProfit = Math.max(rawTarget, entry * 1.01);

    return { entry, stopLoss, takeProfit };
  }

  // --- MATHEMATICAL INDICATORS ---

  private calculateSMA(prices: number[], period: number): number[] {
    const sma: number[] = [];
    for (let i = 0; i < prices.length; i++) {
      if (i < period - 1) {
        sma.push(NaN); // Not enough data
      } else {
        const sum = prices.slice(i - period + 1, i + 1).reduce((acc, val) => acc + val, 0);
        sma.push(sum / period);
      }
    }
    return sma;
  }

  private calculateEMA(prices: number[], period: number): number[] {
    const ema: number[] = [];
    const multiplier = 2 / (period + 1);
    
    for (let i = 0; i < prices.length; i++) {
      if (i === 0) {
        ema.push(prices[0]!); // Start with the first price
      } else {
        const currentEma = (prices[i]! - ema[i - 1]!) * multiplier + ema[i - 1]!;
        ema.push(currentEma);
      }
    }
    return ema;
  }

  private calculateRSI(prices: number[], period: number = 14): number[] {
    const rsi: number[] = [];
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 0; i < prices.length; i++) {
      if (i === 0) {
        rsi.push(NaN);
        continue;
      }

      const change = prices[i]! - prices[i - 1]!;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      if (i < period) {
        avgGain += gain;
        avgLoss += loss;
        rsi.push(NaN);
        
        if (i === period - 1) {
          avgGain /= period;
          avgLoss /= period;
          const rs = avgGain / (avgLoss === 0 ? 0.0001 : avgLoss);
          rsi[i] = 100 - (100 / (1 + rs));
        }
      } else {
        // Wilder's smoothing
        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;
        
        const rs = avgGain / (avgLoss === 0 ? 0.0001 : avgLoss);
        rsi.push(100 - (100 / (1 + rs)));
      }
    }
    return rsi;
  }

  private calculateMACD(prices: number[], shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
    const emaShort = this.calculateEMA(prices, shortPeriod);
    const emaLong = this.calculateEMA(prices, longPeriod);
    
    const macdLine = emaShort.map((short, i) => short - emaLong[i]!);
    
    // Calculate Signal line (EMA of MACD line)
    // We filter out NaNs first
    const validMacdLine = macdLine.filter(val => !isNaN(val));
    const signalLineRaw = this.calculateEMA(validMacdLine, signalPeriod);
    
    // Pad signal line to match original array length
    const signalLine = new Array(prices.length - signalLineRaw.length).fill(NaN).concat(signalLineRaw);
    
    const histogram = macdLine.map((macd, i) => macd - (signalLine[i] || 0));
    
    return {
      macdLine,
      signalLine,
      histogram
    };
  }

  private calculateBollingerBands(prices: number[], period = 20, multiplier = 2) {
    const sma = this.calculateSMA(prices, period);
    const upper: number[] = [];
    const lower: number[] = [];

    for (let i = 0; i < prices.length; i++) {
      if (i < period - 1) {
        upper.push(NaN);
        lower.push(NaN);
      } else {
        const slice = prices.slice(i - period + 1, i + 1);
        const mean = sma[i]!;
        const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
        const stdDev = Math.sqrt(variance);
        
        upper.push(mean + (multiplier * stdDev));
        lower.push(mean - (multiplier * stdDev));
      }
    }
    
    return { sma, upper, lower };
  }

  private calculateATR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
    const tr: number[] = [];
    const atr: number[] = [];
    
    for (let i = 0; i < highs.length; i++) {
      if (i === 0) {
        tr.push(highs[0]! - lows[0]!);
        atr.push(NaN);
      } else {
        const currentHigh = highs[i]!;
        const currentLow = lows[i]!;
        const prevClose = closes[i - 1]!;
        
        const trueRange = Math.max(
          currentHigh - currentLow,
          Math.abs(currentHigh - prevClose),
          Math.abs(currentLow - prevClose)
        );
        tr.push(trueRange);
      }
      
      if (i === period - 1) {
        const initialAtr = tr.slice(0, period).reduce((a, b) => a + b) / period;
        atr.push(initialAtr);
      } else if (i >= period) {
        // Wilder's Smoothing
        const currentAtr = ((atr[i - 1]! * (period - 1)) + tr[i]!) / period;
        atr.push(currentAtr);
      }
    }
    
    return atr;
  }

  private calculateOBV(prices: number[], volumes: number[]): number[] {
    const obv: number[] = [0];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i]! > prices[i-1]!) {
        obv.push(obv[i-1]! + volumes[i]!);
      } else if (prices[i]! < prices[i-1]!) {
        obv.push(obv[i-1]! - volumes[i]!);
      } else {
        obv.push(obv[i-1]!);
      }
    }
    return obv;
  }

  private calculateRollingVWAP(highs: number[], lows: number[], closes: number[], volumes: number[], period: number = 14): number[] {
    const vwap: number[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < period - 1) {
        vwap.push(NaN);
      } else {
        let cumulativeTPV = 0;
        let cumulativeVolume = 0;
        for (let j = i - period + 1; j <= i; j++) {
          const typicalPrice = (highs[j]! + lows[j]! + closes[j]!) / 3;
          cumulativeTPV += typicalPrice * volumes[j]!;
          cumulativeVolume += volumes[j]!;
        }
        vwap.push(cumulativeVolume === 0 ? closes[i]! : cumulativeTPV / cumulativeVolume);
      }
    }
    return vwap;
  }

  private detectCandlestickPatterns(data: OHLCV[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    if (data.length < 3) return patterns;
    
    // Check the last 3 days
    for (let i = data.length - 3; i < data.length; i++) {
      const prev = data[i - 1];
      const curr = data[i];
      if (!prev || !curr) continue;
      
      const body = Math.abs(curr.close - curr.open);
      const range = curr.high - curr.low;
      const isBullish = curr.close > curr.open;
      const isBearish = curr.close < curr.open;
      
      const upperWick = isBullish ? curr.high - curr.close : curr.high - curr.open;
      const lowerWick = isBullish ? curr.open - curr.low : curr.close - curr.low;
      
      if (body <= range * 0.1 && range > 0) {
        patterns.push({ name: 'Doji', type: 'neutral', date: curr.date.toISOString(), significance: 'medium' });
      }
      
      if (body <= range * 0.3 && lowerWick >= body * 2 && upperWick <= body * 0.5) {
        patterns.push({ name: 'Hammer', type: 'bullish', date: curr.date.toISOString(), significance: 'high' });
      }
      
      const prevIsBullish = prev.close > prev.open;
      const prevIsBearish = prev.close < prev.open;
      
      if (isBullish && prevIsBearish && curr.close > prev.open && curr.open < prev.close) {
        patterns.push({ name: 'Bullish Engulfing', type: 'bullish', date: curr.date.toISOString(), significance: 'high' });
      } else if (isBearish && prevIsBullish && curr.close < prev.open && curr.open > prev.close) {
        patterns.push({ name: 'Bearish Engulfing', type: 'bearish', date: curr.date.toISOString(), significance: 'high' });
      }
    }
    
    const unique = [];
    const seen = new Set();
    for (const p of patterns) {
      const key = `${p.name}-${p.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(p);
      }
    }
    return unique;
  }

  private calculateSupportResistanceLevels(highs: number[], lows: number[], lookback = 60): SupportResistanceLevel[] {
    const len = highs.length;
    if (len < 10) return [];
    const windowStart = Math.max(2, len - lookback);

    const pivotHighs: number[] = [];
    const pivotLows: number[] = [];

    for (let i = windowStart; i < len - 2; i++) {
      const h = highs[i]!;
      const l = lows[i]!;
      if (h > highs[i - 1]! && h > highs[i - 2]! && h >= highs[i + 1]! && h >= highs[i + 2]!) {
        pivotHighs.push(h);
      }
      if (l < lows[i - 1]! && l < lows[i - 2]! && l <= lows[i + 1]! && l <= lows[i + 2]!) {
        pivotLows.push(l);
      }
    }

    const clusterLevels = (prices: number[], type: 'support' | 'resistance'): SupportResistanceLevel[] => {
      if (prices.length === 0) return [];
      const sorted = [...prices].sort((a, b) => a - b);
      const clusters: Array<{ center: number; count: number }> = [];
      const tolerance = sorted[sorted.length - 1]! * 0.005;

      for (const p of sorted) {
        const existing = clusters.find(c => Math.abs(c.center - p) <= tolerance);
        if (existing) {
          existing.center = (existing.center * existing.count + p) / (existing.count + 1);
          existing.count += 1;
        } else {
          clusters.push({ center: p, count: 1 });
        }
      }

      return clusters
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map(c => ({
          price: c.center,
          type,
          strength: c.count >= 2 ? 'strong' : 'weak',
        }));
    };

    return [...clusterLevels(pivotLows, 'support'), ...clusterLevels(pivotHighs, 'resistance')]
      .sort((a, b) => a.price - b.price);
  }

  private calculateFibonacciRetracements(highs: number[], lows: number[], lookback = 90) {
    const windowStart = Math.max(0, highs.length - lookback);
    let maxHigh = -Infinity;
    let minLow = Infinity;
    let maxHighIndex = 0;
    let minLowIndex = 0;
    
    for (let i = windowStart; i < highs.length; i++) {
      if (highs[i]! > maxHigh) { maxHigh = highs[i]!; maxHighIndex = i; }
      if (lows[i]! < minLow) { minLow = lows[i]!; minLowIndex = i; }
    }
    
    const isUptrend = minLowIndex < maxHighIndex;
    const diff = maxHigh - minLow;
    
    if (isUptrend) {
      return {
        level1000: minLow,
        level618: maxHigh - diff * 0.618,
        level500: maxHigh - diff * 0.5,
        level382: maxHigh - diff * 0.382,
        level236: maxHigh - diff * 0.236,
        level0: maxHigh
      };
    } else {
      return {
        level1000: maxHigh,
        level618: minLow + diff * 0.618,
        level500: minLow + diff * 0.5,
        level382: minLow + diff * 0.382,
        level236: minLow + diff * 0.236,
        level0: minLow
      };
    }
  }

  // --- SIGNAL GENERATORS ---

  private getMovingAverageSignal(currentPrice: number, maArray: number[], label: string): IndicatorSignal {
    const ma = maArray[maArray.length - 1]!;
    if (isNaN(ma)) return { value: 0, signal: 'neutral', label };
    
    // Simple logic: if price is > 1.5% above MA = buy. If below = sell.
    const diffPercent = (currentPrice - ma) / ma;
    
    let signal: 'buy' | 'sell' | 'neutral' = 'neutral';
    if (diffPercent > 0.015) signal = 'buy';
    else if (diffPercent < -0.015) signal = 'sell';
    
    return {
      value: ma,
      signal,
      strength: Math.min(Math.abs(diffPercent) * 10, 1), // Cap at 1
      label
    };
  }

  private getRsiSignal(rsiArray: number[]): IndicatorSignal {
    const rsi = rsiArray[rsiArray.length - 1]!;
    if (isNaN(rsi)) return { value: 50, signal: 'neutral', label: 'RSI (14)' };
    
    let signal: 'buy' | 'sell' | 'neutral' = 'neutral';
    let strength = 0;
    
    if (rsi < 30) {
      signal = 'buy'; // Oversold -> Potential Buy
      strength = (30 - rsi) / 30;
    } else if (rsi > 70) {
      signal = 'sell'; // Overbought -> Potential Sell
      strength = (rsi - 70) / 30;
    }
    
    return { value: rsi, signal, strength, label: 'RSI (14)' };
  }

  private getMacdSignal(macdResult: any) {
    const macdValue = macdResult.macdLine[macdResult.macdLine.length - 1]!;
    const signalLine = macdResult.signalLine[macdResult.signalLine.length - 1]!;
    const histogram = macdResult.histogram[macdResult.histogram.length - 1]!;
    const prevHistogram = macdResult.histogram[macdResult.histogram.length - 2]!;
    
    if (isNaN(macdValue) || isNaN(signalLine)) {
      return { value: 0, signal: 0, histogram: 0, tradeSignal: 'neutral' as const, label: 'MACD (12,26)' };
    }
    
    let tradeSignal: 'buy' | 'sell' | 'neutral' = 'neutral';
    
    // Crossover logic for MACD
    if (histogram > 0 && prevHistogram <= 0) {
      tradeSignal = 'buy'; // Bullish crossover
    } else if (histogram < 0 && prevHistogram >= 0) {
      tradeSignal = 'sell'; // Bearish crossover
    } else if (histogram > 0 && histogram > prevHistogram) {
      tradeSignal = 'buy'; // Growing bullish momentum
    } else if (histogram < 0 && histogram < prevHistogram) {
      tradeSignal = 'sell'; // Growing bearish momentum
    }
    
    return {
      value: macdValue,
      signal: signalLine,
      histogram: histogram,
      tradeSignal,
      label: 'MACD (12,26,9)'
    };
  }

  private getBollingerSignal(currentPrice: number, bb: any) {
    const upper = bb.upper[bb.upper.length - 1]!;
    const lower = bb.lower[bb.lower.length - 1]!;
    const middle = bb.sma[bb.sma.length - 1]!;
    
    if (isNaN(upper) || isNaN(lower)) {
      return { upper: 0, middle: 0, lower: 0, percentB: 0.5, tradeSignal: 'neutral' as const, label: 'Bollinger Bands' };
    }
    
    const percentB = (currentPrice - lower) / (upper - lower);
    let tradeSignal: 'buy' | 'sell' | 'neutral' = 'neutral';
    
    // Mean reversion logic
    if (percentB > 0.95) tradeSignal = 'sell'; // Price hits/exceeds upper band
    else if (percentB < 0.05) tradeSignal = 'buy'; // Price hits/drops below lower band
    
    return {
      upper, middle, lower, percentB, tradeSignal, label: 'Bollinger Bands (20,2)'
    };
  }

  private getOBVSignal(obvArray: number[]): IndicatorSignal {
    const obv = obvArray[obvArray.length - 1]!;
    const prevObv = obvArray[obvArray.length - 2] || obv;
    
    let signal: 'buy' | 'sell' | 'neutral' = 'neutral';
    if (obv > prevObv) signal = 'buy';
    else if (obv < prevObv) signal = 'sell';
    
    return {
      value: obv,
      signal,
      strength: 0.5,
      label: 'OBV'
    };
  }

  // --- OVERALL SCORING ALGORITHM ---
  
  private calculateOverallScore(ind: TechnicalIndicators): number {
    let score = 0;
    
    // Function to convert signal strings to numerical scores (-1 to 1)
    const sigScore = (signal: string, strength: number = 0.5) => {
      if (signal === 'buy') return strength;
      if (signal === 'sell') return -strength;
      return 0;
    };
    
    /* 
      Weighting map (Total should roughly balance out around 1.0 peak):
      - Moving Averages (Trend): 35% weight 
      - RSI (Momentum): 25% weight
      - MACD (Trend/Momentum): 25% weight
      - Bollinger (Mean Reversion): 15% weight
    */
    
    // Trend (Moving Averages)
    score += sigScore(ind.sma20.signal, ind.sma20.strength) * 0.10;
    score += sigScore(ind.sma50.signal, ind.sma50.strength) * 0.10;
    score += sigScore(ind.ema9.signal, ind.ema9.strength) * 0.05;
    score += sigScore(ind.ema21.signal, ind.ema21.strength) * 0.10;
    
    // Momentum (RSI) - high strength oversold acts as strong buy
    score += sigScore(ind.rsi14.signal, ind.rsi14.strength) * 0.25;
    
    // MACD
    // A fresh crossover is a strong signal, so we default to 0.8 strength
    score += sigScore(ind.macd.tradeSignal, 0.8) * 0.25;
    
    // Volatility/Mean Reversion
    // Hitting a bollinger band is a strong counter-trend signal
    score += sigScore(ind.bollingerBands.tradeSignal, Math.abs(0.5 - ind.bollingerBands.percentB) * 2) * 0.15;
    
    // Volume Validation
    score += sigScore(ind.obv.signal, 0.4) * 0.10;
    
    // Pattern Validation bonus
    const recentPatterns = ind.detectedPatterns.filter(p => p.type !== 'neutral');
    if (recentPatterns.length > 0) {
       for (const p of recentPatterns) {
          if (p.type === 'bullish') score += 0.1;
          if (p.type === 'bearish') score -= 0.1;
       }
    }
    
    // Cap strictly between -1.0 and 1.0
    return Math.max(Math.min(score, 1), -1);
  }

  private scoreToSignal(score: number): 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell' {
    if (score >= 0.5) return 'Strong Buy';
    if (score >= 0.15) return 'Buy';
    if (score <= -0.5) return 'Strong Sell';
    if (score <= -0.15) return 'Sell';
    return 'Neutral';
  }

  private async getTimeframeBreakdown(
    symbol: string,
    timeframes: string[],
    asOfDate?: Date
  ) {
    const results = await Promise.all(
      timeframes.map(async (tf) => {
        const analysis = await this.analyzeSingleTimeframe(symbol, tf, asOfDate);
        if (!analysis) return null;
        return { timeframe: tf, score: analysis.overallScore, signal: analysis.overallSignal };
      })
    );

    return results.filter((r): r is { timeframe: string; score: number; signal: 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell' } => r !== null);
  }

  private calculateMultiTimeframeAggregation(
    breakdown: Array<{ timeframe: string; score: number; signal: 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell' }>
  ) {
    const weights: Record<string, number> = { daily: 0.5, weekly: 0.3, monthly: 0.2 };
    let weightedScore = 0;
    let totalWeight = 0;
    for (const point of breakdown) {
      const w = weights[point.timeframe] ?? 0.2;
      weightedScore += point.score * w;
      totalWeight += w;
    }

    const aggregatedScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
    const confidence =
      breakdown.length > 0
        ? Math.min(
            1,
            breakdown.reduce((acc, b) => acc + Math.abs(b.score), 0) / breakdown.length
          )
        : 0;

    return {
      aggregatedScore,
      aggregatedSignal: this.scoreToSignal(aggregatedScore),
      confidence,
      breakdown,
    };
  }
}

export const technicalAnalysisService = new TechnicalAnalysisService();
