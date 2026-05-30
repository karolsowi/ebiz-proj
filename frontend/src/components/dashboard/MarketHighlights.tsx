import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { marketDataService } from '../../services/marketDataService';
import StockLink from '../common/StockLink';

interface MarketIndex {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

interface TopMover {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
}

const MarketHighlights: React.FC = () => {
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [topMovers, setTopMovers] = useState<{ gainers: TopMover[]; losers: TopMover[] }>({
    gainers: [],
    losers: []
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchMarketData();
  }, []);

  const fetchMarketData = async () => {
    try {
      const indexSymbols = [
        { symbol: 'SPY', name: 'S&P 500' },
        { symbol: 'QQQ', name: 'NASDAQ' },
        { symbol: 'IWM', name: 'Russell 2000' },
      ];
      const indexQuotes = await marketDataService.getMultipleQuotes(indexSymbols.map((i) => i.symbol));
      setIndices(
        indexQuotes.map((q, i) => ({
          symbol: q.symbol,
          name: indexSymbols[i]?.name ?? q.symbol,
          price: q.price,
          change: q.change,
          changePercent: q.changePercent,
        }))
      );

      const movers = await marketDataService.getMarketMovers();
      const mapMover = (m: { symbol: string; price: string; changeAmount: string; changePercentage: string; volume: string }) => ({
        symbol: m.symbol,
        price: parseFloat(m.price) || 0,
        change: parseFloat(m.changeAmount) || 0,
        changePercent: parseFloat(String(m.changePercentage).replace('%', '')) || 0,
        volume: parseInt(m.volume, 10) || 0,
      });

      setTopMovers({
        gainers: (movers.topGainers ?? []).slice(0, 3).map(mapMover),
        losers: (movers.topLosers ?? []).slice(0, 3).map(mapMover),
      });
    } catch (error) {
      console.error('Failed to fetch market data:', error);
      setIndices([]);
      setTopMovers({ gainers: [], losers: [] });
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

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const formatVolume = (volume: number) => {
    return (volume / 1000000).toFixed(1) + 'M';
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-600 rounded mb-4"></div>
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 bg-gray-200 dark:bg-gray-600 rounded"></div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-32 bg-gray-200 dark:bg-gray-600 rounded"></div>
            <div className="h-32 bg-gray-200 dark:bg-gray-600 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Market Highlights
        </h2>
        <Link
          to="/market/overview"
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          View All
        </Link>
      </div>

      {/* Major Indices */}
      <div className="flex-grow space-y-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Major Indices</h3>
        <div className="grid grid-cols-3 gap-4">
          {indices.map((index) => (
            <div key={index.symbol} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <StockLink symbol={index.symbol} className="text-sm font-semibold text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 hover:underline" />
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                {index.name}
              </div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {formatCurrency(index.price)}
              </div>
              <div className={`text-sm ${index.change >= 0
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'
                }`}>
                {index.change >= 0 ? '↗' : '↘'} {formatPercent(index.changePercent)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top Movers */}
      <div className="grid grid-cols-2 gap-4">
        {/* Top Gainers */}
        <div>
          <h3 className="text-sm font-medium text-green-600 dark:text-green-400 mb-3">
            📈 Top Gainers
          </h3>
          <div className="space-y-2">
            {topMovers.gainers.map((stock) => (
              <div key={stock.symbol} className="flex justify-between items-center p-2 bg-green-50 dark:bg-green-900/20 rounded">
                <div>
                  <StockLink symbol={stock.symbol} className="text-sm font-semibold text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 hover:underline" />
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Vol: {formatVolume(stock.volume)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {formatCurrency(stock.price)}
                  </div>
                  <div className="text-xs text-green-600 dark:text-green-400">
                    +{formatPercent(stock.changePercent)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Losers */}
        <div>
          <h3 className="text-sm font-medium text-red-600 dark:text-red-400 mb-3">
            📉 Top Losers
          </h3>
          <div className="space-y-2">
            {topMovers.losers.map((stock) => (
              <div key={stock.symbol} className="flex justify-between items-center p-2 bg-red-50 dark:bg-red-900/20 rounded">
                <div>
                  <StockLink symbol={stock.symbol} className="text-sm font-semibold text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 hover:underline" />
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Vol: {formatVolume(stock.volume)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {formatCurrency(stock.price)}
                  </div>
                  <div className="text-xs text-red-600 dark:text-red-400">
                    {formatPercent(stock.changePercent)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Market Status */}
      <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-600">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-sm text-gray-600 dark:text-gray-400">Market Open</span>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Closes in 3h 24m
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketHighlights;