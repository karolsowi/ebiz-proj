// Reddit Analytics Dashboard - AI-Powered Sentiment Analysis
// Displays quality Reddit posts (50+ upvotes, 24h) with comprehensive sentiment analysis

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { apiClient } from '../services/apiClient';
import { apiUrl } from '../utils/apiUrl';
import { useIntegrationStatus } from '../hooks/useIntegrationStatus';
import IntegrationKeysNotice from './integrations/IntegrationKeysNotice';

interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  content: string | null;
  author: string;
  score: number;
  upvoteRatio: number;
  numComments: number;
  created: string;
  url: string | null;
  flair: string | null;
  permalink: string;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  confidenceScore: number | null;
  detectedStocks: Array<string | { symbol?: string }> | null;
  detectedSectors: Array<{
    sector: string;
    mentions: number;
    confidence: number;
  }> | null;
  financialRelevance: number | null;
}

interface PostAnalytics {
  totalPosts: number;
  totalComments: number;
  averageScore: number;
  topSubreddits: Array<{ subreddit: string; count: number }>;
  sentimentDistribution: {
    positive: number;
    negative: number;
    neutral: number;
    unanalyzed: number;
  };
}

interface SentimentAnalytics {
  overview: {
    totalAnalyzed: number;
    averageSentiment: number;
    sentimentDistribution: Record<string, number>;
  };
  topPositivePosts: Array<{
    id: string;
    title: string;
    score: number;
    sentiment: number;
    subreddit: string;
  }>;
  topNegativePosts: Array<{
    id: string;
    title: string;
    score: number;
    sentiment: number;
    subreddit: string;
  }>;
  subredditSentiment: Array<{
    subreddit: string;
    averageSentiment: number;
    postCount: number;
  }>;
}

interface StockSentiment {
  symbol: string;
  company?: string;
  sector?: string;
  sentiment: number;
  mentions: number;
  confidence: number;
  posts?: number;
}

interface SectorSentiment {
  sector: string;
  sentiment: number;
  mentions: number;
  posts?: number;
  topStocks: string[];
}

interface StockSectorData {
  stocks: StockSentiment[];
  sectors: SectorSentiment[];
  totalStockMentions: number;
  totalSectorMentions: number;
}

interface NewsAnalytics {
  totalAnalyzed: number;
  averageSentiment: number;
  stockSentiments: Array<{
    symbol: string;
    company?: string;
    sector?: string;
    sentiment: number;
    mentions: number;
    confidence: number;
    articles: number;
  }>;
  sectorSentiments: Array<{
    sector: string;
    sentiment: number;
    mentions: number;
    articles: number;
    topStocks: string[];
  }>;
  recentNews: Array<{
    id: number;
    title: string;
    summary?: string;
    source: string;
    publishedAt: Date;
    sentiment: number;
    stocks: string[];
    url: string;
  }>;
}

const RedditAnalyticsDashboard: React.FC = () => {
  const { status: integrationStatus } = useIntegrationStatus();
  const canManageReddit = integrationStatus?.canManageReddit ?? false;

  const [posts, setPosts] = useState<RedditPost[]>([]);
  const [analytics, setAnalytics] = useState<PostAnalytics | null>(null);
  const [sentimentAnalytics, setSentimentAnalytics] = useState<SentimentAnalytics | null>(null);
  const [stockSectorData, setStockSectorData] = useState<StockSectorData | null>(null);
  // New state for AI Recommendations
  const [recommendations, setRecommendations] = useState<Array<{
    symbol: string;
    score: number;
    mentions: number;
    sentiment: 'positive' | 'negative' | 'neutral';
    reason: string;
  }>>([]);
  const [newsAnalytics, setNewsAnalytics] = useState<NewsAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Filters
  const [selectedSubreddit, setSelectedSubreddit] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<number>(24);
  const [minScore, setMinScore] = useState<number>(50);

  const [isFetching, setIsFetching] = useState(false);
  const [isProcessingSentiment, setIsProcessingSentiment] = useState(false);
  const [isAutoFetchingEnabled, setIsAutoFetchingEnabled] = useState(false);

  const [backfillSummary, setBackfillSummary] = useState<{
    allHistoryComplete: boolean;
    config: { since: string; minScore: number; minComments: number };
    subs: Array<{
      subreddit: string;
      phase: string;
      topComplete: boolean;
      newHistoryComplete: boolean;
      listingCallsTotal: number;
      postsIngestedTotal: number;
    }>;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);

      const dashboardFilters = new URLSearchParams({
        hours: String(timeRange),
        minScore: String(minScore),
      });
      if (selectedSubreddit !== 'all') {
        dashboardFilters.set('subreddit', selectedSubreddit);
      }

      const qualityQs = new URLSearchParams(dashboardFilters);
      qualityQs.set('limit', '50');

      type QualityRes = {
        success: boolean;
        data: { posts: RedditPost[]; analytics: PostAnalytics };
      };

      const postsData = await apiClient.get<QualityRes>(
        apiUrl(`/api/reddit/posts/quality?${qualityQs}`)
      );

      if (postsData.success) {
        setPosts(postsData.data.posts);
        setAnalytics(postsData.data.analytics);
      }

      type SentRes = { success: boolean; data: SentimentAnalytics | null };
      const sentimentData = await apiClient.get<SentRes>(
        apiUrl(`/api/reddit/sentiment/analytics?${dashboardFilters}`)
      );
      if (sentimentData.success && sentimentData.data) {
        setSentimentAnalytics(sentimentData.data);
      } else {
        setSentimentAnalytics(null);
      }

      type SectorRes = {
        success: boolean;
        data: StockSectorData | null;
      };
      const stockSectorResult = await apiClient.get<SectorRes>(
        apiUrl(`/api/reddit/sentiment/stocks?${dashboardFilters}`)
      );
      if (stockSectorResult.success && stockSectorResult.data) {
        setStockSectorData(stockSectorResult.data);
      } else {
        setStockSectorData(null);
      }

      try {
        type NewsRes = { success: boolean; data: NewsAnalytics };
        const newsResult = await apiClient.get<NewsRes>(
          apiUrl(`/api/news/sentiment/analytics?hours=${timeRange}`)
        );
        setNewsAnalytics(newsResult.success ? newsResult.data : null);
      } catch {
        setNewsAnalytics(null);
      }

      try {
        const recData = await apiClient.get<{
          success: boolean;
          data: Array<{
            symbol: string;
            score: number;
            mentions: number;
            sentiment: 'positive' | 'negative' | 'neutral';
            reason: string;
          }>;
        }>(apiUrl(`/api/reddit/recommendations?limit=5&${dashboardFilters}`));
        if (recData.success && Array.isArray(recData.data)) {
          setRecommendations(recData.data);
        }
      } catch {
        setRecommendations([]);
      }

      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [timeRange, minScore, selectedSubreddit]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const checkAutoFetchingStatus = async () => {
      try {
        const data = await apiClient.get<{ isRunning: boolean }>(
          apiUrl('/api/reddit/automated/status')
        );
        setIsAutoFetchingEnabled(data.isRunning);
      } catch {
        setIsAutoFetchingEnabled(false);
      }
    };

    void checkAutoFetchingStatus();
  }, []);

  /** Backfill runs on the backend; poll status for the banner only. */
  useEffect(() => {
    const pollStatus = async () => {
      try {
        const status = await apiClient.get<{
          success: boolean;
          data: {
            allHistoryComplete: boolean;
            config: { since: string; minScore: number; minComments: number };
            subs: Array<{
              subreddit: string;
              phase: string;
              topComplete: boolean;
              newHistoryComplete: boolean;
              listingCallsTotal: number;
              postsIngestedTotal: number;
            }>;
          };
        }>(apiUrl('/api/reddit/backfill/status'));
        if (status.success && status.data) {
          setBackfillSummary(status.data);
        }
      } catch {
        setBackfillSummary(null);
      }
    };
    void pollStatus();
    const id = window.setInterval(pollStatus, 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const toggleAutoFetching = async () => {
    try {
      setActionError(null);
      const endpoint = isAutoFetchingEnabled ? 'stop' : 'start';
      await apiClient.post(
        apiUrl(`/api/reddit/automated/${endpoint}`),
        endpoint === 'start' ? { intervalMinutes: 15 } : undefined
      );
      setIsAutoFetchingEnabled(!isAutoFetchingEnabled);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not toggle auto-fetch');
    }
  };

  const handleManualFetch = async () => {
    setIsFetching(true);
    try {
      setActionError(null);
      const options = {
        subreddits:
          selectedSubreddit === 'all' ? ['investing', 'stocks', 'wallstreetbets'] : [selectedSubreddit],
        sort: 'hot' as const,
        limit: 10,
        fetchComments: true,
        processSentiment: true,
      };

      await apiClient.post(apiUrl('/api/reddit/fetch'), options);
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setIsFetching(false);
    }
  };

  const handleProcessSentiment = async () => {
    setIsProcessingSentiment(true);
    try {
      setActionError(null);
      await apiClient.post(apiUrl('/api/reddit/sentiment/process'), { batchSize: 50 });
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Sentiment processing failed');
    } finally {
      setIsProcessingSentiment(false);
    }
  };

  const getSentimentColor = (sentiment: number | null): string => {
    if (sentiment === null) return 'text-gray-500';
    if (sentiment >= 0.3) return 'text-green-600 dark:text-green-400';
    if (sentiment >= 0.1) return 'text-green-500 dark:text-green-300';
    if (sentiment <= -0.3) return 'text-red-600 dark:text-red-400';
    if (sentiment <= -0.1) return 'text-red-500 dark:text-red-300';
    return 'text-gray-600 dark:text-gray-400';
  };

  // Get sentiment emoji
  const getSentimentEmoji = (sentiment: number | null): string => {
    if (sentiment === null) return '❓';
    if (sentiment >= 0.3) return '🚀';
    if (sentiment >= 0.1) return '📈';
    if (sentiment <= -0.3) return '💥';
    if (sentiment <= -0.1) return '📉';
    return '➡️';
  };

  // Format time ago
  const formatTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex items-center">
          <svg className="h-5 w-5 text-red-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error Loading Reddit Data</h3>
        </div>
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>
        <button
          onClick={loadData}
          className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const COLORS = ['#10b981', '#ef4444', '#6b7280', '#f59e0b', '#8b5cf6'];

  /** Time-windowed post counts by label — matches `Analyzed` tile (same as API /sentiment/analytics) */
  const windowedPieData = (() => {
    if (!sentimentAnalytics) return [];
    const d = sentimentAnalytics.overview.sentimentDistribution;
    const positive = (d['very_positive'] ?? 0) + (d['positive'] ?? 0);
    const negative = (d['very_negative'] ?? 0) + (d['negative'] ?? 0);
    const neutral = d['neutral'] ?? 0;
    const known = new Set([
      'very_positive',
      'positive',
      'very_negative',
      'negative',
      'neutral',
      'unknown',
    ]);
    let other = d['unknown'] ?? 0;
    for (const [k, v] of Object.entries(d)) {
      if (!known.has(k)) other += v;
    }
    return [
      { name: 'Positive', value: positive },
      { name: 'Negative', value: negative },
      { name: 'Neutral', value: neutral },
      { name: 'Other', value: other },
    ];
  })();

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reddit Sentiment Analytics</h1>
            <p className="text-gray-600 dark:text-gray-400">
              AI-powered analysis of quality Reddit posts (50+ upvotes, recent activity). Post data is shared across users from the database.
            </p>
            {!canManageReddit && (
              <div className="mt-3">
                <IntegrationKeysNotice service="reddit" />
              </div>
            )}
            {backfillSummary && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                <span
                  className={
                    backfillSummary.allHistoryComplete
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }
                >
                  {backfillSummary.allHistoryComplete
                    ? 'Historical backfill complete'
                    : 'Historical backfill in progress'}
                </span>
                {' · '}
                Since {backfillSummary.config.since}, min score {backfillSummary.config.minScore}
                {backfillSummary.subs.length > 0 && (
                  <span className="mt-1 block">
                    {backfillSummary.subs
                      .map((s) => `r/${s.subreddit}: ${s.phase}`)
                      .join(' · ')}
                  </span>
                )}
              </p>
            )}
            {canManageReddit && (
            <div className="flex items-center gap-4 mt-2">
              <button
                onClick={() => void handleManualFetch()}
                disabled={isFetching || isProcessingSentiment}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${isFetching
                  ? 'bg-gray-400 cursor-not-allowed text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
              >
                {isFetching ? 'Fetching…' : 'Fetch New Posts'}
              </button>
              <button
                onClick={() => void handleProcessSentiment()}
                disabled={isProcessingSentiment || isFetching}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${isProcessingSentiment
                  ? 'bg-gray-400 cursor-not-allowed text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
              >
                {isProcessingSentiment ? 'Processing…' : 'Run Sentiment Analysis'}
              </button>

              {lastUpdate && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Last updated: {lastUpdate.toLocaleTimeString()}
                </p>
              )}
              {actionError && (
                <p className="text-sm text-red-600 dark:text-red-400 w-full">{actionError}</p>
              )}
            </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <select
              value={selectedSubreddit}
              onChange={(e) => setSelectedSubreddit(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white"
            >
              <option value="all">All Subreddits</option>
              <option value="investing">r/investing</option>
              <option value="stocks">r/stocks</option>
              <option value="wallstreetbets">r/wallstreetbets</option>
              <option value="SecurityAnalysis">r/SecurityAnalysis</option>
              <option value="ValueInvesting">r/ValueInvesting</option>
            </select>

            <select
              value={timeRange}
              onChange={(e) => setTimeRange(parseInt(e.target.value))}
              className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white"
            >
              <option value={6}>Last 6 hours</option>
              <option value={12}>Last 12 hours</option>
              <option value={24}>Last 24 hours</option>
              <option value={48}>Last 48 hours</option>
              <option value={168}>Last 7 days</option>
              <option value={336}>Last 14 days</option>
              <option value={720}>Last 30 days</option>
            </select>

            <select
              value={minScore}
              onChange={(e) => setMinScore(parseInt(e.target.value, 10))}
              className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white"
            >
              <option value={0}>Min upvotes: any</option>
              <option value={10}>Min upvotes: 10+</option>
              <option value={25}>Min upvotes: 25+</option>
              <option value={50}>Min upvotes: 50+</option>
              <option value={100}>Min upvotes: 100+</option>
            </select>

            {canManageReddit && (
            <div className="flex items-center gap-2">
              <button
                onClick={toggleAutoFetching}
                className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md border transition-colors ${isAutoFetchingEnabled
                    ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300'
                    : 'bg-gray-50 border-gray-200 text-gray-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400'
                  }`}
              >
                <div className={`w-2 h-2 rounded-full ${isAutoFetchingEnabled ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                <span>{isAutoFetchingEnabled ? 'Auto-Fetch On' : 'Auto-Fetch Off'}</span>
              </button>
            </div>
            )}
          </div>
        </div>
      </div>

      {/* Analytics Overview */}
      {analytics && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Quality Posts</p>
                <p className="text-2xl font-semibold text-gray-900 dark:text-white">{analytics.totalPosts}</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
                <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10m0 0V6a2 2 0 00-2-2H9a2 2 0 00-2 2v2m0 0v10a2 2 0 002 2h6a2 2 0 002-2V8M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M9 7v10a2 2 0 002 2h2a2 2 0 00-2-2V7" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Comments</p>
                <p className="text-2xl font-semibold text-gray-900 dark:text-white">{analytics.totalComments.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/20 rounded-lg">
                <svg className="w-6 h-6 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Avg Score</p>
                <p className="text-2xl font-semibold text-gray-900 dark:text-white">{analytics.averageScore}</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/20 rounded-lg">
                <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Analyzed</p>
                <p className="text-2xl font-semibold text-gray-900 dark:text-white">
                  {sentimentAnalytics?.overview.totalAnalyzed || 0}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sentiment Charts */}
      {sentimentAnalytics && analytics && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Sentiment Distribution */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Sentiment Distribution</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Shares of analyzed posts in the selected time range (stored in your database — not mock data).
            </p>
            {windowedPieData.every((x) => x.value === 0) ? (
              <p className="text-sm text-gray-500">No labeled posts in this range yet.</p>
            ) : (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={windowedPieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                >
                  {windowedPieData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            )}
          </div>

          {/* Recommended Stocks - AI Picks */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex flex-col gap-1 mb-4">
              <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <span className="text-2xl">🚀</span> AI Stock Picks
              </h3>
              <span className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">Based on Reddit Sentiment</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xl">
                Tickers come from detected stock mentions on posts in the same time range (minimum 2 mentions). The score is the
                average sentiment score across those posts — exploratory only, not buy/sell advice.
              </p>
            </div>

            {recommendations.length > 0 ? (
              <div className="space-y-4">
                {recommendations.map((stock) => (
                  <div key={stock.symbol} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 flex items-center justify-center rounded-full ${stock.sentiment === 'positive' ? 'bg-green-100 text-green-700' :
                        stock.sentiment === 'negative' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                        }`}>
                        <span className="font-bold text-sm">{stock.symbol}</span>
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                          {stock.symbol}
                          <span className={`text-xs px-1.5 py-0.5 rounded ${stock.sentiment === 'positive' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                            {stock.score > 0 ? '+' : ''}{stock.score.toFixed(2)}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {stock.reason} • {stock.mentions} mentions
                        </div>
                      </div>
                    </div>
                    <Link
                      to={`/market/stocks/${encodeURIComponent(stock.symbol)}`}
                      className="px-3 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 rounded-md transition-colors"
                    >
                      Analyze
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                <span className="text-4xl mb-2">🤔</span>
                <p>No clear signals yet.</p>
                <p className="text-sm">Fetch more posts to find gems!</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stock and Sector Sentiment Analytics */}
      {stockSectorData && (
        <div className="space-y-6">
          {/* Stock Sentiment Section */}
          {stockSectorData.stocks.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Individual Stock Sentiment</h3>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {stockSectorData.stocks.length} stocks mentioned
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {stockSectorData.stocks.slice(0, 12).map((stock) => (
                  <div key={stock.symbol} className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="font-semibold text-gray-900 dark:text-white">
                          ${stock.symbol}
                        </div>
                        {stock.company && (
                          <div className="text-sm text-gray-600 dark:text-gray-400 truncate">
                            {stock.company}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className={`text-lg ${getSentimentColor(stock.sentiment)}`}>
                          {getSentimentEmoji(stock.sentiment)}
                        </div>
                        <div className={`text-sm font-medium ${getSentimentColor(stock.sentiment)}`}>
                          {(stock.sentiment * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>

                    {stock.sector && (
                      <div className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded mb-2">
                        {stock.sector}
                      </div>
                    )}

            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{stock.mentions} mentions</span>
              <span>{stock.posts ?? stock.mentions} posts</span>
            </div>
                  </div>
                ))}
              </div>

              {stockSectorData.stocks.length > 12 && (
                <div className="mt-4 text-center">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Showing top 12 of {stockSectorData.stocks.length} stocks
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Sector Sentiment Section */}
          {stockSectorData.sectors.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Market Sector Sentiment</h3>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {stockSectorData.sectors.length} sectors
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {stockSectorData.sectors.map((sector) => (
                  <div key={sector.sector} className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-semibold text-gray-900 dark:text-white">
                        {sector.sector.replace(/_/g, ' ')}
                      </div>
                      <div className="text-right">
                        <div className={`text-lg ${getSentimentColor(sector.sentiment)}`}>
                          {getSentimentEmoji(sector.sentiment)}
                        </div>
                        <div className={`text-sm font-medium ${getSentimentColor(sector.sentiment)}`}>
                          {(sector.sentiment * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-2">
                      <span>{sector.mentions} mentions</span>
                      <span>{sector.posts ?? sector.mentions} posts</span>
                    </div>

                    {sector.topStocks.length > 0 && (
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        <span className="font-medium">Top stocks: </span>
                        {sector.topStocks.slice(0, 3).join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* News Sentiment Analytics */}
      {newsAnalytics && newsAnalytics.stockSentiments.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">News Sentiment Analysis</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {newsAnalytics.totalAnalyzed} articles analyzed • Avg sentiment: {(newsAnalytics.averageSentiment * 100).toFixed(0)}%
              </p>
            </div>
            <div className="text-right">
              <div className={`text-2xl ${getSentimentColor(newsAnalytics.averageSentiment)}`}>
                {getSentimentEmoji(newsAnalytics.averageSentiment)}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {newsAnalytics.stockSentiments.slice(0, 9).map((stock) => (
              <div key={stock.symbol} className="p-3 border border-gray-200 dark:border-gray-600 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      ${stock.symbol}
                    </div>
                    {stock.company && (
                      <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                        {stock.company}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className={`${getSentimentColor(stock.sentiment)}`}>
                      {getSentimentEmoji(stock.sentiment)}
                    </div>
                    <div className={`text-xs font-medium ${getSentimentColor(stock.sentiment)}`}>
                      {(stock.sentiment * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>

                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>{stock.mentions} mentions</span>
                  <span>{stock.articles} articles</span>
                </div>
              </div>
            ))}
          </div>

          {newsAnalytics.stockSentiments.length > 9 && (
            <div className="mt-4 text-center">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Showing top 9 of {newsAnalytics.stockSentiments.length} stocks from news
              </span>
            </div>
          )}
        </div>
      )}

      {/* Quality Posts */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Quality Posts</h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {posts.length} posts found
          </span>
        </div>

        <div className="space-y-4">
          {posts.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No posts found</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Try adjusting your filters or scrape new posts
              </p>
              <div className="text-center max-w-lg mx-auto">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  Use <strong>Fetch New Posts</strong> after logging in — or turn on Auto-Fetch if scraping is idle.
                  Sentiment uses the FinBERT service when it&apos;s running; otherwise keyword scoring still runs for every item.
                </p>
              </div>
            </div>
          ) : (
            posts.map((post) => (
              <div key={post.id} className="border-b border-gray-200 dark:border-gray-700 pb-4 last:border-b-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                        r/{post.subreddit}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">•</span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        u/{post.author}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">•</span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {formatTimeAgo(post.created)}
                      </span>
                      {post.flair && (
                        <>
                          <span className="text-sm text-gray-500 dark:text-gray-400">•</span>
                          <span className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                            {post.flair}
                          </span>
                        </>
                      )}
                    </div>

                    <h4 className="text-base font-medium text-gray-900 dark:text-white mb-2 line-clamp-2">
                      <a
                        href={`https://reddit.com${post.permalink}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        {post.title}
                      </a>
                    </h4>

                    {post.content && post.content.length > 0 && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
                        {post.content.substring(0, 200)}
                        {post.content.length > 200 && '...'}
                      </p>
                    )}

                    <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
                        </svg>
                        {post.score}
                      </span>
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        {post.numComments}
                      </span>
                      <span>
                        {Math.round(post.upvoteRatio * 100)}% upvoted
                      </span>
                    </div>

                    {/* AI Analysis Section */}
                    {(post.sentimentScore !== null || (post.detectedStocks && post.detectedStocks.length > 0)) && (
                      <div className="mt-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 border border-gray-100 dark:border-gray-600">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">AI Analysis</span>
                          {post.financialRelevance && post.financialRelevance > 0.5 && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded border border-green-200">Financial Content</span>
                          )}
                        </div>

                        <div className="flex flex-col gap-2">
                          {/* Detected Stocks */}
                          {post.detectedStocks && post.detectedStocks.length > 0 && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 w-16">Stocks:</span>
                              <div className="flex flex-wrap gap-1">
                                {post.detectedStocks.map((stock, i) => {
                                  const label =
                                    typeof stock === 'string'
                                      ? stock
                                      : stock &&
                                          typeof stock === 'object' &&
                                          'symbol' in stock &&
                                          typeof (stock as { symbol: unknown }).symbol === 'string'
                                        ? (stock as { symbol: string }).symbol
                                        : '?';
                                  return (
                                  <span key={i} className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded text-xs font-bold border border-blue-200 dark:border-blue-800">
                                    ${label}
                                  </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Sentiment Result */}
                          {post.sentimentScore !== null && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 w-16">Sentiment:</span>
                              <span className={`flex items-center gap-1 text-sm font-medium ${getSentimentColor(Number(post.sentimentScore))}`}>
                                {getSentimentEmoji(Number(post.sentimentScore))}
                                {post.sentimentLabel ? post.sentimentLabel.charAt(0).toUpperCase() + post.sentimentLabel.slice(1) : 'Neutral'}
                                <span className="text-xs opacity-75">({Number(post.sentimentScore).toFixed(2)})</span>
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Sector Tags */}
                    {post.detectedSectors && post.detectedSectors.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {post.detectedSectors.map((sector, index) => (
                          <div key={`sec-${index}`} className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 dark:bg-purple-900/10 text-purple-600 dark:text-purple-400 rounded-full text-xs">
                            <span>🏢</span>
                            <span>{sector.sector.replace(/_/g, ' ')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {post.sentimentScore !== null ? (
                      <div className="flex items-center gap-2">
                        <span className="text-lg">
                          {getSentimentEmoji(post.sentimentScore)}
                        </span>
                        <div className="text-right">
                          <div className={`text-sm font-medium ${getSentimentColor(post.sentimentScore)}`}>
                            {post.sentimentLabel?.replace('_', ' ').toUpperCase() || 'UNKNOWN'}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {(post.sentimentScore * 100).toFixed(0)}% confidence
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-gray-400">
                        <span>❓</span>
                        <span className="text-xs">Not analyzed</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default RedditAnalyticsDashboard;