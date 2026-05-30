import PageMeta from '../../components/common/PageMeta';
import PortfolioSnapshot from '../../components/dashboard/PortfolioSnapshot';
import RecentTrades from '../../components/dashboard/RecentTrades';
import MarketHighlights from '../../components/dashboard/MarketHighlights';
import SentimentSummary from '../../components/dashboard/SentimentSummary';

export default function EnhancedHome() {
  return (
    <>
      <PageMeta
        title="Investment Dashboard | InWest - Personal Investment Platform"
        description="Get a comprehensive overview of your portfolio, recent trades, market trends, and sentiment analysis on your personal investment dashboard"
      />

      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Your investment overview at a glance
          </p>
        </div>

        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* Portfolio Snapshot */}
          <div className="lg:col-span-5 h-full">
            <PortfolioSnapshot />
          </div>

          {/* Recent Trades */}
          <div className="lg:col-span-7 h-full">
            <RecentTrades />
          </div>

          {/* Market Highlights */}
          <div className="lg:col-span-7 h-full">
            <MarketHighlights />
          </div>

          {/* Sentiment Summary */}
          <div className="lg:col-span-5 h-full">
            <SentimentSummary />
          </div>

        </div>

        {/* Quick Action Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <a
            href="/trading"
            className="group p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
          >
            <div className="flex items-center">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center group-hover:bg-blue-200 dark:group-hover:bg-blue-900/40 transition-colors">
                <span className="text-blue-600 dark:text-blue-400 text-lg">📈</span>
              </div>
              <div className="ml-3">
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  Trade Now
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  Execute trades
                </div>
              </div>
            </div>
          </a>

          <a
            href="/trading"
            className="group p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-green-300 dark:hover:border-green-600 transition-colors"
          >
            <div className="flex items-center">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/20 rounded-lg flex items-center justify-center group-hover:bg-green-200 dark:group-hover:bg-green-900/40 transition-colors">
                <span className="text-green-600 dark:text-green-400 text-lg">📊</span>
              </div>
              <div className="ml-3">
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  Portfolio
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  Positions &amp; account
                </div>
              </div>
            </div>
          </a>

          <a
            href="/market/overview"
            className="group p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-600 transition-colors"
          >
            <div className="flex items-center">
              <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center group-hover:bg-purple-200 dark:group-hover:bg-purple-900/40 transition-colors">
                <span className="text-purple-600 dark:text-purple-400 text-lg">🌍</span>
              </div>
              <div className="ml-3">
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  Markets
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  Global overview
                </div>
              </div>
            </div>
          </a>

          <a
            href="/market/reddit"
            className="group p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-orange-300 dark:hover:border-orange-600 transition-colors"
          >
            <div className="flex items-center">
              <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/20 rounded-lg flex items-center justify-center group-hover:bg-orange-200 dark:group-hover:bg-orange-900/40 transition-colors">
                <span className="text-orange-600 dark:text-orange-400 text-lg">🔥</span>
              </div>
              <div className="ml-3">
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  Sentiment
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  Reddit insights
                </div>
              </div>
            </div>
          </a>
        </div>

        {/* Footer Info */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Real-time Data & Paper Trading
              </h3>
              <div className="mt-2 text-sm text-blue-700 dark:text-blue-300">
                <p>
                  Dashboard data refreshes automatically. Currently in paper trading mode with virtual funds.
                  All trading functionality is simulated for learning and testing purposes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}