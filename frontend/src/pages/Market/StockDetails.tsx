import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import PageMeta from "../../components/common/PageMeta";
import StockSearch from "../../components/market/StockSearch";
import StockChart from "../../components/market/StockChart";
import { TechnicalSummary } from "../../components/technical/TechnicalSummary";
import RedditSentimentWidget from "../../components/sentiment/RedditSentimentWidget";
import { marketDataService } from "../../services/marketDataService";
import { technicalApi } from "../../services/technicalApi";
import type { StockChartIndicators } from "../../types/chart";

interface StockProfile {
  symbol: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  marketCap: number;
  employees?: number;
  website?: string;
  logo?: string;
  exchange: string;
  currency: string;
  country: string;
  ipo?: string;
}

interface HistoricalDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}


interface NewsArticle {
  category: string;
  datetime?: number;
  publishedAt?: string;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  lastUpdated: string;
  source: string;
}

export default function StockDetails() {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  
  const [profile, setProfile] = useState<StockProfile | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [historicalData, setHistoricalData] = useState<HistoricalDataPoint[]>([]);
  const [indicators, setIndicators] = useState<StockChartIndicators | null>(null);
  const [news, setNews] = useState<NewsArticle[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [historicalChartError, setHistoricalChartError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Data selection options
  const [timeframe, setTimeframe] = useState<'1M' | '3M' | '6M' | '1Y' | '2Y' | '5Y' | 'CUSTOM'>('1Y');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const loadStockData = useCallback(async () => {
    if (!symbol) return;
    
    setLoading(true);
    setError(null);

    try {
      // Load profile, quote, and news in parallel
      const [profileRes, quoteRes, newsRes] = await Promise.allSettled([
        marketDataService.getCompanyInfo(symbol),
        marketDataService.getQuote(symbol),
        marketDataService.getNews(symbol)
      ]);

      // Handle profile
      if (profileRes.status === 'fulfilled') {
        setProfile(profileRes.value as StockProfile);
      } else {
        console.warn('Failed to load profile:', profileRes);
      }

      // Handle quote
      if (quoteRes.status === 'fulfilled') {
        setQuote(quoteRes.value as Quote);
      } else {
        console.warn('Failed to load quote:', quoteRes);
      }

      // Handle news
      if (newsRes.status === 'fulfilled') {
        setNews(
          Array.isArray(newsRes.value)
            ? (newsRes.value as NewsArticle[])
            : []
        );
      } else {
        console.warn('Failed to load news:', newsRes);
      }

    } catch (err) {
      console.error('Error loading stock data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load stock data');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  const loadHistoricalData = useCallback(async () => {
    if (!symbol) return;

    try {
      setHistoricalLoading(true);
      setHistoricalChartError(null);

      // Calculate date range based on timeframe
      let endDate = new Date();
      let startDate = new Date();
      let dataLimit = 500; // Default limit

      if (timeframe === 'CUSTOM') {
        if (!customStartDate || !customEndDate) {
          setHistoricalData([]);
          setIndicators(null);
          setHistoricalChartError(null);
          setHistoricalLoading(false);
          return;
        }
        startDate = new Date(customStartDate);
        endDate = new Date(customEndDate);
        
        // Calculate days difference to set appropriate limit
        const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        dataLimit = Math.min(Math.max(daysDiff + 20, 100), 5000);
      } else {
        switch (timeframe) {
          case '1M':
            startDate.setMonth(endDate.getMonth() - 1);
            dataLimit = 50;
            break;
          case '3M':
            startDate.setMonth(endDate.getMonth() - 3);
            dataLimit = 100;
            break;
          case '6M':
            startDate.setMonth(endDate.getMonth() - 6);
            dataLimit = 200;
            break;
          case '1Y':
            startDate.setFullYear(endDate.getFullYear() - 1);
            dataLimit = 300;
            break;
          case '2Y':
            startDate.setFullYear(endDate.getFullYear() - 2);
            dataLimit = 500;
            break;
          case '5Y':
            startDate.setFullYear(endDate.getFullYear() - 5);
            dataLimit = 2000;
            break;
        }
      }

      const payload = await technicalApi.getChartForRange(symbol, {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        limit: dataLimit,
        timeframe: 'daily',
      });

      const raw = payload.data as Array<Record<string, unknown>>;
      const processedData: HistoricalDataPoint[] = raw
        .map((record) => {
          const d = record.date;
          let dateStr: string;
          if (typeof d === 'string') {
            dateStr = d.includes('T') ? d : `${d}T12:00:00.000Z`;
          } else if (d instanceof Date) {
            dateStr = d.toISOString();
          } else {
            dateStr = String(d ?? '');
          }
          const open = parseFloat(String(record.open));
          const high = parseFloat(String(record.high));
          const low = parseFloat(String(record.low));
          const close = parseFloat(String(record.close));
          if (!dateStr || [open, high, low, close].some((n) => Number.isNaN(n))) {
            return null;
          }
          return {
            date: dateStr,
            open,
            high,
            low,
            close,
            volume: Number(record.volume ?? 0),
          };
        })
        .filter((row): row is HistoricalDataPoint => row !== null);

      setHistoricalData(processedData);
      setIndicators((payload.indicators as StockChartIndicators | undefined) ?? null);

      if (processedData.length === 0) {
        setHistoricalChartError(
          'No OHLC bars in this date range. The backend loads free EOD data from Stooq on demand — try again in a few seconds, or verify the ticker is a US stock.'
        );
      }
    } catch (err) {
      console.error('Error loading historical data:', err);
      setHistoricalData([]);
      setIndicators(null);
      setHistoricalChartError(
        err instanceof Error ? err.message : 'Failed to load price history. Sign in if your session expired.'
      );
    } finally {
      setHistoricalLoading(false);
    }
  }, [symbol, timeframe, customStartDate, customEndDate]);

  useEffect(() => {
    void loadStockData();
  }, [loadStockData]);

  useEffect(() => {
    void loadHistoricalData();
  }, [loadHistoricalData]);

  const handleTimeframeChange = (newTimeframe: '1M' | '3M' | '6M' | '1Y' | '2Y' | '5Y' | 'CUSTOM') => {
    setTimeframe(newTimeframe);
    if (newTimeframe !== 'CUSTOM') {
      setCustomStartDate('');
      setCustomEndDate('');
    }
  };

  const handleCustomDateChange = () => {
    if (customStartDate && customEndDate) {
      setTimeframe('CUSTOM');
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(price);
  };

  const formatMarketCap = (marketCap: number) => {
    if (marketCap >= 1e12) {
      return `$${(marketCap / 1e12).toFixed(2)}T`;
    } else if (marketCap >= 1e9) {
      return `$${(marketCap / 1e9).toFixed(2)}B`;
    } else if (marketCap >= 1e6) {
      return `$${(marketCap / 1e6).toFixed(2)}M`;
    }
    return `$${marketCap.toLocaleString()}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (!symbol) {
    return (
      <>
        <PageMeta
          title="Stocks Explorer | InWest"
          description="Search and analyze stock details"
        />
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Stocks Explorer</h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              Search and analyze stocks with interactive charts and real-time data
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
            <StockSearch onSymbolSelect={(s) => navigate(`/market/stocks/${s}`)} selectedSymbol="" />
          </div>
        </div>
      </>
    );
  }

  if (loading && !profile && !quote) {
    return (
      <>
        <PageMeta
          title={`${symbol} Stock Details | InWest`}
          description={`Detailed analysis and data for ${symbol} stock`}
        />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
        </div>
      </>
    );
  }

  if (error && !profile && !quote) {
    return (
      <>
        <PageMeta
          title={`${symbol} Stock Details | InWest`}
          description={`Detailed analysis and data for ${symbol} stock`}
        />
        <div className="space-y-8">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <h3 className="text-lg font-medium text-red-800 dark:text-red-200 mb-2">
              Error Loading Stock Data
            </h3>
            <p className="text-red-700 dark:text-red-300">{error}</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta
        title={`${symbol} - ${profile?.name || 'Stock Details'} | InWest`}
        description={`Detailed analysis and data for ${symbol} stock including price history, news, and sentiment`}
      />
      
      <div className="space-y-8">
        {/* Header with Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mt-4"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* Stock Header */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-4">
              {profile?.logo && (
                <img
                  src={profile.logo}
                  alt={`${profile.name} logo`}
                  className="w-16 h-16 rounded-lg object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                  {profile?.name || symbol}
                </h1>
                <p className="text-xl text-gray-600 dark:text-gray-400">{symbol}</p>
                {profile && (
                  <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
                    <span>{profile.exchange}</span>
                    <span>•</span>
                    <span>{profile.sector}</span>
                    <span>•</span>
                    <span>{profile.industry}</span>
                  </div>
                )}
              </div>
            </div>
            
            {quote && (
              <div className="text-right">
                <div className="text-3xl font-bold text-gray-900 dark:text-white">
                  {formatPrice(quote.price)}
                </div>
                <div className={`text-lg flex items-center justify-end ${
                  quote.changePercent >= 0 
                    ? 'text-green-600 dark:text-green-400' 
                    : 'text-red-600 dark:text-red-400'
                }`}>
                  {quote.changePercent >= 0 ? '+' : ''}{formatPrice(quote.change)} 
                  ({quote.changePercent.toFixed(2)}%)
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Last updated: {quote.lastUpdated}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Quick Stats */}
        {(quote || profile) && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {quote && (
              <>
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="text-sm text-gray-500 dark:text-gray-400">Open</div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {formatPrice(quote.open)}
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="text-sm text-gray-500 dark:text-gray-400">High</div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {formatPrice(quote.high)}
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="text-sm text-gray-500 dark:text-gray-400">Low</div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {formatPrice(quote.low)}
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="text-sm text-gray-500 dark:text-gray-400">Volume</div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {quote.volume?.toLocaleString() || 'N/A'}
                  </div>
                </div>
              </>
            )}
            {profile && profile.marketCap > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <div className="text-sm text-gray-500 dark:text-gray-400">Market Cap</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {formatMarketCap(profile.marketCap)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Chart Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 sm:mb-0">
              Technical Analysis Chart
            </h2>
            
            {/* Timeframe Selector */}
            <div className="flex flex-col sm:flex-row gap-2 relative z-10">
              <div className="flex space-x-2">
                {(['1M', '3M', '6M', '1Y', '2Y', '5Y'] as const).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => handleTimeframeChange(tf)}
                    className={`px-3 py-1 text-sm font-medium rounded-lg transition-colors border ${
                      timeframe === tf
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
                <button
                  onClick={() => handleTimeframeChange('CUSTOM')}
                  className={`px-3 py-1 text-sm font-medium rounded-lg transition-colors border ${
                    timeframe === 'CUSTOM'
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  Custom
                </button>
              </div>

              {/* Custom Date Picker */}
              {timeframe === 'CUSTOM' && (
                <div className="flex space-x-2 items-center">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => {
                      setCustomStartDate(e.target.value);
                      setTimeout(handleCustomDateChange, 100);
                    }}
                    className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-green-500 focus:border-green-500"
                    max={customEndDate || new Date().toISOString().split('T')[0]}
                  />
                  <span className="text-sm text-gray-500 dark:text-gray-400">to</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => {
                      setCustomEndDate(e.target.value);
                      setTimeout(handleCustomDateChange, 100);
                    }}
                    className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-green-500 focus:border-green-500"
                    min={customStartDate}
                    max={new Date().toISOString().split('T')[0]}
                  />
                </div>
              )}
            </div>
          </div>

          {historicalChartError && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              {historicalChartError}
            </div>
          )}

          <StockChart
            symbol={symbol}
            data={historicalData}
              indicators={indicators ?? undefined}
            loading={historicalLoading}
            timeframe={timeframe}
          />
        </div>

        {/* Technical Summary Module */}
        <div className="mt-8 relative z-10">
          <TechnicalSummary symbol={symbol} />
        </div>

        {/* News and Sentiment */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* News */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Latest News</h2>
            
            {news.length > 0 ? (
              <div className="space-y-4">
                {news.slice(0, 5).map((article) => (
                  <div key={article.id} className="border-b border-gray-200 dark:border-gray-700 pb-4 last:border-b-0">
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-green-600 dark:hover:text-green-400"
                      >
                        {article.headline}
                      </a>
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      {article.summary}
                    </p>
                    <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                      <span>{article.source}</span>
                      <span className="mx-2">•</span>
                      <span>
                        {new Date(
                          article.publishedAt ??
                            (article.datetime != null ? article.datetime * 1000 : Date.now())
                        ).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                No recent news available
              </div>
            )}
          </div>

          {/* Sentiment */}
          <RedditSentimentWidget symbol={symbol} />
        </div>

        {/* Company Profile */}
        {profile && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Company Profile</h2>
            
            <div className="space-y-4">
              {profile.description && (
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-white mb-2">Description</h3>
                  <p className="text-gray-600 dark:text-gray-400">{profile.description}</p>
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-white mb-2">Company Details</h3>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Exchange:</dt>
                      <dd className="text-gray-900 dark:text-white">{profile.exchange}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Country:</dt>
                      <dd className="text-gray-900 dark:text-white">{profile.country}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Currency:</dt>
                      <dd className="text-gray-900 dark:text-white">{profile.currency}</dd>
                    </div>
                    {profile.ipo && (
                      <div className="flex justify-between">
                        <dt className="text-gray-500 dark:text-gray-400">IPO Date:</dt>
                        <dd className="text-gray-900 dark:text-white">{formatDate(profile.ipo)}</dd>
                      </div>
                    )}
                    {profile.employees && (
                      <div className="flex justify-between">
                        <dt className="text-gray-500 dark:text-gray-400">Employees:</dt>
                        <dd className="text-gray-900 dark:text-white">{profile.employees.toLocaleString()}</dd>
                      </div>
                    )}
                  </dl>
                </div>
                
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-white mb-2">Industry Information</h3>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Sector:</dt>
                      <dd className="text-gray-900 dark:text-white">{profile.sector}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Industry:</dt>
                      <dd className="text-gray-900 dark:text-white">{profile.industry}</dd>
                    </div>
                    {profile.website && (
                      <div className="flex justify-between">
                        <dt className="text-gray-500 dark:text-gray-400">Website:</dt>
                        <dd className="text-gray-900 dark:text-white">
                          <a
                            href={profile.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-600 dark:text-green-400 hover:underline"
                          >
                            Visit
                          </a>
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}