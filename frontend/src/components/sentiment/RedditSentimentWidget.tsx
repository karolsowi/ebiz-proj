import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { marketDataService } from '../../services/marketDataService';

interface RedditSentimentWidgetProps {
  symbol: string;
}

const SENTIMENT_COLORS = {
  bullish: '#10b981',
  bearish: '#ef4444',
  neutral: '#6b7280',
};

const RedditSentimentWidget: React.FC<RedditSentimentWidgetProps> = ({ symbol }) => {
  const [data, setData] = useState<Array<{ date: string; bullish: number; bearish: number; neutral: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const history = await marketDataService.getRedditSentimentHistory(symbol, 30);

      if (!Array.isArray(history)) {
        setData([]);
        return;
      }

      const grouped: Record<string, { date: string; bullish: number; bearish: number; neutral: number }> = {};
      for (const item of history) {
        if (!item.date) continue;
        const dateStr = item.date.split('T')[0];
        if (!grouped[dateStr]) {
          grouped[dateStr] = { date: dateStr, bullish: 0, bearish: 0, neutral: 0 };
        }
        grouped[dateStr].bullish += Number(item.bullish) || 0;
        grouped[dateStr].bearish += Number(item.bearish) || 0;
        grouped[dateStr].neutral += Number(item.neutral) || 0;
      }

      const chartData = Object.values(grouped);
      chartData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      if (chartData.length === 1) {
        const prevDay = new Date(chartData[0].date);
        prevDay.setDate(prevDay.getDate() - 1);
        chartData.unshift({
          date: prevDay.toISOString().split('T')[0],
          bullish: 0,
          bearish: 0,
          neutral: 0,
        });
      }

      setData(chartData);
    } catch (e) {
      setData([]);
      setError(e instanceof Error ? e.message : 'Failed to load Reddit sentiment');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-brand-500" />
        <p className="mt-4 text-gray-500 dark:text-gray-400">Loading Reddit sentiment…</p>
      </div>
    );
  }

  const hasData = data.some((d) => d.bullish > 0 || d.bearish > 0 || d.neutral > 0);

  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
            <svg className="h-6 w-6 text-[#ff4500]" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
            </svg>
            Reddit Sentiment (30 days)
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Daily mention counts from analyzed Reddit posts mentioning {symbol}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchData()}
          className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">
          {error}
        </p>
      )}

      {!hasData ? (
        <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center py-12 text-center text-gray-500">
          <span className="mb-4 text-4xl" aria-hidden>
            📊
          </span>
          <p className="max-w-sm">
            No scored Reddit history for {symbol} yet. Fetch posts and run sentiment on the{' '}
            <Link to="/market/reddit" className="text-brand-500 hover:underline">
              Reddit analysis
            </Link>{' '}
            page, then return here.
          </p>
        </div>
      ) : (
        <div className="mt-4 w-full flex-1" style={{ minHeight: '300px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorBullish" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={SENTIMENT_COLORS.bullish} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={SENTIMENT_COLORS.bullish} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorBearish" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={SENTIMENT_COLORS.bearish} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={SENTIMENT_COLORS.bearish} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(date) =>
                  new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                }
                stroke="#888888"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" opacity={0.2} />
              <Tooltip
                labelFormatter={(date) =>
                  new Date(date).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                }
                contentStyle={{
                  backgroundColor: '#1f2937',
                  borderColor: '#374151',
                  color: '#f3f4f6',
                  borderRadius: '0.375rem',
                }}
              />
              <Area
                type="monotone"
                dataKey="bullish"
                stroke={SENTIMENT_COLORS.bullish}
                fillOpacity={1}
                fill="url(#colorBullish)"
                name="Bullish"
              />
              <Area
                type="monotone"
                dataKey="neutral"
                stroke={SENTIMENT_COLORS.neutral}
                fillOpacity={0.1}
                fill={SENTIMENT_COLORS.neutral}
                name="Neutral"
              />
              <Area
                type="monotone"
                dataKey="bearish"
                stroke={SENTIMENT_COLORS.bearish}
                fillOpacity={1}
                fill="url(#colorBearish)"
                name="Bearish"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default RedditSentimentWidget;
