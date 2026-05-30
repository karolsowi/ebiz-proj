import React, { useState, useEffect, useCallback } from 'react';
import { tradingService, TradeHistoryItem } from '../../services/tradingService';

const TradeHistory: React.FC = () => {
  const [trades, setTrades] = useState<TradeHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    symbol: '',
    side: '',
    status: '',
    limit: 50,
    offset: 0,
  });

  const loadTradeHistory = useCallback(async (active: typeof filters) => {
    try {
      setLoading(true);
      const response = await tradingService.getTradeHistory({
        symbol: active.symbol || undefined,
        side: active.side || undefined,
        status: active.status || undefined,
        limit: active.limit,
        offset: active.offset,
      });
      setTrades(response.trades);
      setError(null);
    } catch (err) {
      console.error('Error loading trade history:', err);
      setError(err instanceof Error ? err.message : 'Failed to load trade history');
      setTrades([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTradeHistory(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value, offset: 0 }));
  };

  const applyFilters = () => {
    void loadTradeHistory({ ...filters, offset: 0 });
  };

  const clearFilters = () => {
    const cleared = {
      symbol: '',
      side: '',
      status: '',
      limit: 50,
      offset: 0,
    };
    setFilters(cleared);
    void loadTradeHistory(cleared);
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadge = (status: string) => {
    const statusClasses = {
      filled: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300',
      canceled: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300',
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300',
      partially_filled: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300',
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        statusClasses[status as keyof typeof statusClasses] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300'
      }`}>
        {status.replace('_', ' ').toUpperCase()}
      </span>
    );
  };

  const getSideBadge = (side: string) => {
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        side === 'buy' 
          ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
          : 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
      }`}>
        {side.toUpperCase()}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-4 bg-gray-300 dark:bg-gray-600 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Trade History ({trades.length})
        </h3>
        
        {/* Paper Trading Indicator */}
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200">
          PAPER TRADING
        </span>
      </div>

      {/* Filters */}
      <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Symbol
            </label>
            <input
              type="text"
              name="symbol"
              value={filters.symbol}
              onChange={handleFilterChange}
              placeholder="e.g., AAPL"
              className="w-full px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-600 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Side
            </label>
            <select
              name="side"
              value={filters.side}
              onChange={handleFilterChange}
              className="w-full px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-600 dark:text-white"
            >
              <option value="">All</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Status
            </label>
            <select
              name="status"
              value={filters.status}
              onChange={handleFilterChange}
              className="w-full px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-600 dark:text-white"
            >
              <option value="">All</option>
              <option value="filled">Filled</option>
              <option value="canceled">Canceled</option>
              <option value="pending">Pending</option>
              <option value="partially_filled">Partially Filled</option>
            </select>
          </div>

          <div className="flex items-end space-x-2">
            <button
              onClick={applyFilters}
              className="px-4 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Apply
            </button>
            <button
              onClick={clearFilters}
              className="px-4 py-1 bg-gray-600 text-white text-sm rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {trades.length === 0 ? (
        <div className="text-center py-8">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No trades found</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {filters.symbol || filters.side || filters.status 
              ? 'Try adjusting your filters or clear them to see all trades.'
              : 'Get started by placing your first order.'
            }
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-600">
                <th className="text-left py-3 text-gray-900 dark:text-gray-100">Date</th>
                <th className="text-left py-3 text-gray-900 dark:text-gray-100">Symbol</th>
                <th className="text-center py-3 text-gray-900 dark:text-gray-100">Side</th>
                <th className="text-right py-3 text-gray-900 dark:text-gray-100">Qty</th>
                <th className="text-right py-3 text-gray-900 dark:text-gray-100">Price</th>
                <th className="text-right py-3 text-gray-900 dark:text-gray-100">Value</th>
                <th className="text-center py-3 text-gray-900 dark:text-gray-100">Status</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.id} className="border-b border-gray-100 dark:border-gray-700">
                  <td className="py-3 text-gray-600 dark:text-gray-300">
                    {formatDateTime(trade.submittedAt)}
                  </td>
                  <td className="py-3">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {trade.symbol}
                    </span>
                  </td>
                  <td className="py-3 text-center">
                    {getSideBadge(trade.side)}
                  </td>
                  <td className="py-3 text-right text-gray-900 dark:text-gray-100">
                    {parseInt(trade.quantity).toLocaleString()}
                  </td>
                  <td className="py-3 text-right text-gray-900 dark:text-gray-100">
                    {trade.averageFillPrice 
                      ? tradingService.formatCurrency(trade.averageFillPrice)
                      : trade.limitPrice
                        ? tradingService.formatCurrency(trade.limitPrice)
                        : 'Market'
                    }
                  </td>
                  <td className="py-3 text-right text-gray-900 dark:text-gray-100">
                    {trade.averageFillPrice 
                      ? tradingService.formatCurrency(
                          parseFloat(trade.filledQuantity) * parseFloat(trade.averageFillPrice)
                        )
                      : '-'
                    }
                  </td>
                  <td className="py-3 text-center">
                    {getStatusBadge(trade.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex justify-between items-center text-sm text-gray-500 dark:text-gray-400">
        <span>Showing {trades.length} trades</span>
        <button
          onClick={() => void loadTradeHistory(filters)}
          className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Refresh
        </button>
      </div>
    </div>
  );
};

export default TradeHistory;