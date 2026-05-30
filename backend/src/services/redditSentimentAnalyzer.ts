// Reddit Sentiment Analysis Service
// AI-powered sentiment analysis for Reddit posts and comments with stock/sector detection

import { db } from '../db/connection.js';
import { redditPosts, redditComments, sentimentScores } from '../db/schema.js';
import { eq, and, sql, isNull, gte, desc, inArray, or, gt, getTableColumns } from 'drizzle-orm';
import { stockSectorDetectionService, type StockMention, type SectorMention, type DetectionResult } from './stockSectorDetectionService.js';
import type { MLSentimentScore } from './mlSentimentClient.js';

/** Reddit comment numeric score (net score, not a separate "likes" counter); threshold for ML sentiment. */
export const REDDIT_COMMENT_MIN_SCORE_SENTIMENT = Math.max(
  0,
  parseInt(process.env.REDDIT_COMMENT_MIN_SCORE_SENTIMENT ?? '20', 10),
);

/**
 * FinBERT / lexicon see the reply in thread context (parent post title + body, truncated).
 */
export function buildCommentWithPostContext(
  postTitle: string | null | undefined,
  postContent: string | null | undefined,
  commentBody: string,
  options?: {
    maxWords?: number;
    titleMaxWords?: number;
    commentMaxWords?: number;
    contentMaxWords?: number;
  },
): string {
  const totalMaxWords = Math.max(60, options?.maxWords ?? 360);
  const titleCap = Math.max(10, options?.titleMaxWords ?? 64);
  const commentCap = Math.max(30, options?.commentMaxWords ?? 220);
  const contentCap = Math.max(0, options?.contentMaxWords ?? 120);

  const title = (postTitle ?? '').replace(/\s+/g, ' ').trim();
  const content = (postContent ?? '').replace(/\s+/g, ' ').trim();
  const comment = commentBody.replace(/\s+/g, ' ').trim();

  const trimWords = (value: string, maxWords: number): string => {
    if (!value || maxWords <= 0) return '';
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return words.join(' ');
    return `${words.slice(0, maxWords).join(' ')}…`;
  };

  const titlePart = trimWords(title, titleCap);
  const commentPart = trimWords(comment, commentCap);
  const usedByPriority = [titlePart, commentPart]
    .filter(Boolean)
    .reduce((sum, part) => sum + part.split(/\s+/).filter(Boolean).length, 0);

  const remaining = Math.max(0, totalMaxWords - usedByPriority);
  const contentPart = trimWords(content, Math.min(contentCap, remaining));

  const postBlock = [titlePart, contentPart].filter(Boolean).join('\n').trim();
  if (!postBlock) {
    return `[COMMENT]\n${commentPart}`;
  }
  return `[POST]\n${postBlock}\n[COMMENT]\n${commentPart}`;
}

export interface SentimentResult {
  score: number; // -1 to 1, where -1 is very negative, 1 is very positive
  label: 'very_negative' | 'negative' | 'neutral' | 'positive' | 'very_positive';
  confidence: number; // 0 to 1
  keywords: string[];
  stocks: StockMention[]; // Detected stock mentions with their sentiment
  sectors: SectorMention[]; // Detected sector mentions
  relevance: number; // Financial relevance score 0-1
}

export interface SentimentBatch {
  processed: number;
  failed: number;
  results: Array<{
    id: string;
    type: 'post' | 'comment';
    sentiment: SentimentResult;
  }>;
}

export class RedditSentimentAnalyzer {
  private static readonly TICKER_WINDOW_WORDS = 20;

  // Financial keywords for enhanced sentiment analysis
  private readonly financialKeywords = {
    bullish: [
      'buy', 'bull', 'bullish', 'moon', 'pump', 'up', 'rise', 'gain', 'profit',
      'investment', 'growth', 'opportunity', 'potential', 'strong', 'positive',
      'rally', 'surge', 'breakout', 'rocket', 'diamond hands', 'hold', 'hodl'
    ],
    bearish: [
      'sell', 'bear', 'bearish', 'dump', 'down', 'fall', 'loss', 'crash',
      'bubble', 'overvalued', 'decline', 'drop', 'weak', 'negative',
      'correction', 'pullback', 'resistance', 'paper hands', 'panic'
    ],
    neutral: [
      'analysis', 'research', 'study', 'report', 'data', 'chart', 'technical',
      'fundamental', 'valuation', 'earnings', 'revenue', 'market', 'stock'
    ]
  };

  // Enhanced sentiment analysis using multiple techniques with stock/sector detection + ML
  async analyzeSentiment(
    text: string,
    context: 'post' | 'comment' = 'post',
    options?: { precomputedMl?: MLSentimentScore | null; commentDepth?: number },
  ): Promise<SentimentResult> {
    const cleanText = this.preprocessText(text);

    // Detect stocks and sectors in the text
    const detection = stockSectorDetectionService.detectStocksAndSectors(text);

    // Combine multiple analysis methods (keyword-based)
    const lexiconScore = this.lexiconBasedAnalysis(cleanText);
    const financialScore = this.financialContextAnalysis(cleanText);
    const patternScore = this.patternBasedAnalysis(text);

    let mlResult: MLSentimentScore | null;
    if (options && 'precomputedMl' in options) {
      mlResult = options.precomputedMl ?? null;
    } else {
      const { mlSentimentClient } = await import('./mlSentimentClient.js');
      mlResult = await mlSentimentClient.analyzeText(text);
    }

    let finalScore: number;
    let confidence: number;

    if (mlResult) {
      // ML available: give it highest weight (0.4), reduce others
      const relevanceBoost = detection.overallRelevance * 0.1;
      finalScore = (
        mlResult.score * (0.4 + relevanceBoost) +
        lexiconScore.score * 0.2 +
        financialScore.score * (0.25 - relevanceBoost * 0.5) +
        patternScore.score * 0.15
      );

      // ML boosts confidence significantly
      confidence = this.calibrateConfidence(
        lexiconScore, financialScore, patternScore,
        cleanText, detection
      );
      confidence = Math.min(1.0, confidence + 0.15); // ML presence boosts confidence
    } else {
      // Fallback: keyword-based only (existing logic)
      const baseWeights = context === 'post' ?
        { lexicon: 0.4, financial: 0.4, pattern: 0.2 } :
        { lexicon: 0.5, financial: 0.3, pattern: 0.2 };

      const relevanceBoost = detection.overallRelevance * 0.2;
      const weights = {
        lexicon: baseWeights.lexicon - relevanceBoost * 0.5,
        financial: baseWeights.financial + relevanceBoost,
        pattern: baseWeights.pattern
      };

      finalScore = (
        lexiconScore.score * weights.lexicon +
        financialScore.score * weights.financial +
        patternScore.score * weights.pattern
      );

      confidence = this.calibrateConfidence(
        lexiconScore, financialScore, patternScore,
        cleanText, detection
      );
    }

    if (context === 'comment') {
      const commentDepth = Math.max(0, options?.commentDepth ?? 0);
      if (commentDepth > 0) {
        const decay = this.computeCommentDepthDecay(commentDepth);
        finalScore *= decay;
        confidence = Math.max(0.05, Math.min(1, confidence * (0.85 + decay * 0.15)));
      }
    }

    // Apply sentiment to detected stocks using local ticker windows to avoid collateral sentiment.
    const stocksWithSentiment = detection.stocks.map(stock => {
      const localWindow = this.getLocalTickerWindowText(text, stock.contexts, RedditSentimentAnalyzer.TICKER_WINDOW_WORDS);
      const localAnalysis = localWindow
        ? this.computeKeywordOnlySentiment(localWindow)
        : null;
      const localScore = localAnalysis?.score ?? finalScore;
      const localConfidence = localAnalysis?.confidence ?? confidence;

      // Keep some global signal for stability while prioritizing ticker-local context.
      const blendedStockScore = localAnalysis ? (localScore * 0.7 + finalScore * 0.3) : finalScore;

      return {
        ...stock,
        sentiment: Math.max(-1, Math.min(1, blendedStockScore)),
        sentimentLabel: this.scoreToLabel(blendedStockScore),
        sentimentConfidence: Math.max(0.05, Math.min(1, localConfidence))
      };
    });

    return {
      score: Math.max(-1, Math.min(1, finalScore)),
      label: this.scoreToLabel(finalScore),
      confidence,
      keywords: [...financialScore.keywords, ...lexiconScore.keywords].slice(0, 10),
      stocks: stocksWithSentiment,
      sectors: detection.sectors,
      relevance: detection.overallRelevance
    };
  }

  private getLocalTickerWindowText(originalText: string, contexts: string[], windowWords: number): string | null {
    if (!contexts || contexts.length === 0) return null;

    const windows: string[] = [];
    for (const snippet of contexts.slice(0, 3)) {
      if (!snippet || snippet.trim().length === 0) continue;
      const words = snippet.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;

      if (words.length <= windowWords * 2) {
        windows.push(words.join(' '));
      } else {
        windows.push(words.slice(0, windowWords * 2).join(' '));
      }
    }

    if (windows.length === 0) {
      const fallbackWords = originalText.trim().split(/\s+/).filter(Boolean).slice(0, windowWords * 2);
      return fallbackWords.length ? fallbackWords.join(' ') : null;
    }

    return windows.join(' ');
  }

  private computeKeywordOnlySentiment(windowText: string): { score: number; confidence: number } {
    const cleanWindow = this.preprocessText(windowText);
    const lexicon = this.lexiconBasedAnalysis(cleanWindow);
    const financial = this.financialContextAnalysis(cleanWindow);
    const pattern = this.patternBasedAnalysis(windowText);

    const score = lexicon.score * 0.4 + financial.score * 0.45 + pattern.score * 0.15;
    const confidence = Math.max(
      0.05,
      Math.min(1, (lexicon.confidence * 0.35) + (financial.confidence * 0.45) + (pattern.confidence * 0.2)),
    );

    return {
      score: Math.max(-1, Math.min(1, score)),
      confidence,
    };
  }

  private computeCommentDepthDecay(depth: number): number {
    // Depth 0 keeps full impact; deeper levels decay toward neutral (lower actionable signal).
    const safeDepth = Math.max(0, depth);
    const decay = 1 / (1 + safeDepth * 0.18);
    return Math.max(0.35, Math.min(1, decay));
  }

  // Preprocess text for analysis
  private preprocessText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  // Lexicon-based sentiment analysis
  private lexiconBasedAnalysis(text: string): { score: number; confidence: number; keywords: string[] } {
    const words = text.split(' ');
    const sentimentWords = [];
    let score = 0;
    let wordCount = 0;

    // Enhanced sentiment lexicon
    const positiveWords = [
      'good', 'great', 'excellent', 'amazing', 'awesome', 'fantastic', 'wonderful',
      'love', 'like', 'happy', 'excited', 'optimistic', 'confident', 'successful',
      'win', 'winner', 'victory', 'achieve', 'accomplish', 'improve', 'better',
      'best', 'perfect', 'outstanding', 'superior', 'impressive', 'remarkable'
    ];

    const negativeWords = [
      'bad', 'terrible', 'awful', 'horrible', 'hate', 'dislike', 'sad', 'angry',
      'disappointed', 'frustrated', 'worried', 'concerned', 'scared', 'fear',
      'lose', 'loser', 'failure', 'fail', 'wrong', 'mistake', 'problem',
      'worse', 'worst', 'poor', 'inferior', 'disappointing', 'concerning'
    ];

    const intensifiers: Record<string, number> = {
      'very': 1.5, 'extremely': 2.0, 'really': 1.3, 'quite': 1.2, 'so': 1.4,
      'absolutely': 1.8, 'completely': 1.7, 'totally': 1.6
    };

    let intensifier = 1.0;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!word) continue;

      // Check for intensifiers
      if (intensifiers[word]) {
        intensifier = intensifiers[word];
        continue;
      }

      // Check sentiment
      if (positiveWords.includes(word)) {
        const wordScore = 1 * intensifier;
        score += wordScore;
        wordCount++;
        sentimentWords.push(word);
      } else if (negativeWords.includes(word)) {
        const wordScore = -1 * intensifier;
        score += wordScore;
        wordCount++;
        sentimentWords.push(word);
      }

      // Reset intensifier
      intensifier = 1.0;
    }

    const normalizedScore = wordCount > 0 ? score / wordCount : 0;
    const confidence = Math.min(wordCount / 10, 1.0); // Higher confidence with more sentiment words

    return {
      score: Math.max(-1, Math.min(1, normalizedScore)),
      confidence,
      keywords: sentimentWords.slice(0, 5)
    };
  }

  // Financial context analysis
  private financialContextAnalysis(text: string): { score: number; confidence: number; keywords: string[] } {
    const words = text.split(' ');
    let bullishCount = 0;
    let bearishCount = 0;
    const foundKeywords = [];

    // Count financial sentiment words
    for (const word of words) {
      if (this.financialKeywords.bullish.includes(word)) {
        bullishCount++;
        foundKeywords.push(word);
      } else if (this.financialKeywords.bearish.includes(word)) {
        bearishCount++;
        foundKeywords.push(word);
      }
    }

    const totalFinancialWords = bullishCount + bearishCount;
    const score = totalFinancialWords > 0 ?
      (bullishCount - bearishCount) / totalFinancialWords : 0;

    const confidence = Math.min(totalFinancialWords / 5, 1.0);

    return {
      score: Math.max(-1, Math.min(1, score)),
      confidence,
      keywords: foundKeywords.slice(0, 5)
    };
  }

  // Pattern-based analysis (emojis, caps, punctuation)
  private patternBasedAnalysis(text: string): { score: number; confidence: number; keywords: string[] } {
    let score = 0;
    const patterns = [];
    const rawText = text || '';
    const upperText = rawText.toUpperCase();

    // Positive emojis and patterns
    const positivePatterns = [
      { pattern: /🚀|📈|💎|🌙|💰|🤑|😄|😊|🎉|👍/g, weight: 0.5 },
      { pattern: /!!+/g, weight: 0.2 }, // Multiple exclamation marks
      { pattern: /MOON|TO THE MOON/gi, weight: 0.8 },
      { pattern: /DIAMOND HANDS|💎🙌/gi, weight: 0.6 }
    ];

    // Negative emojis and patterns
    const negativePatterns = [
      { pattern: /📉|💸|😭|😢|🤡|💩|👎|😡/g, weight: -0.5 },
      { pattern: /\?\?\?+/g, weight: -0.2 }, // Multiple question marks indicating confusion
      { pattern: /CRASH|DUMP|RIP/gi, weight: -0.8 },
      { pattern: /PAPER HANDS|🧻🙌/gi, weight: -0.6 }
    ];

    // Count positive patterns
    for (const { pattern, weight } of positivePatterns) {
      const matches = rawText.match(pattern);
      if (matches) {
        score += matches.length * weight;
        patterns.push(`positive_pattern_${matches[0]}`);
      }
    }

    // Count negative patterns
    for (const { pattern, weight } of negativePatterns) {
      const matches = rawText.match(pattern);
      if (matches) {
        score += matches.length * weight;
        patterns.push(`negative_pattern_${matches[0]}`);
      }
    }

    // WSB hype stacks: consecutive hype emojis carry super-linear intensity.
    const hypeStackRegex = /(🚀{2,}|📈{2,}|💎{2,}|🌙{2,}|💰{2,})/g;
    const hypeStacks = rawText.match(hypeStackRegex) || [];
    for (const stack of hypeStacks) {
      const stackLen = Array.from(stack).length;
      const boosted = Math.pow(1.18, Math.max(0, stackLen - 1)) * 0.35;
      score += boosted;
      patterns.push(`hype_stack_${stackLen}`);
    }

    // Sarcasm / "loss porn" handling:
    // If intense positive hype appears with explicit loss words, neutralize/flip optimism.
    const lossSignals = /\b(loss|losses|lost|red|down bad|blown up|blew up|bagholder|margin call|wipe(d)? out)\b/i.test(rawText);
    const sarcasmSignals = /\b(guh|nice work retard|congrats retard)\b/i.test(rawText);
    const highPositiveHype =
      hypeStacks.length > 0 ||
      /🚀|💎🙌|TO THE MOON|MOON/i.test(upperText);

    if ((lossSignals && highPositiveHype) || sarcasmSignals) {
      if (score > 0) {
        score = score * -0.45;
      } else {
        score -= 0.25;
      }
      patterns.push('wsb_sarcasm_loss_porn');
    }

    const confidence = Math.min(Math.abs(score), 1.0);

    return {
      score: Math.max(-1, Math.min(1, score)),
      confidence,
      keywords: patterns.slice(0, 3)
    };
  }

  // Calibrate confidence based on text quality and detection results
  private calibrateConfidence(
    lexiconScore: { score: number; confidence: number; keywords: string[] },
    financialScore: { score: number; confidence: number; keywords: string[] },
    patternScore: { score: number; confidence: number; keywords: string[] },
    text: string,
    detection: DetectionResult
  ): number {
    // Base: average of sub-confidence scores (0-1)
    let confidence = (lexiconScore.confidence + financialScore.confidence + patternScore.confidence) / 3;

    // Boost for text length (longer text = more context = higher confidence)
    const wordCount = text.split(/\s+/).length;
    if (wordCount > 100) confidence += 0.15;
    else if (wordCount > 50) confidence += 0.1;
    else if (wordCount > 20) confidence += 0.05;
    else if (wordCount < 5) confidence -= 0.1; // Very short text = low confidence

    // Boost for financial relevance
    if (detection.overallRelevance > 0.5) confidence += 0.1;
    else if (detection.overallRelevance > 0.2) confidence += 0.05;

    // Boost for stock mentions (text is specifically about stocks)
    if (detection.stocks.length > 2) confidence += 0.1;
    else if (detection.stocks.length > 0) confidence += 0.05;

    // Boost for agreement between methods (all agree = high confidence)
    const signs = [
      Math.sign(lexiconScore.score),
      Math.sign(financialScore.score),
      Math.sign(patternScore.score)
    ].filter(s => s !== 0);

    if (signs.length >= 2 && signs.every(s => s === signs[0])) {
      confidence += 0.1; // Methods agree on direction
    }

    // Penalty for very mixed signals
    if (signs.length >= 2 && new Set(signs).size > 1) {
      confidence -= 0.05; // Conflicting signals reduce confidence
    }

    // Total sentiment keyword count
    const totalKeywords = lexiconScore.keywords.length + financialScore.keywords.length;
    if (totalKeywords > 5) confidence += 0.05;

    return Math.max(0.05, Math.min(1.0, confidence));
  }

  // Convert numerical score to label
  private scoreToLabel(score: number): SentimentResult['label'] {
    if (score >= 0.5) return 'very_positive';
    if (score >= 0.15) return 'positive';
    if (score <= -0.5) return 'very_negative';
    if (score <= -0.15) return 'negative';
    return 'neutral';
  }

  // Process sentiment for unanalyzed posts
  async processUnanalyzedPosts(batchSize: number = 20): Promise<SentimentBatch> {
    const unanalyzedPosts = await db.select()
      .from(redditPosts)
      .where(isNull(redditPosts.sentimentScore))
      .orderBy(desc(redditPosts.fetchedAt))
      .limit(batchSize);

    const results = [];
    let processed = 0;
    let failed = 0;

    for (const post of unanalyzedPosts) {
      try {
        const text = `${post.title} ${post.content || ''}`.trim();
        if (text.length < 10) {
          await db
            .update(redditPosts)
            .set({
              sentimentScore: '0',
              sentimentLabel: 'neutral',
              confidenceScore: '0',
              financialRelevance: '0',
              lastUpdated: new Date(),
            })
            .where(eq(redditPosts.id, post.id));
          processed++;
          continue;
        }

        const sentiment = await this.analyzeSentiment(text, 'post');
        await this.persistAnalyzedPost(post.id, sentiment);

        results.push({
          id: post.id,
          type: 'post' as const,
          sentiment
        });

        processed++;
      } catch (error) {
        console.error(`Failed to analyze sentiment for post ${post.id}:`, error);
        failed++;
      }
    }

    console.log(`📊 Processed sentiment for ${processed} posts, ${failed} failed`);
    return { processed, failed, results };
  }

  /** Persist analysis result for one post (shared with bulk backfill). */
  async persistAnalyzedPost(postId: string, sentiment: SentimentResult): Promise<void> {
    const stockSymbols = sentiment.stocks?.length
      ? [...new Set(sentiment.stocks.map((s) => s.symbol.toUpperCase()))]
      : null;

    await db
      .update(redditPosts)
      .set({
        sentimentScore: sentiment.score.toString(),
        sentimentLabel: sentiment.label,
        confidenceScore: sentiment.confidence.toString(),
        detectedStocks: stockSymbols,
        detectedSectors: sentiment.sectors || null,
        financialRelevance: sentiment.relevance.toString(),
        lastUpdated: new Date(),
      })
      .where(eq(redditPosts.id, postId));

    if (sentiment.stocks?.length) {
      await this.storeSentimentScores(sentiment, 'reddit');
    }
  }

  /** Persist analysis result for one comment (shared with bulk backfill). */
  async persistAnalyzedComment(commentId: string, sentiment: SentimentResult): Promise<void> {
    const stockSymbols = sentiment.stocks?.length
      ? [...new Set(sentiment.stocks.map((s) => s.symbol.toUpperCase()))]
      : null;

    await db
      .update(redditComments)
      .set({
        sentimentScore: sentiment.score.toString(),
        sentimentLabel: sentiment.label,
        confidenceScore: sentiment.confidence.toString(),
        detectedStocks: stockSymbols,
        detectedSectors: sentiment.sectors || null,
        financialRelevance: sentiment.relevance.toString(),
        lastUpdated: new Date(),
      })
      .where(eq(redditComments.id, commentId));

    if (sentiment.stocks?.length) {
      await this.storeSentimentScores(sentiment, 'reddit_comments');
    }
  }

  // Process sentiment for unanalyzed comments
  async processUnanalyzedComments(batchSize: number = 50): Promise<SentimentBatch> {
    const unanalyzedComments = await db
      .select({
        ...getTableColumns(redditComments),
        postTitle: redditPosts.title,
        postContent: redditPosts.content,
      })
      .from(redditComments)
      .leftJoin(redditPosts, eq(redditComments.postId, redditPosts.id))
      .where(
        and(
          isNull(redditComments.sentimentScore),
          sql`length(trim(${redditComments.content})) > 20`,
          gte(redditComments.score, REDDIT_COMMENT_MIN_SCORE_SENTIMENT),
        ),
      )
      .orderBy(desc(redditComments.fetchedAt))
      .limit(batchSize);

    const results = [];
    let processed = 0;
    let failed = 0;

    for (const row of unanalyzedComments) {
      try {
        const text = buildCommentWithPostContext(row.postTitle, row.postContent, row.content);
        const sentiment = await this.analyzeSentiment(text, 'comment', { commentDepth: row.depth });
        await this.persistAnalyzedComment(row.id, sentiment);

        results.push({
          id: row.id,
          type: 'comment' as const,
          sentiment
        });

        processed++;
      } catch (error) {
        console.error(`Failed to analyze sentiment for comment ${row.id}:`, error);
        failed++;
      }
    }

    console.log(`💬 Processed sentiment for ${processed} comments, ${failed} failed`);
    return { processed, failed, results };
  }

  /** Align with getQualityPosts: score threshold OR strong sentiment */
  private buildDashboardPostWhere(
    since: Date,
    filters?: { minScore: number; subreddit?: string },
    until?: Date
  ) {
    const timeClause = until
      ? and(gte(redditPosts.fetchedAt, since), sql`${redditPosts.fetchedAt} < ${until}`)
      : gte(redditPosts.fetchedAt, since);

    if (!filters) {
      return timeClause;
    }
    const minScore = filters.minScore;
    return and(
      timeClause,
      or(
        gt(redditPosts.score, minScore),
        sql`CAST(${redditPosts.sentimentScore} AS FLOAT) > 0.5`
      )!,
      ...(filters.subreddit ? [eq(redditPosts.subreddit, filters.subreddit)] : [])
    );
  }

  private normalizeDetectedStockSymbols(raw: unknown): string[] {
    if (!raw || !Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item === 'string' && item.trim()) {
        out.push(item.trim().toUpperCase());
        continue;
      }
      if (item && typeof item === 'object' && 'symbol' in item) {
        const sym = (item as { symbol: unknown }).symbol;
        if (typeof sym === 'string' && sym.trim()) out.push(sym.trim().toUpperCase());
      }
    }
    return [...new Set(out)];
  }

  private normalizeDetectedSectorNames(raw: unknown): string[] {
    if (!raw || !Array.isArray(raw)) return [];
    const names: string[] = [];
    for (const item of raw) {
      if (item && typeof item === 'object' && 'sector' in item) {
        const s = (item as { sector: unknown }).sector;
        if (typeof s === 'string' && s.trim()) names.push(s.trim());
      }
    }
    return [...new Set(names)];
  }

  /** Stock/sector panels when dashboard filters apply — aggregates from reddit_posts only */
  private async getStockSectorSentimentFromFilteredPosts(
    hours: number,
    filters: { minScore: number; subreddit?: string }
  ): Promise<{
    stocks: Array<{
      symbol: string;
      company?: string;
      sector?: string;
      sentiment: number;
      mentions: number;
      posts: number;
      confidence: number;
      trend: 'up' | 'down' | 'stable';
    }>;
    sectors: Array<{
      sector: string;
      sentiment: number;
      mentions: number;
      posts: number;
      topStocks: string[];
      confidence: number;
    }>;
  }> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const previousPeriodStart = new Date(Date.now() - hours * 2 * 60 * 60 * 1000);

    const currentWhere = this.buildDashboardPostWhere(since, filters);
    const previousWhere = this.buildDashboardPostWhere(previousPeriodStart, filters, since);

    const rowsCurrent = await db
      .select({
        detectedStocks: redditPosts.detectedStocks,
        detectedSectors: redditPosts.detectedSectors,
        sentimentScore: redditPosts.sentimentScore,
        confidenceScore: redditPosts.confidenceScore,
      })
      .from(redditPosts)
      .where(currentWhere);

    const rowsPrevious = await db
      .select({
        detectedStocks: redditPosts.detectedStocks,
        detectedSectors: redditPosts.detectedSectors,
        sentimentScore: redditPosts.sentimentScore,
        confidenceScore: redditPosts.confidenceScore,
      })
      .from(redditPosts)
      .where(previousWhere);

    type Agg = { totalS: number; n: number; totalC: number };
    const foldRows = (rows: typeof rowsCurrent) => {
      const stockMap = new Map<string, Agg>();
      const sectorMap = new Map<string, Agg>();

      for (const post of rows) {
        const sentiment = Number(post.sentimentScore) || 0;

        const stocks = this.normalizeDetectedStockSymbols(post.detectedStocks);
        const sectorNames = new Set<string>(this.normalizeDetectedSectorNames(post.detectedSectors));
        for (const sym of stocks) {
          const info = stockSectorDetectionService.getStockInfo(sym);
          if (info?.sector) sectorNames.add(info.sector);
        }

        const add = (m: Map<string, Agg>, key: string) => {
          const cur = m.get(key) ?? { totalS: 0, n: 0, totalC: 0 };
          cur.totalS += sentiment;
          cur.n += 1;
          const c = Number(post.confidenceScore);
          cur.totalC += Number.isFinite(c) ? c : 0.5;
          m.set(key, cur);
        };

        for (const sym of stocks) {
          add(stockMap, sym);
        }
        for (const sec of sectorNames) {
          add(sectorMap, sec);
        }
      }

      return { stockMap, sectorMap };
    };

    const cur = foldRows(rowsCurrent);
    const prev = foldRows(rowsPrevious);

    const stocks = [...cur.stockMap.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([symbol, agg]) => {
        const stockInfo = stockSectorDetectionService.getStockInfo(symbol);
        const avgS = agg.n > 0 ? agg.totalS / agg.n : 0;
        const prevAgg = prev.stockMap.get(symbol);
        const prevAvg = prevAgg && prevAgg.n > 0 ? prevAgg.totalS / prevAgg.n : undefined;
        let trend: 'up' | 'down' | 'stable' = 'stable';
        if (prevAvg !== undefined) {
          const delta = avgS - prevAvg;
          if (delta > 0.05) trend = 'up';
          else if (delta < -0.05) trend = 'down';
        }

        return {
          symbol,
          ...(stockInfo?.company ? { company: stockInfo.company } : {}),
          ...(stockInfo?.sector ? { sector: stockInfo.sector } : {}),
          sentiment: avgS,
          mentions: agg.n,
          posts: agg.n,
          confidence: agg.n > 0 ? agg.totalC / agg.n : 0,
          trend,
        };
      });

    const sectors = [...cur.sectorMap.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([sectorName, agg]) => {
        const avgS = agg.n > 0 ? agg.totalS / agg.n : 0;
        const relatedStocks = stocks
          .filter(s => s.sector?.toLowerCase() === sectorName.toLowerCase())
          .map(s => s.symbol);

        return {
          sector: sectorName,
          sentiment: avgS,
          mentions: agg.n,
          posts: agg.n,
          topStocks: relatedStocks.slice(0, 5),
          confidence: agg.n > 0 ? agg.totalC / agg.n : 0,
        };
      });

    return { stocks, sectors };
  }

  // Get sentiment analytics for posts
  async getSentimentAnalytics(
    hours: number = 24,
    filters?: { minScore: number; subreddit?: string }
  ): Promise<{
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
  }> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const postTimeFilter = filters
      ? and(this.buildDashboardPostWhere(since, filters), sql`${redditPosts.sentimentScore} IS NOT NULL`)
      : and(gte(redditPosts.fetchedAt, since), sql`${redditPosts.sentimentScore} IS NOT NULL`);

    // Get overview stats
    const overviewStats = await db.select({
      count: sql<number>`COUNT(*)`,
      avgSentiment: sql<number>`AVG(CAST(sentiment_score AS FLOAT))`,
      sentimentLabel: redditPosts.sentimentLabel
    })
      .from(redditPosts)
      .where(postTimeFilter)
      .groupBy(redditPosts.sentimentLabel);

    // Get top positive posts
    const topPositivePosts = await db.select({
      id: redditPosts.id,
      title: redditPosts.title,
      score: redditPosts.score,
      sentiment: redditPosts.sentimentScore,
      subreddit: redditPosts.subreddit
    })
      .from(redditPosts)
      .where(and(
        postTimeFilter,
        sql`CAST(${redditPosts.sentimentScore} AS FLOAT) > 0.3`
      ))
      .orderBy(desc(sql`CAST(${redditPosts.sentimentScore} AS FLOAT)`))
      .limit(10);

    // Get top negative posts
    const topNegativePosts = await db.select({
      id: redditPosts.id,
      title: redditPosts.title,
      score: redditPosts.score,
      sentiment: redditPosts.sentimentScore,
      subreddit: redditPosts.subreddit
    })
      .from(redditPosts)
      .where(and(
        postTimeFilter,
        sql`CAST(${redditPosts.sentimentScore} AS FLOAT) < -0.3`
      ))
      .orderBy(sql`CAST(${redditPosts.sentimentScore} AS FLOAT)`)
      .limit(10);

    // Get subreddit sentiment
    const subredditSentiment = await db.select({
      subreddit: redditPosts.subreddit,
      averageSentiment: sql<number>`AVG(CAST(${redditPosts.sentimentScore} AS FLOAT))`,
      postCount: sql<number>`COUNT(*)`
    })
      .from(redditPosts)
      .where(postTimeFilter)
      .groupBy(redditPosts.subreddit)
      .orderBy(desc(sql`COUNT(*)`));

    // Process overview stats
    const totalAnalyzed = overviewStats.reduce((sum, stat) => sum + Number(stat.count), 0);
    const weightedSentiment = totalAnalyzed > 0
      ? overviewStats.reduce((sum, stat) =>
          sum + (Number(stat.avgSentiment) || 0) * Number(stat.count), 0
        ) / totalAnalyzed
      : 0;

    const sentimentDistribution: Record<string, number> = {};
    overviewStats.forEach(stat => {
      sentimentDistribution[stat.sentimentLabel || 'unknown'] = Number(stat.count);
    });

    return {
      overview: {
        totalAnalyzed,
        averageSentiment: Number(weightedSentiment.toFixed(3)) || 0,
        sentimentDistribution
      },
      topPositivePosts: topPositivePosts.map(post => ({
        ...post,
        sentiment: parseFloat(post.sentiment?.toString() || '0')
      })),
      topNegativePosts: topNegativePosts.map(post => ({
        ...post,
        sentiment: parseFloat(post.sentiment?.toString() || '0')
      })),
      subredditSentiment: subredditSentiment.map(sub => ({
        subreddit: sub.subreddit,
        averageSentiment: Number(sub.averageSentiment) || 0,
        postCount: Number(sub.postCount)
      }))
    };
  }

  // Store sentiment scores for stocks and sectors
  async storeSentimentScores(sentiment: SentimentResult, source: string = 'reddit'): Promise<void> {
    if (!sentiment.stocks || sentiment.stocks.length === 0) {
      return; // No stocks detected, nothing to store
    }

    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Start of day

    try {
      for (const stock of sentiment.stocks) {
        // Store individual stock sentiment
        await this.upsertSentimentScore({
          symbol: stock.symbol,
          date,
          timeframe: 'daily',
          source,
          sentiment: sentiment.score,
          mentions: stock.mentions,
          confidence: stock.confidence * sentiment.confidence
        });

        // Store sector sentiment if available
        if (stock.sector && stock.sector !== 'ETF') {
          await this.upsertSentimentScore({
            symbol: stock.sector.toUpperCase().replace(/\s+/g, '_'),
            date,
            timeframe: 'daily',
            source: source + '_sector',
            sentiment: sentiment.score,
            mentions: stock.mentions,
            confidence: stock.confidence * sentiment.confidence
          });
        }
      }
    } catch (error) {
      console.error('Error storing sentiment scores:', error);
    }
  }

  // Upsert sentiment score (update if exists, insert if not)
  private async upsertSentimentScore(params: {
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

    // Atomic UPSERT to avoid unique-key races during high-throughput backfill.
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

  // Get sentiment analytics by stock/sector
  async getStockSectorSentiment(
    hours: number = 24,
    filters?: { minScore: number; subreddit?: string }
  ): Promise<{
    stocks: Array<{
      symbol: string;
      company?: string;
      sector?: string;
      sentiment: number;
      mentions: number;
      posts: number;
      confidence: number;
      trend: 'up' | 'down' | 'stable';
    }>;
    sectors: Array<{
      sector: string;
      sentiment: number;
      mentions: number;
      posts: number;
      topStocks: string[];
      confidence: number;
    }>;
  }> {
    if (filters) {
      return this.getStockSectorSentimentFromFilteredPosts(hours, filters);
    }

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const previousPeriodStart = new Date(Date.now() - hours * 2 * 60 * 60 * 1000);

    const redditStockSources = ['reddit', 'reddit_comments'] as const;

    const stockRows = await db.select({
      symbol: sentimentScores.symbol,
      sentiment: sentimentScores.averageSentiment,
      mentions: sentimentScores.totalMentions,
      confidence: sentimentScores.confidenceScore,
    })
      .from(sentimentScores)
      .where(and(
        gte(sentimentScores.updatedAt, since),
        inArray(sentimentScores.source, [...redditStockSources])
      ));

    const currentBySymbol = new Map<
      string,
      { sentiment: number; mentions: number; confidence: number }
    >();
    for (const row of stockRows) {
      const mentions = row.mentions || 0;
      const s = Number(row.sentiment) || 0;
      const c = Number(row.confidence) || 0;
      const ex = currentBySymbol.get(row.symbol);
      if (!ex) {
        currentBySymbol.set(row.symbol, { sentiment: s, mentions, confidence: c });
        continue;
      }
      const total = ex.mentions + mentions;
      const sentimentAvg =
        total > 0 ? (ex.sentiment * ex.mentions + s * mentions) / total : ex.sentiment;
      currentBySymbol.set(row.symbol, {
        sentiment: sentimentAvg,
        mentions: total,
        confidence: (ex.confidence + c) / 2,
      });
    }

    const previousStockRows = await db.select({
      symbol: sentimentScores.symbol,
      sentiment: sentimentScores.averageSentiment,
      mentions: sentimentScores.totalMentions,
    })
      .from(sentimentScores)
      .where(and(
        gte(sentimentScores.updatedAt, previousPeriodStart),
        sql`${sentimentScores.updatedAt} < ${since}`,
        inArray(sentimentScores.source, [...redditStockSources])
      ));

    const previousBySymbol = new Map<string, { sentiment: number; mentions: number }>();
    for (const row of previousStockRows) {
      const mentions = row.mentions || 0;
      const s = Number(row.sentiment) || 0;
      const ex = previousBySymbol.get(row.symbol);
      if (!ex) {
        previousBySymbol.set(row.symbol, { sentiment: s, mentions });
        continue;
      }
      const total = ex.mentions + mentions;
      const sentimentAvg =
        total > 0 ? (ex.sentiment * ex.mentions + s * mentions) / total : ex.sentiment;
      previousBySymbol.set(row.symbol, { sentiment: sentimentAvg, mentions: total });
    }

    const stocks = [...currentBySymbol.entries()]
      .sort((a, b) => b[1].mentions - a[1].mentions)
      .map(([symbol, agg]) => {
        const stockInfo = stockSectorDetectionService.getStockInfo(symbol);
        const previousSentiment = previousBySymbol.get(symbol)?.sentiment;
        let trend: 'up' | 'down' | 'stable' = 'stable';
        if (previousSentiment !== undefined) {
          const delta = agg.sentiment - previousSentiment;
          if (delta > 0.05) trend = 'up';
          else if (delta < -0.05) trend = 'down';
        }

        return {
          symbol,
          ...(stockInfo?.company ? { company: stockInfo.company } : {}),
          ...(stockInfo?.sector ? { sector: stockInfo.sector } : {}),
          sentiment: agg.sentiment,
          mentions: agg.mentions,
          posts: agg.mentions,
          confidence: agg.confidence,
          trend,
        };
      });

    const redditSectorSources = ['reddit_sector', 'reddit_comments_sector'] as const;

    // Get sector sentiments
    const sectorResults = await db.select({
      symbol: sentimentScores.symbol,
      sentiment: sentimentScores.averageSentiment,
      mentions: sentimentScores.totalMentions,
      confidence: sentimentScores.confidenceScore
    })
      .from(sentimentScores)
      .where(and(
        gte(sentimentScores.updatedAt, since),
        inArray(sentimentScores.source, [...redditSectorSources])
      ))
      .orderBy(desc(sentimentScores.totalMentions));

    const sectors = sectorResults.map(result => {
      const sectorName = result.symbol.replace(/_/g, ' ');
      const sectorKeyNorm = sectorName.toLowerCase();
      const relatedStocks = stocks
        .filter(s => (s.sector?.toLowerCase() === sectorKeyNorm))
        .map(s => s.symbol);

      return {
        sector: sectorName,
        sentiment: Number(result.sentiment) || 0,
        mentions: result.mentions || 0,
        posts: result.mentions || 0,
        topStocks: relatedStocks.slice(0, 5),
        confidence: Number(result.confidence) || 0
      };
    });

    return { stocks, sectors };
  }
  // Get historical sentiment time series for a stock (for charting)
  async getSentimentHistory(symbol: string, days: number = 30): Promise<Array<{
    date: string;
    sentiment: number;
    mentions: number;
    confidence: number;
    bullish: number;
    bearish: number;
    neutral: number;
  }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const results = await db.select({
      date: sentimentScores.date,
      sentiment: sentimentScores.averageSentiment,
      mentions: sentimentScores.totalMentions,
      confidence: sentimentScores.confidenceScore,
      bullish: sentimentScores.bullishCount,
      bearish: sentimentScores.bearishCount,
      neutral: sentimentScores.neutralCount,
    })
      .from(sentimentScores)
      .where(and(
        eq(sentimentScores.symbol, symbol),
        eq(sentimentScores.source, 'reddit'),
        gte(sentimentScores.date, since)
      ))
      .orderBy(sentimentScores.date);

    return results.map(r => ({
      date: r.date ? new Date(r.date).toISOString().split('T')[0]! : '',
      sentiment: Number(r.sentiment) || 0,
      mentions: r.mentions || 0,
      confidence: Number(r.confidence) || 0,
      bullish: r.bullish || 0,
      bearish: r.bearish || 0,
      neutral: r.neutral || 0,
    }));
  }

  // Start automated sentiment processing
  async startAutomatedProcessing(intervalMinutes: number = 15): Promise<void> {
    console.log(`🤖 Starting automated sentiment processing every ${intervalMinutes} minutes`);

    // Run immediately
    await this.processUnanalyzedPosts();
    await this.processUnanalyzedComments();

    // Set up interval
    setInterval(async () => {
      try {
        await this.processUnanalyzedPosts();
        await this.processUnanalyzedComments();
      } catch (error) {
        console.error('Error in automated sentiment processing:', error);
      }
    }, intervalMinutes * 60 * 1000);
  }
}

export const redditSentimentAnalyzer = new RedditSentimentAnalyzer();