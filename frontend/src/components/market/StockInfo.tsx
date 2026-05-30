import { NormalizedQuote, NormalizedCompanyInfo } from "../../services/marketDataService";

interface StockInfoProps {
  symbol: string;
  quote: NormalizedQuote | null;
  companyInfo: NormalizedCompanyInfo | null;
  loading: boolean;
  error: string | null;
}

export default function StockInfo({ symbol, quote, companyInfo, loading, error }: StockInfoProps) {
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

  const formatVolume = (volume: number) => {
    if (volume >= 1000000000) {
      return `${(volume / 1000000000).toFixed(1)}B`;
    } else if (volume >= 1000000) {
      return `${(volume / 1000000).toFixed(1)}M`;
    } else if (volume >= 1000) {
      return `${(volume / 1000).toFixed(1)}K`;
    }
    return volume.toString();
  };

  const formatMarketCap = (marketCap: number) => {
    if (marketCap >= 1000000000000) {
      return `${(marketCap / 1000000000000).toFixed(2)}T`;
    } else if (marketCap >= 1000000000) {
      return `${(marketCap / 1000000000).toFixed(1)}B`;
    } else if (marketCap >= 1000000) {
      return `${(marketCap / 1000000).toFixed(1)}M`;
    }
    return marketCap.toString();
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="animate-pulse">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="h-8 bg-gray-300 dark:bg-gray-600 rounded w-24 mb-2"></div>
              <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-48"></div>
            </div>
            <div className="text-right">
              <div className="h-8 bg-gray-300 dark:bg-gray-600 rounded w-32 mb-2"></div>
              <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24"></div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-16 mb-2"></div>
                <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-20"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error Loading Stock Data</h3>
              <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                <p>{error}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      {/* Header with Price */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{symbol}</h2>
          {companyInfo && (
            <p className="text-gray-600 dark:text-gray-400 mt-1">{companyInfo.name}</p>
          )}
        </div>
        
        {quote && (
          <div className="text-right mt-4 sm:mt-0">
            <div className="text-3xl font-bold text-gray-900 dark:text-white">
              {formatPrice(quote.price)}
            </div>
            <div className={`text-lg font-medium ${
              quote.changePercent >= 0 
                ? 'text-green-600 dark:text-green-400' 
                : 'text-red-600 dark:text-red-400'
            }`}>
              {formatPrice(quote.change)} ({formatPercentage(quote.changePercent)})
            </div>
          </div>
        )}
      </div>

      {/* Key Metrics */}
      {quote && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="text-sm text-gray-600 dark:text-gray-400">Open</div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {formatPrice(quote.open)}
            </div>
          </div>
          
          <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="text-sm text-gray-600 dark:text-gray-400">High</div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {formatPrice(quote.high)}
            </div>
          </div>
          
          <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="text-sm text-gray-600 dark:text-gray-400">Low</div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {formatPrice(quote.low)}
            </div>
          </div>
          
          <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="text-sm text-gray-600 dark:text-gray-400">Volume</div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {quote.volume ? formatVolume(quote.volume) : 'N/A'}
            </div>
          </div>
        </div>
      )}

      {/* Company Information */}
      {companyInfo && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Company Information</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400">Sector</div>
              <div className="font-medium text-gray-900 dark:text-white">
                {companyInfo.sector || 'N/A'}
              </div>
            </div>
            
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400">Industry</div>
              <div className="font-medium text-gray-900 dark:text-white">
                {companyInfo.industry || 'N/A'}
              </div>
            </div>
            
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400">Market Cap</div>
              <div className="font-medium text-gray-900 dark:text-white">
                {companyInfo.marketCap ? formatMarketCap(companyInfo.marketCap) : 'N/A'}
              </div>
            </div>
          </div>

          {companyInfo.description && (
            <div>
              <h4 className="text-md font-medium text-gray-900 dark:text-white mb-2">Description</h4>
              <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
                {companyInfo.description}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Data Source */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-6">
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <div>
            Data Source: {quote?.source || companyInfo?.source || 'API'}
          </div>
          {quote?.lastUpdated && (
            <div>
              Last Updated: {quote.lastUpdated}
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 