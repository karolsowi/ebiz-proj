import React, { useState, useEffect } from 'react';

interface SentimentData {
  reddit: {
    overall: 'positive' | 'negative' | 'neutral';
    score: number;
    trending: string[];
    postCount: number;
  };
  news: {
    overall: 'positive' | 'negative' | 'neutral';
    score: number;
    headlines: string[];
    articleCount: number;
  };
  market: {
    fear_greed: number;
    volatility: number;
    trend: 'bullish' | 'bearish' | 'neutral';
  };
}

const SentimentSummary: React.FC = () => {
  const [sentimentData, setSentimentData] = useState<SentimentData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchSentimentData();
  }, []);

  const fetchSentimentData = async () => {
    try {
      // Mock data for now - would integrate with real sentiment APIs
      setSentimentData({
        reddit: {
          overall: 'positive',
          score: 0.65,
          trending: ['NVDA', 'TSLA', 'SPY'],
          postCount: 1245
        },
        news: {
          overall: 'neutral',
          score: 0.15,
          headlines: [
            'Fed officials signal potential rate cuts ahead',
            'Tech earnings season shows mixed results',
            'Energy sector sees renewed interest'
          ],
          articleCount: 89
        },
        market: {
          fear_greed: 72,
          volatility: 18.5,
          trend: 'bullish'
        }
      });
    } catch (error) {
      console.error('Failed to fetch sentiment data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getSentimentColor = (sentiment: 'positive' | 'negative' | 'neutral') => {
    switch (sentiment) {
      case 'positive':
        return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
      case 'negative':
        return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20';
      default:
        return 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20';
    }
  };

  const getSentimentIcon = (sentiment: 'positive' | 'negative' | 'neutral') => {
    switch (sentiment) {
      case 'positive':
        return '😊';
      case 'negative':
        return '😟';
      default:
        return '😐';
    }
  };

  const getFearGreedLabel = (score: number) => {
    if (score >= 75) return { label: 'Extreme Greed', color: 'text-red-600' };
    if (score >= 55) return { label: 'Greed', color: 'text-orange-600' };
    if (score >= 45) return { label: 'Neutral', color: 'text-yellow-600' };
    if (score >= 25) return { label: 'Fear', color: 'text-orange-600' };
    return { label: 'Extreme Fear', color: 'text-red-600' };
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-600 rounded mb-4"></div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="h-20 bg-gray-200 dark:bg-gray-600 rounded"></div>
            <div className="h-20 bg-gray-200 dark:bg-gray-600 rounded"></div>
          </div>
          <div className="h-24 bg-gray-200 dark:bg-gray-600 rounded"></div>
        </div>
      </div>
    );
  }

  if (!sentimentData) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="text-center text-gray-500 dark:text-gray-400">
          Sentiment data unavailable
        </div>
      </div>
    );
  }

  const fearGreedInfo = getFearGreedLabel(sentimentData.market.fear_greed);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Sentiment Summary
        </h2>
        <div className="flex space-x-4 text-sm">
          <a
            href="/market/news"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            News
          </a>
          <a
            href="/market/reddit"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Reddit
          </a>
        </div>
      </div>

      {/* Overall Sentiment Stats */}
      <div className="flex-grow space-y-6">
        <div className="grid grid-cols-2 gap-4">
          {/* Reddit Sentiment */}
          <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Reddit Sentiment
              </span>
              <span className="text-lg">{getSentimentIcon(sentimentData.reddit.overall)}</span>
            </div>
            <div className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getSentimentColor(sentimentData.reddit.overall)}`}>
              {sentimentData.reddit.overall}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              {sentimentData.reddit.postCount} posts analyzed
            </div>
          </div>

          {/* News Sentiment */}
          <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                News Sentiment
              </span>
              <span className="text-lg">{getSentimentIcon(sentimentData.news.overall)}</span>
            </div>
            <div className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getSentimentColor(sentimentData.news.overall)}`}>
              {sentimentData.news.overall}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              {sentimentData.news.articleCount} articles analyzed
            </div>
          </div>
        </div>

        {/* Fear & Greed Index */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Fear & Greed Index
            </span>
            <span className={`text-sm font-medium ${fearGreedInfo.color}`}>
              {fearGreedInfo.label}
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 h-2 rounded-full"
              style={{ width: `${sentimentData.market.fear_greed}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mt-1">
            <span>Fear</span>
            <span className="font-medium">{sentimentData.market.fear_greed}</span>
            <span>Greed</span>
          </div>
        </div>

        {/* Trending Topics */}
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            🔥 Trending on Reddit
          </h3>
          <div className="flex flex-wrap gap-2">
            {sentimentData.reddit.trending.map((symbol) => (
              <span
                key={symbol}
                className="px-2 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded text-xs font-medium"
              >
                ${symbol}
              </span>
            ))}
          </div>
        </div>

        {/* Latest Headlines */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            📰 Latest Headlines
          </h3>
          <div className="space-y-1">
            {sentimentData.news.headlines.slice(0, 2).map((headline, index) => (
              <div key={index} className="text-sm text-gray-600 dark:text-gray-400 line-clamp-1">
                • {headline}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Market Indicators */}
      <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-600">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <div className="text-sm">
              <span className="text-gray-600 dark:text-gray-400">VIX:</span>
              <span className="ml-1 font-medium text-gray-900 dark:text-white">
                {sentimentData.market.volatility}
              </span>
            </div>
            <div className={`px-2 py-1 rounded text-xs font-medium ${sentimentData.market.trend === 'bullish'
                ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                : sentimentData.market.trend === 'bearish'
                  ? 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                  : 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300'
              }`}>
              {sentimentData.market.trend} trend
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SentimentSummary;
