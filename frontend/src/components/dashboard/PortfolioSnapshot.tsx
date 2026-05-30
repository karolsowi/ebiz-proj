import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { tradingService } from '../../services/tradingService';
import { alpacaApi } from '../../services/alpacaApi';

interface PortfolioData {
  totalValue: number;
  dayChange: number;
  dayChangePercent: number;
  cash: number;
  positions: number;
  buyingPower: number;
}

interface HistoryPoint {
  timestamp: number;
  value: number;
}

const PortfolioSnapshot: React.FC = () => {
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [chartData, setChartData] = useState<HistoryPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await tradingService.initializeAccount();
      const [account, positionsRes] = await Promise.all([
        tradingService.getAccountInfo(),
        tradingService.getPositions(),
      ]);

      const totalValue = parseFloat(account.portfolioValue);
      const cash = parseFloat(account.balance);
      const buyingPower = parseFloat(account.buyingPower);

      setPortfolioData({
        totalValue,
        dayChange: 0,
        dayChangePercent: 0,
        cash,
        positions: positionsRes.count,
        buyingPower,
      });

      try {
        const history = (await alpacaApi.getPortfolioHistory('7D')) as {
          timestamp?: number[];
          equity?: number[];
        };
        if (history?.timestamp?.length && history?.equity?.length) {
          setChartData(
            history.timestamp.map((t: number, i: number) => ({
              timestamp: t,
              value: history.equity[i],
            }))
          );
          const last = history.equity[history.equity.length - 1];
          const prev = history.equity.length > 1 ? history.equity[history.equity.length - 2] : last;
          const dayChange = last - prev;
          const dayChangePercent = prev > 0 ? (dayChange / prev) * 100 : 0;
          setPortfolioData((prevData) =>
            prevData
              ? { ...prevData, dayChange, dayChangePercent }
              : prevData
          );
        } else {
          setChartData([]);
        }
      } catch {
        setChartData([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load portfolio');
      setPortfolioData(null);
      setChartData([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const formatDateLabel = (t: number) => {
    const date = new Date(t * 1000);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}`;
  };

  const hasChart = useMemo(() => chartData.length > 0, [chartData]);

  if (isLoading && !portfolioData) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 h-full">
        <div className="animate-pulse">
          <div className="flex justify-between mb-8">
            <div className="h-7 w-48 bg-gray-100 dark:bg-gray-700 rounded"></div>
          </div>
          <div className="h-10 w-32 bg-gray-100 dark:bg-gray-700 rounded mb-8"></div>
          <div className="h-48 bg-gray-100 dark:bg-gray-700 rounded mb-6"></div>
        </div>
      </div>
    );
  }

  if (!portfolioData) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 dark:text-gray-400 font-medium">
            {error || 'Portfolio data unavailable'}
          </p>
          <button
            onClick={() => void load()}
            className="mt-4 text-blue-600 dark:text-blue-400 hover:underline font-medium transition-colors"
          >
            Try refreshing
          </button>
        </div>
      </div>
    );
  }

  const isPositive = portfolioData.dayChange >= 0;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Portfolio Snapshot
        </h2>
        <button
          onClick={() => navigate('/trading')}
          className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          Open Trading
        </button>
      </div>

      <div className="mb-6">
        <div className="text-3xl font-bold text-gray-900 dark:text-white">
          {formatCurrency(portfolioData.totalValue)}
        </div>
        {hasChart && (
          <div className="flex items-center mt-1">
            <span className={`text-sm font-medium ${
              isPositive
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}>
              {isPositive ? '↗' : '↘'} {formatCurrency(Math.abs(portfolioData.dayChange))} ({formatPercent(portfolioData.dayChangePercent)})
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">vs prior day</span>
          </div>
        )}
      </div>

      {hasChart ? (
        <div className="flex-grow min-h-[160px] mb-6">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-brand-500)" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="var(--color-brand-500)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-gray-100)" className="dark:opacity-10" />
              <XAxis
                dataKey="timestamp"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--color-gray-400)', fontSize: 11 }}
                dy={10}
                minTickGap={30}
                interval="preserveStartEnd"
                tickFormatter={formatDateLabel}
              />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-white)',
                  borderColor: 'var(--color-gray-200)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: 'var(--color-gray-900)'
                }}
                formatter={(value: number) => [formatCurrency(value), 'Value']}
                labelFormatter={formatDateLabel}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--color-brand-500)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorValue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex-grow min-h-[80px] mb-6 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
          Chart available when broker history is connected
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Cash</div>
          <div className="text-lg font-semibold text-gray-900 dark:text-white">
            {formatCurrency(portfolioData.cash)}
          </div>
        </div>
        <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Positions</div>
          <div className="text-lg font-semibold text-gray-900 dark:text-white">
            {portfolioData.positions}
          </div>
        </div>
        <div className="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Buying Power</div>
          <div className="text-lg font-semibold text-gray-900 dark:text-white">
            {formatCurrency(portfolioData.buyingPower)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PortfolioSnapshot;
