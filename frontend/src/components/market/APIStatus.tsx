import { useState, useEffect } from "react";
import { marketDataService } from "../../services/marketDataService";
import type { UsageStats } from "../../types/api";

export default function APIStatus() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [marketStatus, setMarketStatus] = useState<{isOpen: boolean, session: string} | null>(null);

  useEffect(() => {
    loadStats();
    loadMarketStatus();
    
    // Update stats every 30 seconds
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadStats = async () => {
    try {
      const usageStats = await marketDataService.getUsageStats();
      setStats(usageStats);
    } catch (error) {
      console.error('Failed to load usage stats:', error);
    }
  };

  const loadMarketStatus = async () => {
    try {
      const status = await marketDataService.getMarketStatus();
      setMarketStatus(status);
    } catch (error) {
      console.error('Failed to load market status:', error);
    }
  };

  if (!stats) return null;

  const alphaVantagePercentage = (stats.alphaVantageCallsToday / 500) * 100;
  const finnhubPercentage = (stats.finnhubCallsToday / 60) * 100;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">API Status</h3>
        {marketStatus && (
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${marketStatus.isOpen ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Market {marketStatus.isOpen ? 'Open' : 'Closed'}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {/* Alpha Vantage Status */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Alpha Vantage</span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {stats.alphaVantageCallsToday}/500 calls
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div 
              className={`h-2 rounded-full transition-all duration-300 ${
                alphaVantagePercentage > 90 ? 'bg-red-500' : 
                alphaVantagePercentage > 70 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(alphaVantagePercentage, 100)}%` }}
            ></div>
          </div>
        </div>

        {/* Finnhub Status */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Finnhub</span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {stats.finnhubCallsToday}/60 calls
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div 
              className={`h-2 rounded-full transition-all duration-300 ${
                finnhubPercentage > 90 ? 'bg-red-500' : 
                finnhubPercentage > 70 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(finnhubPercentage, 100)}%` }}
            ></div>
          </div>
        </div>

        {/* Current Strategy */}
        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
              <span>Primary: Alpha Vantage (comprehensive data)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
              <span>Fallback: Finnhub (when limits reached)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 