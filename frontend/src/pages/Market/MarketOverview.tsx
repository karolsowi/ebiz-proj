import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { marketDataService, NormalizedQuote } from "../../services/marketDataService";
import { apiClient } from "../../services/apiClient";
import { apiUrl } from "../../utils/apiUrl";
import PageMeta from "../../components/common/PageMeta";
import APIStatus from "../../components/market/APIStatus";
import StockLink from "../../components/common/StockLink";

interface WatchlistEntry {
  id: number;
  symbol: string;
  name?: string | null;
}

interface MarketData {
  topGainers: Array<{symbol: string, price: string, changeAmount: string, changePercentage: string, volume: string}>;
  topLosers: Array<{symbol: string, price: string, changeAmount: string, changePercentage: string, volume: string}>;
  mostActivelyTraded: Array<{symbol: string, price: string, changeAmount: string, changePercentage: string, volume: string}>;
}

interface WatchlistStock {
  symbol: string;
  quote?: NormalizedQuote;
  loading: boolean;
  error?: string;
}

export default function MarketOverview() {
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [watchlistStocks, setWatchlistStocks] = useState<WatchlistStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMarketData();
    loadWatchlistData();
  }, []);

  const loadMarketData = async () => {
    try {
      const data = await marketDataService.getMarketMovers();
      setMarketData(data);
    } catch (err) {
      console.error('Market data loading error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load market data');
      // Set empty data to prevent undefined errors
      setMarketData({
        topGainers: [],
        topLosers: [],
        mostActivelyTraded: []
      });
    } finally {
      setLoading(false);
    }
  };

  const loadWatchlistData = async () => {
    try {
      const entries = await apiClient.get<WatchlistEntry[]>(apiUrl('/api/watchlist'));
      if (entries.length === 0) {
        setWatchlistStocks([]);
        return;
      }

      const symbols = entries.map((e) => e.symbol);
      setWatchlistStocks(symbols.map((symbol) => ({ symbol, loading: true })));

      const quotes = await marketDataService.getMultipleQuotes(symbols);
      const quoteBySymbol = new Map(
        quotes.map((q) => [
          q.symbol,
          {
            symbol: q.symbol,
            price: q.price,
            currentPrice: q.price,
            change: q.change,
            changePercent: q.changePercent,
            volume: q.volume,
            previousClose: q.price - q.change,
            open: q.price,
            high: q.price,
            low: q.price,
            lastUpdated: q.timestamp,
            timestamp: Date.now(),
            source: 'API',
          } satisfies NormalizedQuote,
        ])
      );

      setWatchlistStocks(
        symbols.map((symbol) => {
          const quote = quoteBySymbol.get(symbol);
          if (quote) {
            return { symbol, quote, loading: false };
          }
          return { symbol, loading: false, error: 'Quote unavailable' };
        })
      );
    } catch (err) {
      console.error('Watchlist load error:', err);
      setWatchlistStocks([]);
    }
  };

  const formatPrice = (price: string | number) => {
    const numPrice = typeof price === 'string' ? parseFloat(price) : price;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numPrice);
  };

  const formatPercentage = (percentage: string | number) => {
    const numPercentage = typeof percentage === 'string' ? parseFloat(percentage.replace('%', '')) : percentage;
    return `${numPercentage >= 0 ? '+' : ''}${numPercentage.toFixed(2)}%`;
  };

  const formatVolume = (volume: string | number) => {
    const numVolume = typeof volume === 'string' ? parseInt(volume) : volume;
    if (numVolume >= 1000000) {
      return `${(numVolume / 1000000).toFixed(1)}M`;
    } else if (numVolume >= 1000) {
      return `${(numVolume / 1000).toFixed(1)}K`;
    }
    return numVolume.toString();
  };

  type MoverRow = {
    symbol: string;
    price: string | number;
    changeAmount?: string;
    changePercentage?: string;
    change?: number;
    changePercent?: number;
    volume?: string | number;
  };

  const MarketSection = ({ title, stocks }: { title: string; stocks: MoverRow[] }) => (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{title}</h3>
      <div className="space-y-3">
        {(stocks || []).length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p>No data available</p>
            <p className="text-xs mt-1">Check API keys under Account → API keys (Alpha Vantage or Finnhub).</p>
          </div>
        ) : (
          (stocks || []).slice(0, 5).map((stock, index) => (
            <div key={stock.symbol || index} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="flex items-center space-x-3">
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400 w-6">#{index + 1}</span>
              <div>
                <StockLink symbol={stock.symbol || 'N/A'} className="font-medium text-gray-900 dark:text-white" />
                <div className="text-sm text-gray-500 dark:text-gray-400">Vol: {formatVolume(stock.volume || 0)}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-medium text-gray-900 dark:text-white">{formatPrice(stock.price || 0)}</div>
              <div className={`text-sm ${
                parseFloat((stock.changePercentage || '0%').replace('%', '')) >= 0 
                  ? 'text-green-600 dark:text-green-400' 
                  : 'text-red-600 dark:text-red-400'
              }`}>
                {formatPercentage(stock.changePercentage || '0%')}
              </div>
            </div>
          </div>
          ))
        )}
      </div>
    </div>
  );

  if (loading && !marketData) {
    return (
      <>
        <PageMeta
          title="Market Overview | InWest - Personal Investment Platform"
          description="Real-time market data, top gainers, losers, and most active stocks"
        />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
        </div>
      </>
    );
  }

  if (error && !marketData) {
    return (
      <>
        <PageMeta
          title="Market Overview | InWest - Personal Investment Platform"
          description="Real-time market data, top gainers, losers, and most active stocks"
        />
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error Loading Market Data</h3>
              <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                <p>{error}</p>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta
        title="Market Overview | InWest - Personal Investment Platform"
        description="Real-time market data, top gainers, losers, and most active stocks"
      />
      
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Market Overview</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Real-time market data powered by Alpha Vantage
          </p>
        </div>

        {/* Watchlist Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Your Watchlist</h2>
            <Link to="/market/watchlist" className="text-sm text-brand-500 hover:underline">
              Manage watchlist
            </Link>
          </div>
          {watchlistStocks.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm py-4">
              No symbols on your watchlist yet.{" "}
              <Link to="/market/watchlist" className="text-brand-500 hover:underline">
                Add symbols
              </Link>{" "}
              to see live quotes here.
            </p>
          ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {watchlistStocks.map((stock) => (
              <div key={stock.symbol} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                {stock.loading ? (
                  <div className="animate-pulse">
                    <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-16 mb-2"></div>
                    <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-24 mb-1"></div>
                    <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-20"></div>
                  </div>
                ) : stock.error ? (
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">{stock.symbol}</div>
                    <div className="text-sm text-red-600 dark:text-red-400">{stock.error}</div>
                  </div>
                ) : stock.quote ? (
                  <div>
                    <StockLink symbol={stock.quote.symbol} className="font-medium text-gray-900 dark:text-white" />
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">
                      {formatPrice(stock.quote.price)}
                    </div>
                    <div className={`text-sm ${
                      stock.quote.changePercent >= 0 
                        ? 'text-green-600 dark:text-green-400' 
                        : 'text-red-600 dark:text-red-400'
                    }`}>
                      {formatPrice(stock.quote.change)} ({formatPercentage(stock.quote.changePercent)})
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Vol: {stock.quote.volume ? formatVolume(stock.quote.volume) : 'N/A'}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          )}
        </div>

        {/* Market Movers */}
        {marketData && (
          <div className="grid gap-6 lg:grid-cols-3">
            <MarketSection 
              title="Top Gainers" 
              stocks={marketData.topGainers} 
            />
            <MarketSection 
              title="Top Losers" 
              stocks={marketData.topLosers} 
            />
            <MarketSection 
              title="Most Active" 
              stocks={marketData.mostActivelyTraded} 
            />
          </div>
        )}

        {/* API Status */}
        <APIStatus />

        {/* API Info */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Dual API Strategy
              </h3>
              <div className="mt-2 text-sm text-blue-700 dark:text-blue-300">
                <p>
                  Market data intelligently sourced from Alpha Vantage (primary) and Finnhub (fallback). 
                  The system automatically switches to Finnhub when Alpha Vantage limits are reached, 
                  ensuring continuous data availability.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
} 