/**
 * News Sentiment Analysis Service
 * AI-powered sentiment analysis for financial news with stock/sector detection
 */

import { db } from '../db/connection';
import { newsArticles, sentimentScores } from '../db/schema';
import { eq, and, sql, isNull, gte, lte, desc } from 'drizzle-orm';
import { stockSectorDetectionService, type StockMention, type SectorMention } from './stockSectorDetectionService';
import type { MLSentimentScore } from './mlSentimentClient.js';

type NewsStockMention = StockMention & {
  titleMentions: number;
  bodyMentions: number;
  impactMultiplier: number;
};

export interface NewsSentimentResult {
  score: number; // -1 to 1, where -1 is very negative, 1 is very positive
  label: 'very_negative' | 'negative' | 'neutral' | 'positive' | 'very_positive';
  confidence: number; // 0 to 1
  keywords: string[];
  stocks: NewsStockMention[]; // Detected stock mentions with title/body impact
  sectors: SectorMention[]; // Detected sector mentions
  relevance: number; // Financial relevance score 0-1
}

/** One calendar day of stored news-article sentiment aggregates (UTC date boundaries). */
export interface DailyNewsSentimentTrend {
  dateLabel: string;
  dateISO: string;
  bullish: number;
  bearish: number;
  neutral: number;
  /** Mean `sentiment_score` for articles counted that day (−1…1). 0 when none. */
  avgSentiment: number;
  analyzedCount: number;
}

export interface NewsAnalytics {
  totalAnalyzed: number;
  averageSentiment: number;
  stockSentiments: {
    symbol: string;
    company?: string;
    sector?: string;
    sentiment: number;
    mentions: number;
    confidence: number;
    articles: number;
  }[];
  sectorSentiments: {
    sector: string;
    sentiment: number;
    mentions: number;
    confidence: number;
  }[];
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

export class NewsSentimentAnalyzer {
  private readonly maxMlTokens = Math.max(
    64,
    parseInt(process.env.NEWS_ML_MAX_TOKENS || '512', 10) || 512,
  );
  private readonly duplicateWindowMs = 10 * 60 * 1000;
  private readonly fastBackfillMode = process.env.NEWS_BACKFILL_FAST_MODE === 'true';
  private readonly skipAggregateWrites = process.env.NEWS_BACKFILL_SKIP_AGG_WRITES === 'true';
  private readonly processingConcurrency = Math.max(
    1,
    parseInt(process.env.NEWS_SENTIMENT_CONCURRENCY || '4', 10) || 4,
  );
  private financialKeywords = {
    bullish: [
      'surge', 'jump', 'soar', 'rally', 'climb', 'gain', 'profit', 'growth', 'upgrade', 'buy',
      'outperform', 'beat', 'record', 'high', 'bull', 'optimis',
      // Formal news/analyst language
      'exceed', 'exceeded expectations', 'beats estimates', 'beat estimates',
      'raised guidance', 'guidance increase', 'dividend increase', 'dividend hike',
      'strategic acquisition', 'accretive acquisition', 'margin expansion', 'strong demand'
    ],
    bearish: [
      'plunge', 'drop', 'fall', 'sink', 'loss', 'decline', 'downgrade', 'sell',
      'underperform', 'miss', 'low', 'bear', 'pessimis', 'crash', 'slump', 'weak',
      // Formal news/analyst language
      'missed estimates', 'missed expectations', 'guidance cut', 'cut guidance',
      'restructuring', 'impairment', 'write-down', 'litigation', 'probe', 'investigation',
      'regulatory headwind', 'margin compression', 'soft demand'
    ],
    neutral: ['hold', 'stable', 'flat', 'unchanged', 'maintain', 'expect', 'wait', 'watch', 'report', 'announce']
  };

  /**
   * Build a canonical input for news sentiment:
   * - Always includes the full title
   * - Appends summary first (fallback: content)
   * - Caps total payload to ~512 whitespace tokens for ML stability
   */
  buildSentimentInput(title: string, summary?: string | null, content?: string | null): string {
    const safeTitle = (title || '').trim().replace(/\s+/g, ' ');
    const fallbackBody = (summary && summary.trim().length > 0 ? summary : content) || '';
    const safeBody = fallbackBody.trim().replace(/\s+/g, ' ');

    if (!safeTitle) return '';
    if (!safeBody) return safeTitle;

    const titleTokens = safeTitle.split(/\s+/).filter(Boolean);
    const bodyTokens = safeBody.split(/\s+/).filter(Boolean);

    // Never truncate title; if title alone reaches/exceeds limit, drop body.
    if (titleTokens.length >= this.maxMlTokens) {
      return safeTitle;
    }

    const remaining = this.maxMlTokens - titleTokens.length;
    const truncatedBody = bodyTokens.slice(0, remaining);
    if (truncatedBody.length === 0) return safeTitle;

    return `${safeTitle} ${truncatedBody.join(' ')}`;
  }

  private normalizeTitle(title: string): string {
    return (title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isNearDuplicateTitle(a: string, b: string): boolean {
    const aa = this.normalizeTitle(a);
    const bb = this.normalizeTitle(b);
    if (!aa || !bb) return false;
    if (aa === bb) return true;
    if (aa.includes(bb) || bb.includes(aa)) return true;

    const aTokens = new Set(aa.split(' ').filter(Boolean));
    const bTokens = new Set(bb.split(' ').filter(Boolean));
    if (aTokens.size === 0 || bTokens.size === 0) return false;

    let intersection = 0;
    for (const t of aTokens) {
      if (bTokens.has(t)) intersection++;
    }
    const union = aTokens.size + bTokens.size - intersection;
    const jaccard = union > 0 ? intersection / union : 0;
    return jaccard >= 0.85;
  }

  private async getDuplicateCandidates(
    articles: Array<typeof newsArticles.$inferSelect>,
  ): Promise<Array<{
    id: number;
    title: string;
    publishedAt: Date;
    sentiment: string | null;
    sentimentScore: string | null;
    relevanceScore: string | null;
  }>> {
    if (articles.length === 0) return [];

    const articleIds = articles.map((article) => article.id);
    const publishedTimes = articles.map((article) =>
      article.publishedAt instanceof Date ? article.publishedAt.getTime() : new Date(article.publishedAt as unknown as string).getTime()
    );
    const minPublishedAt = new Date(Math.min(...publishedTimes) - this.duplicateWindowMs);
    const maxPublishedAt = new Date(Math.max(...publishedTimes) + this.duplicateWindowMs);

    const candidates = await db
      .select({
        id: newsArticles.id,
        title: newsArticles.title,
        publishedAt: newsArticles.publishedAt,
        sentiment: newsArticles.sentiment,
        sentimentScore: newsArticles.sentimentScore,
        relevanceScore: newsArticles.relevanceScore,
      })
      .from(newsArticles)
      .where(and(
        gte(newsArticles.publishedAt, minPublishedAt),
        lte(newsArticles.publishedAt, maxPublishedAt),
        sql`${newsArticles.sentimentScore} IS NOT NULL`,
        sql`${newsArticles.id} NOT IN (${sql.join(articleIds.map((id) => sql`${id}`), sql`, `)})`,
      ))
      .limit(5000);

    return candidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      publishedAt: candidate.publishedAt instanceof Date ? candidate.publishedAt : new Date(candidate.publishedAt as unknown as string),
      sentiment: candidate.sentiment ?? null,
      sentimentScore: candidate.sentimentScore?.toString() ?? null,
      relevanceScore: candidate.relevanceScore?.toString() ?? null,
    }));
  }

  private findNearDuplicateFromCandidates(
    article: typeof newsArticles.$inferSelect,
    candidates: Array<{
      id: number;
      title: string;
      publishedAt: Date;
      sentiment: string | null;
      sentimentScore: string | null;
      relevanceScore: string | null;
    }>,
  ): {
    sentiment: string | null;
    sentimentScore: string | null;
    relevanceScore: string | null;
  } | null {
    const center = article.publishedAt instanceof Date ? article.publishedAt : new Date(article.publishedAt as unknown as string);
    const fromMs = center.getTime() - this.duplicateWindowMs;
    const toMs = center.getTime() + this.duplicateWindowMs;
    const match = candidates.find((candidate) => {
      const publishedAtMs = candidate.publishedAt.getTime();
      if (publishedAtMs < fromMs || publishedAtMs > toMs) return false;
      return this.isNearDuplicateTitle(article.title, candidate.title);
    });

    if (!match) return null;
    return {
      sentiment: match.sentiment,
      sentimentScore: match.sentimentScore,
      relevanceScore: match.relevanceScore,
    };
  }

  // Analyze sentiment of a text — uses ML (FinBERT) when available, keyword-based fallback
  async analyzeSentiment(
    text: string,
    options?: {
      precomputedMl?: MLSentimentScore | null;
      title?: string;
      summary?: string | null;
      content?: string | null;
    },
  ): Promise<NewsSentimentResult> {
    const normalizedText = text.toLowerCase();
    let score = 0;
    let wordCount = 0;
    const keywords: string[] = [];

    // Keyword-based sentiment analysis
    this.financialKeywords.bullish.forEach(word => {
      const regex = new RegExp(`\\b${word}\\w*\\b`, 'g');
      const matches = normalizedText.match(regex);
      if (matches) {
        score += matches.length * 0.5;
        wordCount += matches.length;
        if (!keywords.includes(word)) keywords.push(word);
      }
    });

    this.financialKeywords.bearish.forEach(word => {
      const regex = new RegExp(`\\b${word}\\w*\\b`, 'g');
      const matches = normalizedText.match(regex);
      if (matches) {
        score -= matches.length * 0.5;
        wordCount += matches.length;
        if (!keywords.includes(word)) keywords.push(word);
      }
    });

    // Normalize keyword score to -1 to 1
    const keywordScore = Math.max(-1, Math.min(1, score));

    // Try ML-based analysis (FinBERT) — returns null if service unavailable
    const { mlSentimentClient } = await import('./mlSentimentClient.js');
    let mlResult: MLSentimentScore | null;
    if (options && 'precomputedMl' in options) {
      mlResult = options.precomputedMl ?? null;
    } else {
      mlResult = await mlSentimentClient.analyzeText(text);
    }

    let finalScore: number;
    let confidence: number;

    if (mlResult) {
      // Dynamic blend: when ML is highly confident, rely more on ML.
      const mlWeight = mlResult.confidence > 0.85
        ? 0.8
        : mlResult.confidence >= 0.7
          ? 0.6
          : mlResult.confidence >= 0.5
            ? 0.5
            : 0.4;
      const keywordWeight = 1 - mlWeight;
      finalScore = mlResult.score * mlWeight + keywordScore * keywordWeight;
      confidence = Math.min(0.95, mlResult.confidence * 0.7 + (wordCount > 0 ? 0.3 : 0.1));
    } else {
      // Fallback: keyword-based only
      finalScore = keywordScore;
      confidence = Math.min(0.9, 0.5 + (wordCount * 0.05));
    }

    // Determine label
    let label: NewsSentimentResult['label'] = 'neutral';
    if (finalScore >= 0.5) label = 'very_positive';
    else if (finalScore >= 0.1) label = 'positive';
    else if (finalScore <= -0.5) label = 'very_negative';
    else if (finalScore <= -0.1) label = 'negative';

    // Fast backlog mode: return ML-dominant score and skip expensive detection logic.
    if (this.fastBackfillMode) {
      return {
        score: finalScore,
        label,
        confidence,
        keywords,
        stocks: [],
        sectors: [],
        relevance: mlResult ? Math.max(0.2, mlResult.confidence) : Math.min(0.7, 0.2 + wordCount * 0.03),
      };
    }

    // Detect stocks/sectors with title-vs-body split for symbol-specific impact.
    const titleText = (options?.title || '').trim();
    const bodyText = ((options?.summary && options.summary.trim().length > 0) ? options.summary : options?.content || '').trim();
    const detectionTitle = titleText ? stockSectorDetectionService.detectStocksAndSectors(titleText) : { stocks: [], sectors: [] };
    const detectionBody = bodyText ? stockSectorDetectionService.detectStocksAndSectors(bodyText) : { stocks: [], sectors: [] };
    const detectionAll = stockSectorDetectionService.detectStocksAndSectors(text);

    const titleMentionsBySymbol = new Map<string, number>();
    detectionTitle.stocks.forEach((stock) => {
      titleMentionsBySymbol.set(stock.symbol, stock.mentions);
    });

    const bodyMentionsBySymbol = new Map<string, number>();
    detectionBody.stocks.forEach((stock) => {
      bodyMentionsBySymbol.set(stock.symbol, stock.mentions);
    });

    const stocks: NewsStockMention[] = detectionAll.stocks.map((stock) => {
      const titleMentions = titleMentionsBySymbol.get(stock.symbol) || 0;
      const bodyMentions = bodyMentionsBySymbol.get(stock.symbol) || 0;
      return {
        ...stock,
        titleMentions,
        bodyMentions,
        impactMultiplier: titleMentions > 0 ? 2 : 1,
      };
    });
    const sectors = detectionAll.sectors;

    // Calculate relevance
    const weightedStockMentions = stocks.reduce((sum, stock) => {
      const normalMentions = Math.max(0, stock.mentions - stock.titleMentions);
      const weighted = (stock.titleMentions * 2) + normalMentions;
      return sum + weighted;
    }, 0);
    const relevance = Math.min(1, (wordCount > 0 ? 0.4 : 0.1) + (weightedStockMentions * 0.12) + (sectors.length * 0.08));

    return {
      score: finalScore,
      label,
      confidence,
      keywords,
      stocks,
      sectors,
      relevance
    };
  }

  // Extract keywords from text
  private extractKeywords(text: string): string[] {
    const normalizedText = text.toLowerCase();
    const keywords: string[] = [];

    // Extract financial sentiment keywords
    [...this.financialKeywords.bullish, ...this.financialKeywords.bearish, ...this.financialKeywords.neutral]
      .forEach(word => {
        const regex = new RegExp(`\\b${word}\\w*\\b`, 'g');
        if (regex.test(normalizedText)) {
          if (!keywords.includes(word)) keywords.push(word);
        }
      });

    return keywords;
  }

  // Process unanalyzed news articles
  async processUnanalyzedNews(limit: number = 20): Promise<{ processed: number, failed: number, stockSentimentsStored: number }> {
    console.log('📰 Processing unanalyzed news articles...');
    let processed = 0;
    let failed = 0;
    let stockSentimentsStored = 0;

    // Get unanalyzed articles
    const articles = await db.select()
      .from(newsArticles)
      .where(isNull(newsArticles.sentimentScore))
      .orderBy(desc(newsArticles.publishedAt))
      .limit(limit);

    if (articles.length === 0) {
      console.log('No unanalyzed news articles found.');
      return { processed: 0, failed: 0, stockSentimentsStored: 0 };
    }

    console.log(`Found ${articles.length} unanalyzed articles.`);

    // Pre-fetch ML scores in one batch path (internally chunked by ML_MAX_TEXTS_PER_REQUEST)
    // to reduce per-article HTTP overhead during archive-scale processing.
    const analysisInputs = articles.map((article) =>
      this.buildSentimentInput(article.title, article.summary, article.content)
    );
    const { mlSentimentClient } = await import('./mlSentimentClient.js');
    const mlScores = await mlSentimentClient.analyzeBatch(analysisInputs);
    const duplicateCandidates = await this.getDuplicateCandidates(articles);

    let nextIndex = 0;
    const runWorker = async () => {
      while (true) {
        const currentIndex = nextIndex++;
        if (currentIndex >= articles.length) return;
        const article = articles[currentIndex]!;
      try {
          const duplicate = this.findNearDuplicateFromCandidates(article, duplicateCandidates);
        if (duplicate) {
          await db
            .update(newsArticles)
            .set({
              sentiment: duplicate.sentiment ?? 'neutral',
              sentimentScore: duplicate.sentimentScore ?? '0',
              relevanceScore: duplicate.relevanceScore ?? '0',
              isProcessed: true,
            })
            .where(eq(newsArticles.id, article.id));
          processed++;
          continue;
        }

          const textToAnalyze = analysisInputs[currentIndex]!;
        const sentimentResult = await this.analyzeSentiment(textToAnalyze, {
            precomputedMl: mlScores?.[currentIndex] ?? null,
          title: article.title,
          summary: article.summary,
          content: article.content,
        });
        const stockN = await this.persistAnalyzedNewsArticle(article.id, sentimentResult);
        stockSentimentsStored += stockN;

        processed++;
      } catch (error) {
        console.error(`Failed to analyze sentiment for news article ${article.id}:`, error);
        failed++;
      }
      }
    };

    const workerCount = Math.min(this.processingConcurrency, articles.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    console.log(`📰 Processed sentiment for ${processed} news articles, ${failed} failed, ${stockSentimentsStored} stock sentiments stored`);
    return { processed, failed, stockSentimentsStored };
  }

  async persistAnalyzedNewsArticle(
    articleId: number,
    sentimentResult: NewsSentimentResult,
  ): Promise<number> {
    await db
      .update(newsArticles)
      .set({
        sentiment: sentimentResult.label,
        sentimentScore: sentimentResult.score.toString(),
        relevanceScore: sentimentResult.relevance.toString(),
      })
      .where(eq(newsArticles.id, articleId));

    if (!this.skipAggregateWrites && sentimentResult.stocks?.length) {
      await this.storeNewsSentimentScores(sentimentResult);
      return sentimentResult.stocks.length;
    }
    return 0;
  }

  // Store sentiment scores for stocks and sectors from news
  async storeNewsSentimentScores(sentiment: NewsSentimentResult): Promise<void> {
    if (!sentiment.stocks || sentiment.stocks.length === 0) {
      return;
    }

    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    try {
      for (const stock of sentiment.stocks) {
        // Store individual stock sentiment from news
        await this.upsertNewsSentimentScore({
          symbol: stock.symbol,
          date,
          timeframe: 'daily',
          source: 'news',
          sentiment: sentiment.score * stock.impactMultiplier,
          mentions: stock.mentions,
          confidence: stock.confidence * sentiment.confidence
        });

        // Store sector sentiment if available
        if (stock.sector && stock.sector !== 'ETF') {
          await this.upsertNewsSentimentScore({
            symbol: stock.sector.toUpperCase().replace(/\s+/g, '_'),
            date,
            timeframe: 'daily',
            source: 'news_sector',
            sentiment: sentiment.score,
            mentions: stock.mentions,
            confidence: stock.confidence * sentiment.confidence
          });
        }
      }
    } catch (error) {
      console.error('Error storing news sentiment scores:', error);
    }
  }

  // Upsert news sentiment score
  private async upsertNewsSentimentScore(params: {
    symbol: string;
    date: Date;
    timeframe: string;
    source: string;
    sentiment: number;
    mentions: number;
    confidence: number;
  }): Promise<void> {
    const bullishCount = params.sentiment > 0.1 ? params.mentions : 0;
    const bearishCount = params.sentiment < -0.1 ? params.mentions : 0;
    const neutralCount = bullishCount === 0 && bearishCount === 0 ? params.mentions : 0;

    // Atomic UPSERT (row-level lock via ON CONFLICT update path) to avoid races in parallel backfills.
    await db.execute(sql`
      INSERT INTO sentiment_scores (
        symbol, date, timeframe, source,
        bullish_count, bearish_count, neutral_count, total_mentions,
        average_sentiment, weighted_sentiment, confidence_score,
        created_at, updated_at
      ) VALUES (
        ${params.symbol}, ${params.date}, ${params.timeframe}, ${params.source},
        ${bullishCount}, ${bearishCount}, ${neutralCount}, ${params.mentions},
        ${params.sentiment}, ${params.sentiment}, ${params.confidence},
        NOW(), NOW()
      )
      ON CONFLICT (symbol, date, timeframe, source)
      DO UPDATE SET
        bullish_count = sentiment_scores.bullish_count + EXCLUDED.bullish_count,
        bearish_count = sentiment_scores.bearish_count + EXCLUDED.bearish_count,
        neutral_count = sentiment_scores.neutral_count + EXCLUDED.neutral_count,
        total_mentions = sentiment_scores.total_mentions + EXCLUDED.total_mentions,
        average_sentiment = (
          (
            COALESCE(CAST(sentiment_scores.average_sentiment AS DOUBLE PRECISION), 0.0) * sentiment_scores.total_mentions
          ) + (
            COALESCE(CAST(EXCLUDED.average_sentiment AS DOUBLE PRECISION), 0.0) * EXCLUDED.total_mentions
          )
        ) / NULLIF((sentiment_scores.total_mentions + EXCLUDED.total_mentions), 0),
        weighted_sentiment = (
          (
            COALESCE(CAST(sentiment_scores.weighted_sentiment AS DOUBLE PRECISION), 0.0) * sentiment_scores.total_mentions
          ) + (
            COALESCE(CAST(EXCLUDED.weighted_sentiment AS DOUBLE PRECISION), 0.0) * EXCLUDED.total_mentions
          )
        ) / NULLIF((sentiment_scores.total_mentions + EXCLUDED.total_mentions), 0),
        confidence_score = (
          COALESCE(CAST(sentiment_scores.confidence_score AS DOUBLE PRECISION), 0.0) +
          COALESCE(CAST(EXCLUDED.confidence_score AS DOUBLE PRECISION), 0.0)
        ) / 2.0,
        updated_at = NOW()
    `);
  }

  /**
   * Daily counts and mean score from persisted `news_articles` rows with `sentiment_score`.
   * Buckets: score > 0.1 bullish, score < -0.1 bearish, else neutral (aligned with label thresholds).
   */
  async getDailyNewsSentimentTrends(days: number = 7, category?: string): Promise<DailyNewsSentimentTrend[]> {
    const safeDays = Math.min(90, Math.max(1, Math.floor(Number(days)) || 7));
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);

    const startDate = new Date(todayUtc);
    startDate.setUTCDate(startDate.getUTCDate() - (safeDays - 1));

    const filters = [
      gte(newsArticles.publishedAt, startDate),
      sql`${newsArticles.sentimentScore} IS NOT NULL`
    ];

    if (category && category.trim() !== '' && category !== 'general') {
      filters.push(eq(newsArticles.category, category.trim()));
    }

    const articles = await db
      .select({
        publishedAt: newsArticles.publishedAt,
        sentimentScore: newsArticles.sentimentScore
      })
      .from(newsArticles)
      .where(and(...filters));

    type Bucket = { bulls: number; bears: number; neutrals: number; sum: number; n: number };
    const byDay = new Map<string, Bucket>();

    const utcDateKey = (d: Date): string => d.toISOString().slice(0, 10);

    for (const article of articles) {
      const t = article.publishedAt instanceof Date ? article.publishedAt : new Date(article.publishedAt as string);
      const k = utcDateKey(t);
      const raw = Number(article.sentimentScore);
      if (!Number.isFinite(raw)) continue;

      let b = byDay.get(k);
      if (!b) {
        b = { bulls: 0, bears: 0, neutrals: 0, sum: 0, n: 0 };
        byDay.set(k, b);
      }
      b.sum += raw;
      b.n++;
      if (raw > 0.1) b.bulls++;
      else if (raw < -0.1) b.bears++;
      else b.neutrals++;
    }

    const out: DailyNewsSentimentTrend[] = [];
    for (let i = safeDays - 1; i >= 0; i--) {
      const d = new Date(todayUtc);
      d.setUTCDate(d.getUTCDate() - i);
      const iso = utcDateKey(d);
      const agg = byDay.get(iso);
      out.push({
        dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        dateISO: iso,
        bullish: agg?.bulls ?? 0,
        bearish: agg?.bears ?? 0,
        neutral: agg?.neutrals ?? 0,
        avgSentiment: agg != null && agg.n > 0 ? agg.sum / agg.n : 0,
        analyzedCount: agg?.n ?? 0
      });
    }

    return out;
  }

  // Get news analytics with stock/sector breakdown
  async getNewsAnalytics(hours: number = 24): Promise<NewsAnalytics> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Get recent analyzed articles
    const recentArticles = await db.select({
      id: newsArticles.id,
      title: newsArticles.title,
      summary: newsArticles.summary,
      source: newsArticles.source,
      publishedAt: newsArticles.publishedAt,
      sentiment: newsArticles.sentimentScore,
      symbols: newsArticles.symbols,
      url: newsArticles.url
    })
      .from(newsArticles)
      .where(and(
        gte(newsArticles.publishedAt, since),
        sql`sentiment_score IS NOT NULL`
      ))
      .orderBy(desc(newsArticles.publishedAt))
      .limit(50);

    // Get stock sentiments from news
    const stockSentiments = await db.select({
      symbol: sentimentScores.symbol,
      sentiment: sentimentScores.averageSentiment,
      mentions: sentimentScores.totalMentions,
      confidence: sentimentScores.confidenceScore
    })
      .from(sentimentScores)
      .where(and(
        gte(sentimentScores.updatedAt, since),
        eq(sentimentScores.source, 'news')
      ))
      .orderBy(desc(sentimentScores.totalMentions));

    const processedStockSentiments = stockSentiments.map(result => {
      const stockInfo = stockSectorDetectionService.getStockInfo(result.symbol);
      return {
        symbol: result.symbol,
        ...(stockInfo?.company ? { company: stockInfo.company } : {}),
        ...(stockInfo?.sector ? { sector: stockInfo.sector } : {}),
        sentiment: Number(result.sentiment) || 0,
        mentions: result.mentions || 0,
        confidence: Number(result.confidence) || 0,
        articles: 1 // TODO: Count actual articles per stock
      };
    }).filter(stock => stock.company);

    // Calculate totals
    const totalAnalyzed = recentArticles.length;
    const averageSentiment = totalAnalyzed > 0
      ? recentArticles.reduce((sum, article) => sum + (Number(article.sentiment) || 0), 0) / totalAnalyzed
      : 0;

    return {
      totalAnalyzed,
      averageSentiment,
      stockSentiments: processedStockSentiments.slice(0, 20),
      sectorSentiments: [], // TODO: Implement sector aggregation
      recentNews: recentArticles.map(article => ({
        id: article.id,
        title: article.title,
        summary: article.summary || undefined,
        source: article.source,
        publishedAt: article.publishedAt,
        sentiment: Number(article.sentiment) || 0,
        stocks: (Array.isArray(article.symbols) ? article.symbols : []) as string[],
        url: article.url || ''
      })) as NewsAnalytics['recentNews']
    };
  }

  // Start automated news sentiment processing
  async startAutomatedProcessing(intervalMinutes: number = 30): Promise<void> {
    console.log(`📰 Starting automated news sentiment processing every ${intervalMinutes} minutes`);

    // Run immediately
    await this.processUnanalyzedNews();

    // Set up interval
    setInterval(async () => {
      try {
        await this.processUnanalyzedNews();
      } catch (error) {
        console.error('Error in automated news sentiment processing:', error);
      }
    }, intervalMinutes * 60 * 1000);
  }
}

export const newsSentimentAnalyzer = new NewsSentimentAnalyzer();