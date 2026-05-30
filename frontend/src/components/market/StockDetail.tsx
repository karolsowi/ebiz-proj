import { useState, useEffect, useCallback } from "react";
import { alphaVantageAPI, StockQuote, CompanyOverview } from "../../services/alphaVantageApi";
import { enhancedDataService } from "../../services/enhancedDataService";
import CacheStatusIndicator from "../CacheStatusIndicator";

interface StockDetailProps {
  symbol: string;
  onClose?: () => void;
}

interface ConvertedTimeSeriesData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type TabType = 'overview' | 'financials' | 'chart';

export default function StockDetail({ symbol, onClose }: StockDetailProps) {
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [overview, setOverview] = useState<CompanyOverview | null>(null);
  const [timeSeries, setTimeSeries] = useState<ConvertedTimeSeriesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [cacheInfo, setCacheInfo] = useState<{isCached: boolean, lastUpdated: string, source: string} | null>(null);

  const loadStockData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Try enhanced service first for quote data
      let quoteData;
      let cacheData = null;
      
      try {
        const enhancedQuote = await enhancedDataService.getQuote(symbol, { preferCache: true });
        if (enhancedQuote.success) {
          // Convert enhanced quote to StockQuote format
          quoteData = {
            symbol: enhancedQuote.data.symbol,
            price: enhancedQuote.data.price,
            change: enhancedQuote.data.change,
            changePercent: `${enhancedQuote.data.changePercent.toFixed(2)}%`,
            volume: enhancedQuote.data.volume || 0,
            latestTradingDay: enhancedQuote.data.lastUpdated,
            previousClose: enhancedQuote.data.previousClose,
            open: enhancedQuote.data.open,
            high: enhancedQuote.data.high,
            low: enhancedQuote.data.low,
          };
          
          cacheData = {
            isCached: !!enhancedQuote.data.cached,
            lastUpdated: enhancedQuote.data.lastUpdated,
            source: enhancedQuote.data.source
          };
          setCacheInfo(cacheData);
        }
      } catch (enhancedError) {
        console.warn('Enhanced service failed, falling back to Alpha Vantage:', enhancedError);
      }

      // Fallback to Alpha Vantage if enhanced service failed
      if (!quoteData) {
        quoteData = await alphaVantageAPI.getQuote(symbol);
        setCacheInfo({ isCached: false, lastUpdated: new Date().toISOString(), source: 'Alpha Vantage' });
      }

      // Load company overview (Alpha Vantage only for now)
      const overviewData = await alphaVantageAPI.getCompanyOverview(symbol);

      setQuote(quoteData);
      setOverview(overviewData);

      // Load time series data with a delay to respect rate limits
      setTimeout(async () => {
        try {
          const timeSeriesData = await alphaVantageAPI.getTimeSeriesDaily(symbol);
          // Convert TimeSeriesData to array format expected by component
          const timeSeriesArray = Object.entries(timeSeriesData.timeSeries)
            .slice(-30)
            .map(([date, values]) => ({
              date,
              open: parseFloat(values.open),
              high: parseFloat(values.high),
              low: parseFloat(values.low),
              close: parseFloat(values.close),
              volume: parseInt(values.volume)
            }));
          setTimeSeries(timeSeriesArray);
        } catch (err) {
          console.error('Failed to load time series:', err);
        }
      }, 12000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stock data');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    loadStockData();
  }, [loadStockData]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(price);
  };

  const formatPercentage = (percentage: number) => {
    return `${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}%`;
  };

  const formatLargeNumber = (num: number) => {
    if (num >= 1e12) {
      return `$${(num / 1e12).toFixed(2)}T`;
    } else if (num >= 1e9) {
      return `$${(num / 1e9).toFixed(2)}B`;
    } else if (num >= 1e6) {
      return `$${(num / 1e6).toFixed(2)}M`;
    } else if (num >= 1e3) {
      return `$${(num / 1e3).toFixed(2)}K`;
    }
    return `$${num.toFixed(2)}`;
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-300 dark:bg-gray-600 rounded w-32 mb-2"></div>
            <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-48"></div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-full"></div>
          <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-3/4"></div>
          <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{symbol}</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{symbol}</h2>
            {cacheInfo && (
              <CacheStatusIndicator
                isCached={cacheInfo.isCached}
                lastUpdated={cacheInfo.lastUpdated}
                source={cacheInfo.source}
                showText={false}
              />
            )}
          </div>
          {overview && (
            <p className="text-gray-600 dark:text-gray-400">{overview.name}</p>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Price Information */}
      {quote && (
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Current Price</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatPrice(quote.price)}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Change</div>
              <div className={`text-lg font-semibold ${
                parseFloat(quote.changePercent.replace('%', '')) >= 0 
                  ? 'text-green-600 dark:text-green-400' 
                  : 'text-red-600 dark:text-red-400'
              }`}>
                {formatPrice(quote.change)} ({formatPercentage(parseFloat(quote.changePercent.replace('%', '')))})
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Volume</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {quote.volume.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Last Updated</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {quote.latestTradingDay}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6">
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="-mb-px flex space-x-8">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'financials', label: 'Financials' },
              { id: 'chart', label: 'Chart' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-green-500 text-green-600 dark:text-green-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && overview && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Company Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-gray-600 dark:text-gray-400">Sector:</span>
                <span className="ml-2 text-gray-900 dark:text-white">{overview.sector}</span>
              </div>
              <div>
                <span className="text-sm text-gray-600 dark:text-gray-400">Industry:</span>
                <span className="ml-2 text-gray-900 dark:text-white">{overview.industry}</span>
              </div>
              <div>
                <span className="text-sm text-gray-600 dark:text-gray-400">Market Cap:</span>
                <span className="ml-2 text-gray-900 dark:text-white">{formatLargeNumber(overview.marketCapitalization)}</span>
              </div>
              <div>
                <span className="text-sm text-gray-600 dark:text-gray-400">Beta:</span>
                <span className="ml-2 text-gray-900 dark:text-white">{overview.beta.toFixed(2)}</span>
              </div>
            </div>
          </div>
          
          {overview.description && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Description</h3>
              <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
                {overview.description}
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'financials' && overview && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Key Metrics</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-sm text-gray-600 dark:text-gray-400">P/E Ratio</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {overview.peRatio > 0 ? overview.peRatio.toFixed(2) : 'N/A'}
                </div>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-sm text-gray-600 dark:text-gray-400">EPS</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {formatPrice(overview.eps)}
                </div>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-sm text-gray-600 dark:text-gray-400">Dividend Yield</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {overview.dividendYield > 0 ? `${(overview.dividendYield * 100).toFixed(2)}%` : 'N/A'}
                </div>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-sm text-gray-600 dark:text-gray-400">Book Value</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {formatPrice(overview.bookValue)}
                </div>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-sm text-gray-600 dark:text-gray-400">ROE</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {overview.returnOnEquityTTM > 0 ? `${(overview.returnOnEquityTTM * 100).toFixed(2)}%` : 'N/A'}
                </div>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-sm text-gray-600 dark:text-gray-400">Profit Margin</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {overview.profitMargin > 0 ? `${(overview.profitMargin * 100).toFixed(2)}%` : 'N/A'}
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">52-Week Range</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-sm text-gray-600 dark:text-gray-400">52-Week Low</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {formatPrice(overview.week52Low)}
                </div>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-sm text-gray-600 dark:text-gray-400">52-Week High</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {formatPrice(overview.week52High)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'chart' && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Price Chart (Last 30 Days)</h3>
          {timeSeries.length > 0 ? (
            <div className="h-64 bg-gray-50 dark:bg-gray-700 rounded-lg p-4 flex items-center justify-center">
              <p className="text-gray-600 dark:text-gray-400">
                Chart visualization would be implemented here using a charting library like Chart.js or Recharts
              </p>
            </div>
          ) : (
            <div className="h-64 bg-gray-50 dark:bg-gray-700 rounded-lg p-4 flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500 mx-auto mb-2"></div>
                <p className="text-gray-600 dark:text-gray-400">Loading chart data...</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
} 