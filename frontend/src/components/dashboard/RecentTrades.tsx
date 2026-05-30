import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { tradingService } from '../../services/tradingService';
import StockLink from '../common/StockLink';

interface RecentTrade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  timestamp: string;
  status: string;
}

const RecentTrades: React.FC = () => {
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [positions, setPositions] = useState<Array<{ symbol: string; unrealizedPL: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [historyRes, positionsRes] = await Promise.all([
        tradingService.getTradeHistory({ limit: 5 }),
        tradingService.getPositions(),
      ]);

      setRecentTrades(
        historyRes.trades.map((order) => ({
          id: String(order.id),
          symbol: order.symbol,
          side: order.side,
          quantity: parseFloat(order.filledQuantity || order.quantity) || 0,
          price: parseFloat(order.averageFillPrice || order.limitPrice || '0') || 0,
          timestamp: order.filledAt || order.submittedAt,
          status: order.status,
        }))
      );

      setPositions(
        positionsRes.positions.map((p) => ({
          symbol: p.symbol,
          unrealizedPL: p.unrealizedPL || '0',
        }))
      );
    } catch (err) {
      console.error('Failed to fetch recent trades:', err);
      setError(err instanceof Error ? err.message : 'Failed to load trades');
      setRecentTrades([]);
      setPositions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 h-full flex flex-col">
        <div className="animate-pulse flex-grow">
          <div className="h-6 bg-gray-200 dark:bg-gray-600 rounded mb-4 w-1/3"></div>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex justify-between items-center">
                <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-20"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-16"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-24"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Recent Trades
        </h2>
        <Link
          to="/trading?tab=history"
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          View All
        </Link>
      </div>

      {error && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {recentTrades.length === 0 ? (
        <div className="flex-grow flex flex-col items-center justify-center py-8 text-gray-500 dark:text-gray-400">
          <div className="text-4xl mb-2">📈</div>
          <div>No recent trades</div>
          <div className="text-sm mt-1">Your trading activity will appear here</div>
          <Link
            to="/trading"
            className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            Go to Trading
          </Link>
        </div>
      ) : (
        <div className="flex-grow space-y-3">
          {recentTrades.map((trade) => (
            <div key={trade.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium ${
                  trade.side === 'buy' ? 'bg-green-500' : 'bg-red-500'
                }`}>
                  {trade.side === 'buy' ? '↗' : '↘'}
                </div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {trade.side.toUpperCase()} <StockLink symbol={trade.symbol} />
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {trade.quantity} shares · {trade.status}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="font-medium text-gray-900 dark:text-white">
                  {formatCurrency(trade.price)}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {formatTime(trade.timestamp)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {positions.length > 0 && (
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-600">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Open Positions ({positions.length})
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {positions.slice(0, 4).map((position) => {
              const pl = parseFloat(position.unrealizedPL);
              return (
                <div key={position.symbol} className="flex justify-between items-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
                  <StockLink symbol={position.symbol} className="text-sm font-semibold text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 hover:underline" />
                  <span className={`text-sm ${pl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {pl >= 0 ? '+' : ''}{pl.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default RecentTrades;
