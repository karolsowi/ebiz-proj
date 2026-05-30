import { useEffect, useState } from 'react';
import { technicalApi, TechnicalIndicators } from '../../services/technicalApi';
import { AlertCircle, TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react';

interface TechnicalSummaryProps {
  symbol: string;
  className?: string;
}

export function TechnicalSummary({ symbol, className = '' }: TechnicalSummaryProps) {
  const [data, setData] = useState<TechnicalIndicators | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      if (!symbol) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const result = await technicalApi.getAnalysis(symbol);
        if (mounted) {
          setData(result);
        }
      } catch (err: unknown) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to analyze technicals');
          setData(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      mounted = false;
    };
  }, [symbol]);

  if (loading) {
    return (
      <div className={`bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 ${className}`}>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500 dark:text-gray-400">Calculating Indicators...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 ${className}`}>
        <div className="flex items-center mb-2">
          <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mr-2" />
          <h3 className="font-medium text-red-800 dark:text-red-200">Technical Analysis Unavailable</h3>
        </div>
        <p className="text-sm text-red-700 dark:text-red-300 ml-7">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  // Render signal icon
  const getSignalIcon = (signal: string) => {
    if (signal === 'buy') return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (signal === 'sell') return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-slate-400" />;
  };

  const getSignalColor = (signal: string) => {
    if (signal === 'buy') return 'text-green-500';
    if (signal === 'sell') return 'text-red-500';
    return 'text-slate-400';
  };

  const formatValue = (val: number) => {
    if (val > 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return val.toFixed(2);
  };

  // Score mapping layout (Score from -1 to +1)
  const scorePercent = ((data.overallScore + 1) / 2) * 100;

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 ${className}`}>
      <div className="pb-4 border-b border-gray-100 dark:border-gray-700 mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex justify-between items-center">
          <span>Technical Analysis</span>
          <span className={`text-base font-bold ${getSignalColor(data.overallSignal.toLowerCase().replace('strong ', ''))}`}>
            {data.overallSignal}
          </span>
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Algorithmic indicator summary for {symbol}</p>
      </div>
      
      <div>
        {/* Needle Gauge representation */}
        <div className="mb-8 mt-2 px-2">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>Strong Sell</span>
            <span>Neutral</span>
            <span>Strong Buy</span>
          </div>
          <div className="relative h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
             <div className="h-full w-1/5 bg-red-600/80"></div>
             <div className="h-full w-1/5 bg-red-400/80"></div>
             <div className="h-full w-1/5 bg-slate-400/80"></div>
             <div className="h-full w-1/5 bg-green-400/80"></div>
             <div className="h-full w-1/5 bg-green-600/80"></div>
          </div>
          {/* Indicator Marker */}
          <div className="relative w-full h-4 mt-1">
            <div 
              className="absolute top-0 -ml-2"
              style={{ left: `${scorePercent}%`, transition: 'left 1s ease-in-out' }}
            >
              <div className="w-0 h-0 border-l-[8px] border-l-transparent border-t-[10px] border-r-[8px] border-r-transparent border-t-gray-800 dark:border-t-white"></div>
            </div>
          </div>
        </div>

        {/* Multi-timeframe consensus */}
        {data.multiTimeframe?.breakdown?.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3 tracking-wide uppercase text-xs">Multi-timeframe consensus</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {data.multiTimeframe.breakdown.map((tf) => (
                <div key={tf.timeframe} className="rounded border border-gray-200 dark:border-gray-700 px-3 py-2">
                  <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">{tf.timeframe}</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">{tf.signal}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Score: {tf.score.toFixed(2)}</div>
                </div>
              ))}
              <div className="rounded border border-blue-200 dark:border-blue-800 px-3 py-2 bg-blue-50 dark:bg-blue-900/20">
                <div className="text-xs text-blue-600 dark:text-blue-300 uppercase">Aggregated</div>
                <div className="text-sm font-semibold text-blue-800 dark:text-blue-200 mt-1">{data.multiTimeframe.aggregatedSignal}</div>
                <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Score: {data.multiTimeframe.aggregatedScore.toFixed(2)} | Confidence: {(data.multiTimeframe.confidence * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Indicators Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-y-6 gap-x-6 text-sm">
          
          {/* RSI */}
          <div className="flex flex-col border-b border-gray-100 dark:border-gray-700 pb-2">
            <span className="text-gray-500 dark:text-gray-400 text-xs">{data.rsi14.label}</span>
            <div className="flex items-center justify-between mt-1 text-gray-900 dark:text-gray-100">
              <span className="font-mono">{formatValue(data.rsi14.value)}</span>
              <span className="flex items-center gap-1 uppercase text-[10px] font-bold">
                {getSignalIcon(data.rsi14.signal)}
                <span className={getSignalColor(data.rsi14.signal)}>{data.rsi14.signal}</span>
              </span>
            </div>
          </div>

          {/* MACD */}
          <div className="flex flex-col border-b border-gray-100 dark:border-gray-700 pb-2">
            <span className="text-gray-500 dark:text-gray-400 text-xs">{data.macd.label}</span>
            <div className="flex items-center justify-between mt-1 text-gray-900 dark:text-gray-100">
              <span className="font-mono">{formatValue(data.macd.value)}</span>
              <span className="flex items-center gap-1 uppercase text-[10px] font-bold">
                {getSignalIcon(data.macd.tradeSignal)}
                <span className={getSignalColor(data.macd.tradeSignal)}>{data.macd.tradeSignal}</span>
              </span>
            </div>
          </div>

          {/* Bollinger Bands */}
          <div className="flex flex-col border-b border-gray-100 dark:border-gray-700 pb-2">
            <span className="text-gray-500 dark:text-gray-400 text-xs">{data.bollingerBands.label}</span>
            <div className="flex items-center justify-between mt-1 text-gray-900 dark:text-gray-100">
              <span className="font-mono">{formatValue(data.bollingerBands.percentB * 100)}%</span>
              <span className="flex items-center gap-1 uppercase text-[10px] font-bold">
                {getSignalIcon(data.bollingerBands.tradeSignal)}
                <span className={getSignalColor(data.bollingerBands.tradeSignal)}>{data.bollingerBands.tradeSignal}</span>
              </span>
            </div>
          </div>

          {/* MAs (Trend) */}
          <div className="flex flex-col border-b border-gray-100 dark:border-gray-700 pb-2">
            <span className="text-gray-500 dark:text-gray-400 text-xs">{data.ema9.label} / {data.ema21.label}</span>
            <div className="flex items-center justify-between mt-1 text-gray-900 dark:text-gray-100">
              <span className="font-mono text-xs">{formatValue(data.ema9.value)} / {formatValue(data.ema21.value)}</span>
              <span className="flex items-center gap-1 uppercase text-[10px] font-bold">
                {getSignalIcon(data.ema21.signal)}
                <span className={getSignalColor(data.ema21.signal)}>{data.ema21.signal}</span>
              </span>
            </div>
          </div>

          <div className="flex flex-col border-b border-gray-100 dark:border-gray-700 pb-2">
            <span className="text-gray-500 dark:text-gray-400 text-xs">{data.sma20.label} / {data.sma50.label}</span>
            <div className="flex items-center justify-between mt-1 text-gray-900 dark:text-gray-100">
              <span className="font-mono text-xs">{formatValue(data.sma20.value)} / {formatValue(data.sma50.value)}</span>
              <span className="flex items-center gap-1 uppercase text-[10px] font-bold">
                {getSignalIcon(data.sma50.signal)}
                <span className={getSignalColor(data.sma50.signal)}>{data.sma50.signal}</span>
              </span>
            </div>
          </div>

          {/* ATR */}
          <div className="flex flex-col border-b border-gray-100 dark:border-gray-700 pb-2">
            <span className="text-gray-500 dark:text-gray-400 text-xs">ATR (14) - Volatility</span>
            <div className="flex items-center justify-between mt-1 text-gray-900 dark:text-gray-100">
              <span className="font-mono">{formatValue(data.atr14)}</span>
              <span className="uppercase text-[10px] text-slate-400">Neutral</span>
            </div>
          </div>

          {/* OBV */}
          <div className="flex flex-col border-b border-gray-100 dark:border-gray-700 pb-2">
            <span className="text-gray-500 dark:text-gray-400 text-xs">{data.obv?.label || 'OBV'}</span>
            <div className="flex items-center justify-between mt-1 text-gray-900 dark:text-gray-100">
              <span className="font-mono text-xs" title={data.obv?.value?.toString() || '0'}>
                {data.obv ? (data.obv.value > 1000000 ? (data.obv.value/1000000).toFixed(1) + 'M' : formatValue(data.obv.value)) : 'N/A'}
              </span>
              <span className="flex items-center gap-1 uppercase text-[10px] font-bold">
                {getSignalIcon(data.obv?.signal || 'neutral')}
                <span className={getSignalColor(data.obv?.signal || 'neutral')}>{data.obv?.signal || 'NEUTRAL'}</span>
              </span>
            </div>
          </div>

          {/* VWAP */}
          <div className="flex flex-col border-b border-gray-100 dark:border-gray-700 pb-2">
            <span className="text-gray-500 dark:text-gray-400 text-xs">{data.vwap?.label || 'VWAP'}</span>
            <div className="flex items-center justify-between mt-1 text-gray-900 dark:text-gray-100">
              <span className="font-mono">{data.vwap?.value ? formatValue(data.vwap.value) : 'N/A'}</span>
              <span className="flex items-center gap-1 uppercase text-[10px] font-bold">
                {getSignalIcon(data.vwap?.signal || 'neutral')}
                <span className={getSignalColor(data.vwap?.signal || 'neutral')}>{data.vwap?.signal || 'NEUTRAL'}</span>
              </span>
            </div>
          </div>

        </div>

        {/* Support & Resistance */}
        {data.supportResistanceLevels && data.supportResistanceLevels.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3 tracking-wide uppercase text-xs">Key Levels</h3>
            <div className="flex flex-wrap gap-2">
              {data.supportResistanceLevels.map((level, i) => (
                <div key={i} className={`px-2.5 py-1 rounded text-xs font-semibold ${level.type === 'resistance' ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                  {level.type === 'resistance' ? 'RES: ' : 'SUP: '} ${formatValue(level.price)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fibonacci */}
        {data.fibonacci && (
          <div className="mt-6">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3 tracking-wide uppercase text-xs">Fibonacci levels</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div className="px-2.5 py-1 rounded text-xs bg-gray-50 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300">0%: ${formatValue(data.fibonacci.level0)}</div>
              <div className="px-2.5 py-1 rounded text-xs bg-gray-50 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300">23.6%: ${formatValue(data.fibonacci.level236)}</div>
              <div className="px-2.5 py-1 rounded text-xs bg-gray-50 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300">38.2%: ${formatValue(data.fibonacci.level382)}</div>
              <div className="px-2.5 py-1 rounded text-xs bg-gray-50 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300">50%: ${formatValue(data.fibonacci.level500)}</div>
              <div className="px-2.5 py-1 rounded text-xs bg-gray-50 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300">61.8%: ${formatValue(data.fibonacci.level618)}</div>
              <div className="px-2.5 py-1 rounded text-xs bg-gray-50 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300">100%: ${formatValue(data.fibonacci.level1000)}</div>
            </div>
          </div>
        )}

        {/* Patterns */}
        {data.detectedPatterns && data.detectedPatterns.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3 tracking-wide uppercase text-xs">Detected Patterns</h3>
            <div className="flex flex-col gap-2">
              {data.detectedPatterns.map((pattern, i) => (
                <div key={i} className={`flex items-center justify-between p-2.5 rounded border ${pattern.type === 'bullish' ? 'border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-900/10' : pattern.type === 'bearish' ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10' : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800'}`}>
                  <div className="flex items-center">
                    {pattern.type === 'bullish' ? <TrendingUp className="h-4 w-4 text-green-500 mr-2" /> : pattern.type === 'bearish' ? <TrendingDown className="h-4 w-4 text-red-500 mr-2" /> : <Minus className="h-4 w-4 text-gray-500 mr-2" />}
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{pattern.name}</span>
                  </div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{new Date(pattern.date).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
