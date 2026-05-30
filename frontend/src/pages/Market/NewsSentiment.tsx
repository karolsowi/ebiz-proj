import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import PageMeta from "../../components/common/PageMeta";
import { enhancedDataService } from "../../services/enhancedDataService";
import { useIntegrationStatus } from "../../hooks/useIntegrationStatus";
import IntegrationKeysNotice from "../../components/integrations/IntegrationKeysNotice";

type NewsArticle = {
  title?: string;
  headline?: string;
  summary?: string;
  url?: string;
  source?: string;
  publishedAt?: string;
  datetime?: number;
  sentiment?: number;
  symbols?: string[];
  category?: string;
  image?: string;
  imageUrl?: string;
};

type SentimentTrendPoint = {
  dateLabel: string;
  dateISO: string;
  date?: string;
  bullish: number;
  bearish: number;
  neutral: number;
  avgSentiment: number;
  analyzedCount: number;
};

const TRENDS_CHART_INFO =
  'Daily counts from your stored, analyzed headlines (UTC calendar days only). Bullish means sentiment score > 0.1, bearish < −0.1, neutral in between — same bands as headline labels after analysis. Topic filters apply when the stored article category matches.';

const AVG_SENTIMENT_CHART_INFO =
  'Mean stored sentiment score (−1 to +1) for all analyzed articles published each UTC day. Days with no scored articles plot as 0.';

function ChartInfoButton({ description }: { description: string }) {
  return (
    <button
      type="button"
      title={description}
      aria-label="About this chart"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200 cursor-help"
    >
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
    </button>
  );
}


export default function NewsSentiment() {
  const { status: integrationStatus } = useIntegrationStatus();
  const canFetchNews = integrationStatus?.canFetchNews ?? false;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string>('general');
  const [sentimentTrends, setSentimentTrends] = useState<SentimentTrendPoint[]>([]);
  const [realNews, setRealNews] = useState<NewsArticle[]>([]);
  const [newsAnalytics, setNewsAnalytics] = useState<{
    totalAnalyzed: number;
    averageSentiment: number;
    stockSentiments: Array<{ symbol: string; sentiment: number; mentions: number; articles: number }>;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredNews, setFilteredNews] = useState<NewsArticle[]>([]);

  useEffect(() => {
    // Filter news based on search term
    if (searchTerm.trim() === '') {
      setFilteredNews(realNews);
    } else {
      const filtered = realNews.filter(news => 
        (news.title || news.headline || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (news.summary || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (news.source || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredNews(filtered);
    }
  }, [searchTerm, realNews]);

  const loadRealNewsData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const topic = selectedTopic === 'general' ? undefined : selectedTopic;

      const [trendsOutcome, newsOutcome, analyticsOutcome] = await Promise.allSettled([
        enhancedDataService.getNewsDailySentimentTrends({ days: 7, category: topic }),
        enhancedDataService.getNewsArticles({
          limit: 20,
          hours: 24,
          preferCache: true,
          category: topic,
        }),
        enhancedDataService.getNewsSentimentAnalytics(24),
      ]);

      let trendsRes: {
        success: boolean;
        data?: Array<{
          dateLabel: string;
          dateISO: string;
          bullish: number;
          bearish: number;
          neutral: number;
          avgSentiment: number;
          analyzedCount: number;
        }>;
      } = { success: false };

      if (trendsOutcome.status === 'fulfilled') {
        trendsRes = trendsOutcome.value;
      } else {
        console.warn('Daily sentiment trends unavailable:', trendsOutcome.reason);
      }

      if (trendsRes.success && Array.isArray(trendsRes.data) && trendsRes.data.length > 0) {
        setSentimentTrends(
          trendsRes.data.map((row) => ({
            ...row,
            date: row.dateLabel
          }))
        );
      } else {
        setSentimentTrends([]);
      }

      if (newsOutcome.status === 'fulfilled' && newsOutcome.value.success && newsOutcome.value.data.length > 0) {
        setRealNews(newsOutcome.value.data);
      } else {
        if (newsOutcome.status === 'rejected') {
          console.warn('News feed:', newsOutcome.reason);
        }
        const fallback = await enhancedDataService.getNews({
          limit: 20,
          hours: 24,
          preferCache: true,
          category: topic,
        }).catch(() => null);
        setRealNews(fallback?.success ? fallback.data : []);
      }

      if (analyticsOutcome.status === 'fulfilled' && analyticsOutcome.value.success) {
        setNewsAnalytics(analyticsOutcome.value.data);
      } else {
        setNewsAnalytics(null);
      }
    } catch {
      setError('Failed to load news data');
    } finally {
      setLoading(false);
    }
  }, [selectedTopic]);

  useEffect(() => {
    void loadRealNewsData();
  }, [loadRealNewsData]);

  const runSentimentAnalysis = async () => {
    setAnalyzing(true);
    try {
      await enhancedDataService.analyzeNewsSentiment(50);
      await loadRealNewsData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sentiment analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const refreshNewsData = async () => {
    if (!canFetchNews) return;
    setRefreshing(true);
    try {
      const topic = selectedTopic === 'general' ? undefined : selectedTopic;
      await enhancedDataService.refreshNewsArticles({
        limit: 20,
        hours: 24,
        category: topic,
      });
      await loadRealNewsData();
    } catch (error) {
      console.error('Failed to refresh news data:', error);
      setError(error instanceof Error ? error.message : 'Failed to refresh news');
    } finally {
      setRefreshing(false);
    }
  };


  if (loading) {
    return (
      <>
        <PageMeta
          title="News & Sentiment | InWest - Personal Investment Platform"
          description="Market news and sentiment analysis for informed investment decisions"
        />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageMeta
          title="News & Sentiment | InWest - Personal Investment Platform"
          description="Market news and sentiment analysis for informed investment decisions"
        />
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error Loading News</h3>
              <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                <p>{error}</p>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta
        title="News & Sentiment | InWest - Personal Investment Platform"
        description="Market news and sentiment analysis for informed investment decisions"
      />
      
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">News & Sentiment</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Market news with AI-powered sentiment analysis
          </p>
        </div>

        {!canFetchNews && (
          <IntegrationKeysNotice service="news" />
        )}

        {/* Topic Filter and Controls */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">News Analysis Controls</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Charts and headlines below use shared data stored in the app. Fetching new articles requires your own API keys.
              </p>
            </div>
            {canFetchNews && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void refreshNewsData()}
                  disabled={refreshing || analyzing}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {refreshing ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Refreshing...
                    </>
                  ) : (
                    <>Refresh headlines</>
                  )}
                </button>
                <button
                  onClick={() => void runSentimentAnalysis()}
                  disabled={analyzing || refreshing}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {analyzing ? 'Analyzing…' : 'Run sentiment analysis'}
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {['general', 'technology', 'finance', 'energy', 'healthcare', 'real_estate'].map((topic) => (
              <button
                key={topic}
                onClick={() => setSelectedTopic(topic)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedTopic === topic
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {topic.charAt(0).toUpperCase() + topic.slice(1).replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Enhanced Sentiment Overview */}
        {(newsAnalytics || realNews.length > 0) && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Market Sentiment Overview</h2>
            </div>

            {newsAnalytics && (
              <div className="mb-6 grid gap-4 md:grid-cols-3">
                <div className="text-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Analyzed articles (24h)</div>
                  <div className="text-2xl font-semibold text-gray-900 dark:text-white">
                    {newsAnalytics.totalAnalyzed}
                  </div>
                </div>
                <div className="text-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Average sentiment</div>
                  <div className={`text-2xl font-semibold ${
                    newsAnalytics.averageSentiment > 0.1
                      ? 'text-green-600 dark:text-green-400'
                      : newsAnalytics.averageSentiment < -0.1
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-700 dark:text-gray-300'
                  }`}>
                    {newsAnalytics.averageSentiment.toFixed(3)}
                  </div>
                </div>
                <div className="text-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Top symbols tracked</div>
                  <div className="text-2xl font-semibold text-gray-900 dark:text-white">
                    {newsAnalytics.stockSentiments?.length ?? 0}
                  </div>
                </div>
              </div>
            )}

            {newsAnalytics?.stockSentiments && newsAnalytics.stockSentiments.length > 0 && (
              <div className="mb-6">
                <h3 className="text-md font-medium text-gray-900 dark:text-white mb-3">Stock sentiment (24h)</h3>
                <div className="flex flex-wrap gap-2">
                  {newsAnalytics.stockSentiments.slice(0, 12).map((s) => (
                    <span
                      key={s.symbol}
                      className={`px-3 py-1 rounded-full text-sm ${
                        s.sentiment > 0.1
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                          : s.sentiment < -0.1
                            ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {s.symbol} {s.sentiment >= 0 ? '+' : ''}{s.sentiment.toFixed(2)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {!newsAnalytics?.totalAnalyzed && realNews.length > 0 && (
              <p className="mb-4 text-sm text-amber-700 dark:text-amber-300">
                Headlines loaded. Click &quot;Run sentiment analysis&quot; to score articles and populate charts.
              </p>
            )}

            {/* Live News Feed Stats */}
            {realNews.length > 0 && (
              <div className="mb-6">
                <h3 className="text-md font-medium text-gray-900 dark:text-white mb-3">Live News Feed</h3>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <div className="text-lg mb-1">📰</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Total Articles</div>
                    <div className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                      {realNews.length}
                    </div>
                  </div>
                  <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                    <div className="text-lg mb-1">🔗</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Sources</div>
                    <div className="text-lg font-semibold text-purple-600 dark:text-purple-400">
                      {new Set(realNews.map(news => news.source)).size}
                    </div>
                  </div>
                  <div className="text-center p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                    <div className="text-lg mb-1">⏰</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Last 24h</div>
                    <div className="text-lg font-semibold text-orange-600 dark:text-orange-400">
                      {realNews.filter(news => {
                        const publishTime = news.datetime ? new Date(news.datetime * 1000) : new Date(news.publishedAt);
                        return (Date.now() - publishTime.getTime()) < 24 * 60 * 60 * 1000;
                      }).length}
                    </div>
                  </div>
                  <div className="text-center p-3 bg-teal-50 dark:bg-teal-900/20 rounded-lg">
                    <div className="text-lg mb-1">💱</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Market Hours</div>
                    <div className="text-lg font-semibold text-teal-600 dark:text-teal-400">
                      {(() => {
                        const now = new Date();
                        const hour = now.getHours();
                        const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
                        const isMarketHours = hour >= 9 && hour < 16;
                        return isWeekday && isMarketHours ? 'Open' : 'Closed';
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
          </div>
        )}

        {sentimentTrends.length === 0 && realNews.length > 0 && !loading && (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center text-gray-600 dark:text-gray-400">
            <p>No sentiment trend data yet for this topic.</p>
            <p className="text-sm mt-1">Fetch headlines, then run sentiment analysis to build the 7-day charts.</p>
          </div>
        )}

        {/* Advanced Sentiment Charts */}
        {sentimentTrends.length > 0 && (
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Sentiment Trends Over Time */}
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                <div className="mb-4 flex items-center gap-1">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Sentiment Trends (7 Days)</h2>
                  <ChartInfoButton description={TRENDS_CHART_INFO} />
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={sentimentTrends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.3} />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 12 }}
                      stroke="#6b7280"
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      stroke="#6b7280"
                    />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: '8px',
                        color: '#f9fafb'
                      }}
                    />
                    <Legend />
                    <Area 
                      type="monotone" 
                      dataKey="bullish" 
                      stackId="1" 
                      stroke="#10b981" 
                      fill="#10b981"
                      fillOpacity={0.7}
                      name="Bullish"
                    />
                    <Area 
                      type="monotone" 
                      dataKey="neutral" 
                      stackId="1" 
                      stroke="#6b7280" 
                      fill="#6b7280"
                      fillOpacity={0.7}
                      name="Neutral"
                    />
                    <Area 
                      type="monotone" 
                      dataKey="bearish" 
                      stackId="1" 
                      stroke="#ef4444" 
                      fill="#ef4444"
                      fillOpacity={0.7}
                      name="Bearish"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Average Sentiment Score */}
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                <div className="mb-4 flex items-center gap-1">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Average Sentiment Score</h2>
                  <ChartInfoButton description={AVG_SENTIMENT_CHART_INFO} />
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={sentimentTrends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.3} />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 12 }}
                      stroke="#6b7280"
                    />
                    <YAxis 
                      domain={[-1, 1]} 
                      tick={{ fontSize: 12 }}
                      stroke="#6b7280"
                    />
                    <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 4" />
                    <Tooltip 
                      formatter={(value: number) => [value.toFixed(3), 'Average score']}
                      contentStyle={{
                        backgroundColor: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: '8px',
                        color: '#f9fafb'
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="avgSentiment" 
                      stroke="#8b5cf6" 
                      strokeWidth={3}
                      dot={{ fill: '#8b5cf6', strokeWidth: 2, r: 6 }}
                      name="Daily average"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* News Volume and Sentiment Correlation */}
            {realNews.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">News Volume by Source</h2>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={(() => {
                    const sourceCount = new Map();
                    realNews.forEach(news => {
                      const source = news.source || 'Unknown';
                      sourceCount.set(source, (sourceCount.get(source) || 0) + 1);
                    });
                    return Array.from(sourceCount.entries()).map(([source, count]) => ({ source, count }));
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" strokeOpacity={0.3} />
                    <XAxis 
                      dataKey="source" 
                      tick={{ fontSize: 11 }}
                      stroke="#6b7280"
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      stroke="#6b7280"
                    />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: '8px',
                        color: '#f9fafb'
                      }}
                    />
                    <Bar 
                      dataKey="count" 
                      fill="#3b82f6" 
                      radius={[4, 4, 0, 0]}
                      name="Article Count"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}


        {/* Enhanced Real News Section */}
        {realNews.length > 0 && (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Live Market News</h2>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {filteredNews.length} of {realNews.length} articles
                    </span>
                  </div>
                  <select 
                    className="text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-3 py-1 text-gray-900 dark:text-white"
                    onChange={(e) => {
                      const sortBy = e.target.value;
                      const sorted = [...realNews].sort((a, b) => {
                        if (sortBy === 'date') {
                          const dateA = a.datetime ? new Date(a.datetime * 1000) : new Date(a.publishedAt);
                          const dateB = b.datetime ? new Date(b.datetime * 1000) : new Date(b.publishedAt);
                          return dateB.getTime() - dateA.getTime();
                        } else if (sortBy === 'source') {
                          return a.source.localeCompare(b.source);
                        }
                        return 0;
                      });
                      setRealNews(sorted);
                    }}
                  >
                    <option value="date">Sort by Date</option>
                    <option value="source">Sort by Source</option>
                  </select>
                </div>
              </div>
              
              {/* Search and Filter Bar */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="Search news by title, summary, or source..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    >
                      <svg className="h-5 w-5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                
                <div className="flex gap-2">
                  {['All', 'Finnhub', 'Reuters', 'Bloomberg', 'MarketWatch'].map((source) => (
                    <button
                      key={source}
                      onClick={() => {
                        if (source === 'All') {
                          setSearchTerm('');
                        } else {
                          setSearchTerm(source.toLowerCase());
                        }
                      }}
                      className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                        (source === 'All' && searchTerm === '') || searchTerm.toLowerCase() === source.toLowerCase()
                          ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-600'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {source}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            <div className="grid gap-6 lg:grid-cols-2">
              {filteredNews.slice(0, 8).map((article, index) => {
                const publishTime = article.datetime ? new Date(article.datetime * 1000) : new Date(article.publishedAt);
                const timeAgo = Math.floor((Date.now() - publishTime.getTime()) / (1000 * 60)); // minutes ago
                
                return (
                  <div key={index} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg transition-shadow">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 line-clamp-2">
                          <a 
                            href={article.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="hover:text-green-600 dark:hover:text-green-400 transition-colors"
                          >
                            {article.headline || article.title}
                          </a>
                        </h3>
                        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 mb-3">
                          <span className="font-medium">{article.source}</span>
                          <span>•</span>
                          <span>
                            {timeAgo < 60 ? `${timeAgo}m ago` : 
                             timeAgo < 1440 ? `${Math.floor(timeAgo / 60)}h ago` : 
                             `${Math.floor(timeAgo / 1440)}d ago`}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 ml-4">
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300">
                          Live
                        </span>
                        {timeAgo < 60 && (
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300">
                            Fresh
                          </span>
                        )}
                      </div>
                    </div>
                    {article.summary && (
                      <p className="text-gray-700 dark:text-gray-300 text-sm mb-3 line-clamp-3">{article.summary}</p>
                    )}
                    {(article.image || article.imageUrl) && (
                      <img 
                        src={article.image || article.imageUrl} 
                        alt={article.headline || article.title}
                        className="w-full h-32 object-cover rounded-lg"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            
            {filteredNews.length === 0 && searchTerm && (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🔍</div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No articles found</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  No articles match your search for "{searchTerm}"
                </p>
                <button
                  onClick={() => setSearchTerm('')}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  Clear Search
                </button>
              </div>
            )}
            
            {filteredNews.length > 8 && (
              <div className="text-center">
                <button 
                  onClick={() => {
                    // Show more functionality could be added here
                    console.log('Show more news');
                  }}
                  className="px-6 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
                >
                  View {filteredNews.length - 8} More Articles
                </button>
              </div>
            )}
          </div>
        )}


      </div>
    </>
  );
} 