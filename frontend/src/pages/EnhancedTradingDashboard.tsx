import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { tradingService, AccountInfo, TradingStats, Position } from '../services/tradingService';
import PageMeta from '../components/common/PageMeta';
import PaperTradingBanner from '../components/trading/PaperTradingBanner';
import TradeOrderForm from '../components/trading/TradeOrderForm';
import TradeHistory from '../components/trading/TradeHistory';
import { TechnicalSummary } from '../components/technical/TechnicalSummary';
import { useIntegrationStatus } from '../hooks/useIntegrationStatus';
import IntegrationKeysNotice from '../components/integrations/IntegrationKeysNotice';

// Enhanced Account Overview Component
const EnhancedAccountOverview: React.FC = () => {
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAccountInfo = async () => {
    try {
      setLoading(true);
      await tradingService.initializeAccount();
      const info = await tradingService.getAccountInfo();
      setAccountInfo(info);
      setError(null);
    } catch (err) {
      console.error('Error loading account info:', err);
      setError(err instanceof Error ? err.message : 'Failed to load account info');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccountInfo();
  }, []);

  const handleSync = async () => {
    try {
      setLoading(true);
      await tradingService.syncAccount();
      await loadAccountInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync account');
    }
  };

  const formatCurrency = (value: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat(value));
  };

  if (loading) return <div className="animate-pulse bg-gray-200 dark:bg-gray-600 h-32 rounded-lg"></div>;
  if (error) {
    const missingKeys =
      error.includes('API keys not configured') || error.includes('INTEGRATION_KEYS');
    if (missingKeys) {
      return <IntegrationKeysNotice service="alpaca" />;
    }
    return <div className="bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-4 rounded-lg">{error}</div>;
  }
  if (!accountInfo) return <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg">No account data available</div>;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Account Overview</h2>
        <div className="flex items-center space-x-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            accountInfo.isPaperTrading
              ? 'bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200'
              : 'bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200'
          }`}>
            {accountInfo.isPaperTrading ? 'PAPER' : 'LIVE'}
          </span>
          <button
            onClick={handleSync}
            className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500"
          >
            Sync
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
          <h3 className="text-sm font-medium text-blue-600 dark:text-blue-400">Portfolio Value</h3>
          <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
            {formatCurrency(accountInfo.portfolioValue)}
          </p>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
          <h3 className="text-sm font-medium text-green-600 dark:text-green-400">Buying Power</h3>
          <p className="text-2xl font-bold text-green-900 dark:text-green-100">
            {formatCurrency(accountInfo.buyingPower)}
          </p>
        </div>
        <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
          <h3 className="text-sm font-medium text-purple-600 dark:text-purple-400">Cash</h3>
          <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">
            {formatCurrency(accountInfo.balance)}
          </p>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg">
          <h3 className="text-sm font-medium text-orange-600 dark:text-orange-400">Day Trades</h3>
          <p className="text-2xl font-bold text-orange-900 dark:text-orange-100">
            {accountInfo.dayTradeCount}/3
          </p>
        </div>
      </div>
      
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="font-medium text-gray-900 dark:text-gray-100">Status:</span> 
          <span className={`ml-2 px-2 py-1 rounded ${
            accountInfo.status === 'active' 
              ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200' 
              : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200'
          }`}>
            {accountInfo.status.toUpperCase()}
          </span>
        </div>
        <div>
          <span className="font-medium text-gray-900 dark:text-gray-100">Pattern Day Trader:</span> 
          <span className={`ml-2 ${
            accountInfo.patternDayTrader 
              ? 'text-red-600 dark:text-red-400' 
              : 'text-green-600 dark:text-green-400'
          }`}>
            {accountInfo.patternDayTrader ? 'Yes' : 'No'}
          </span>
        </div>
      </div>
    </div>
  );
};

// Enhanced Positions Table Component
const EnhancedPositionsTable: React.FC<{ onRefresh: () => void }> = ({ onRefresh }) => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPositions = async () => {
    try {
      setLoading(true);
      const response = await tradingService.getPositions();
      setPositions(response.positions);
      setError(null);
    } catch (err) {
      console.error('Error loading positions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load positions');
      setPositions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPositions();
  }, []);

  const handleClosePosition = async (symbol: string) => {
    if (!confirm(`Are you sure you want to close your position in ${symbol}?`)) {
      return;
    }

    try {
      await tradingService.closePosition(symbol);
      await loadPositions();
      onRefresh();
    } catch (err) {
      console.error('Failed to close position:', err);
      alert(`Failed to close position: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  if (loading) return <div className="animate-pulse bg-gray-200 dark:bg-gray-600 h-64 rounded-lg"></div>;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Positions ({positions.length})
        </h2>
        <div className="flex items-center space-x-3">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200">
            PAPER TRADING
          </span>
          <button
            onClick={loadPositions}
            className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {positions.length === 0 ? (
        <div className="text-center py-8">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No open positions</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Place some orders to see your positions here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-600">
                <th className="text-left py-2 text-gray-900 dark:text-gray-100">Symbol</th>
                <th className="text-right py-2 text-gray-900 dark:text-gray-100">Qty</th>
                <th className="text-right py-2 text-gray-900 dark:text-gray-100">Avg Price</th>
                <th className="text-right py-2 text-gray-900 dark:text-gray-100">Current Price</th>
                <th className="text-right py-2 text-gray-900 dark:text-gray-100">Market Value</th>
                <th className="text-right py-2 text-gray-900 dark:text-gray-100">P&L</th>
                <th className="text-right py-2 text-gray-900 dark:text-gray-100">P&L %</th>
                <th className="text-center py-2 text-gray-900 dark:text-gray-100">Actions</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.id} className="border-b border-gray-100 dark:border-gray-700">
                  <td className="py-3">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {position.symbol}
                    </span>
                  </td>
                  <td className="py-3 text-right text-gray-900 dark:text-gray-100">
                    {parseInt(position.quantity).toLocaleString()}
                  </td>
                  <td className="py-3 text-right text-gray-900 dark:text-gray-100">
                    {tradingService.formatCurrency(position.avgEntryPrice || '0')}
                  </td>
                  <td className="py-3 text-right text-gray-900 dark:text-gray-100">
                    {tradingService.formatCurrency(position.currentPrice || '0')}
                  </td>
                  <td className="py-3 text-right text-gray-900 dark:text-gray-100">
                    {tradingService.formatCurrency(position.marketValue || '0')}
                  </td>
                  <td className={`py-3 text-right ${tradingService.getPLColorClass(position.unrealizedPL || '0')}`}>
                    {tradingService.formatCurrency(position.unrealizedPL || '0')}
                  </td>
                  <td className={`py-3 text-right ${tradingService.getPLColorClass(position.unrealizedPLPercent || '0')}`}>
                    {tradingService.formatPercent(position.unrealizedPLPercent || '0')}
                  </td>
                  <td className="py-3 text-center">
                    <button
                      onClick={() => handleClosePosition(position.symbol)}
                      className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      Close
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// Trading Statistics Component
const TradingStatistics: React.FC = () => {
  const [stats, setStats] = useState<TradingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadStats = async () => {
      try {
        setLoading(true);
        const tradingStats = await tradingService.getTradingStats();
        setStats(tradingStats);
        setError(null);
      } catch (err) {
        console.error('Error loading trading stats:', err);
        setError(err instanceof Error ? err.message : 'Failed to load trading statistics');
      } finally {
        setLoading(false);
      }
    };

    loadStats();
  }, []);

  if (loading) return <div className="animate-pulse bg-gray-200 dark:bg-gray-600 h-40 rounded-lg"></div>;
  if (error) return <div className="bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-4 rounded-lg">{error}</div>;
  if (!stats) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Trading Statistics</h3>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200">
          PAPER TRADING
        </span>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.totalTrades}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Trades</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.winRate.toFixed(1)}%</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Win Rate</p>
        </div>
        <div className={`text-center`}>
          <p className={`text-2xl font-bold ${tradingService.getPLColorClass(stats.totalPL)}`}>
            {tradingService.formatCurrency(stats.totalPL)}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Total P&L</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{stats.dayTradeCount}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Day Trades</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <div className="text-center p-3 rounded bg-gray-50 dark:bg-gray-700">
          <p className={`text-lg font-semibold ${tradingService.getPLColorClass(stats.realizedPL)}`}>
            {tradingService.formatCurrency(stats.realizedPL)}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400">Realized P&L</p>
        </div>
        <div className="text-center p-3 rounded bg-gray-50 dark:bg-gray-700">
          <p className={`text-lg font-semibold ${tradingService.getPLColorClass(stats.unrealizedPL)}`}>
            {tradingService.formatCurrency(stats.unrealizedPL)}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400">Unrealized P&L</p>
        </div>
      </div>
    </div>
  );
};

// Main Enhanced Trading Dashboard Component
type TradingTab = 'overview' | 'history' | 'stats';

const TAB_KEYS: TradingTab[] = ['overview', 'history', 'stats'];

const EnhancedTradingDashboard: React.FC = () => {
  const { status: integrationStatus, loading: integrationLoading } = useIntegrationStatus();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab: TradingTab = TAB_KEYS.includes(tabParam as TradingTab)
    ? (tabParam as TradingTab)
    : 'overview';

  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<TradingTab>(initialTab);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');

  useEffect(() => {
    if (tabParam === 'positions') {
      setActiveTab('overview');
      setSearchParams({}, { replace: true });
      return;
    }
    if (tabParam && TAB_KEYS.includes(tabParam as TradingTab)) {
      setActiveTab(tabParam as TradingTab);
    }
  }, [tabParam, setSearchParams]);

  const setTab = (tab: TradingTab) => {
    setActiveTab(tab);
    setSearchParams(tab === 'overview' ? {} : { tab }, { replace: true });
  };

  const handleOrderPlaced = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  const tabs = [
    { key: 'overview', label: 'Overview', icon: '📊' },
    { key: 'history', label: 'History', icon: '📝' },
    { key: 'stats', label: 'Statistics', icon: '📉' },
  ];

  return (
    <>
      <PageMeta title="Trading" description="Paper trading: place orders, manage positions, and view trade history" />
      
      <div className="p-6 space-y-6">
        {/* Paper Trading Banner */}
        <PaperTradingBanner />

        {/* Tab Navigation */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setTab(tab.key as TradingTab)}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {!integrationLoading && integrationStatus && !integrationStatus.canUseAlpaca ? (
            <IntegrationKeysNotice service="alpaca" />
          ) : (
            <>
              {activeTab === 'overview' && (
                <>
                  <EnhancedAccountOverview key={`account-${refreshKey}`} />
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <TradeOrderForm onOrderPlaced={handleOrderPlaced} onSymbolChange={setSelectedSymbol} />
                    <div className="space-y-6">
                      <TradingStatistics key={`stats-${refreshKey}`} />
                      {selectedSymbol && selectedSymbol.length > 0 && (
                        <TechnicalSummary symbol={selectedSymbol} />
                      )}
                    </div>
                  </div>
                  <EnhancedPositionsTable key={`positions-${refreshKey}`} onRefresh={handleRefresh} />
                </>
              )}

              {activeTab === 'history' && (
                <TradeHistory key={`history-${refreshKey}`} />
              )}

              {activeTab === 'stats' && (
                <TradingStatistics key={`detailed-stats-${refreshKey}`} />
              )}
            </>
          )}
        </div>

        {/* Quick Actions */}
        <div className="fixed bottom-6 right-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Quick Actions</h4>
            <div className="space-y-2">
              <button
                onClick={handleRefresh}
                className="w-full px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Refresh All
              </button>
              <button
                onClick={() => setTab('overview')}
                className="w-full px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                New Order
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default EnhancedTradingDashboard;