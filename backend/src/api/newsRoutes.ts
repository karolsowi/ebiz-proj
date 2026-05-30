import { Router, type Request, type Response } from 'express';
import { newsSentimentAnalyzer } from '../services/newsSentimentAnalyzer.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { enhancedApiService } from '../services/enhancedApiService.js';
import { integrationUserId, requireNewsFetchCredentials } from './integrationRouteHelpers.js';

const router = Router();
router.use(requireAuth);

// Aggregated headlines (Finnhub + NewsData.io) using the caller's API keys
router.get('/articles', async (req: Request, res: Response) => {
  try {
    const symbolsRaw = req.query.symbols;
    const symbols =
      typeof symbolsRaw === 'string' && symbolsRaw.trim() !== ''
        ? symbolsRaw.split(',').map((s) => s.trim().toUpperCase())
        : [];

    const sourcesRaw = req.query.sources;
    const sources =
      typeof sourcesRaw === 'string' && sourcesRaw.trim() !== ''
        ? sourcesRaw.split(',').map((s) => s.trim())
        : ['finnhub', 'newsdata'];

    const limit = Math.min(parseInt(String(req.query.limit), 10) || 25, 50);
    const hours = parseInt(String(req.query.hours), 10) || 24;
    const category =
      typeof req.query.category === 'string' ? req.query.category : undefined;
    const preferCache = req.query.preferCache !== 'false';

    const articles = await enhancedApiService.getNews(
      {
        symbols,
        ...(category ? { category } : {}),
        limit,
        hours,
        sources: sources as any,
        preferCache,
      },
      integrationUserId(req)
    );

    return res.json({
      success: true,
      total: articles.length,
      data: articles,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in /articles:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch news articles',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Fetch fresh headlines from providers (requires caller's NewsData.io and/or Finnhub keys)
router.post('/refresh', async (req: Request, res: Response) => {
  if (!(await requireNewsFetchCredentials(req, res))) return;
  try {
    const symbolsRaw = req.body?.symbols;
    const symbols =
      Array.isArray(symbolsRaw)
        ? symbolsRaw.filter((s): s is string => typeof s === 'string').map((s) => s.toUpperCase())
        : typeof symbolsRaw === 'string' && symbolsRaw.trim() !== ''
          ? symbolsRaw.split(',').map((s) => s.trim().toUpperCase())
          : [];

    const limit = Math.min(parseInt(String(req.body?.limit), 10) || 25, 50);
    const hours = parseInt(String(req.body?.hours), 10) || 24;
    const category =
      typeof req.body?.category === 'string' ? req.body.category : undefined;

    const articles = await enhancedApiService.getNews(
      {
        symbols,
        ...(category ? { category } : {}),
        limit,
        hours,
        sources: ['finnhub', 'newsdata'],
        preferCache: false,
      },
      integrationUserId(req)
    );

    return res.json({
      success: true,
      total: articles.length,
      data: articles,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in /refresh:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh news',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Process unanalyzed news articles (stored DB only; no external news API)
router.post('/sentiment/analyze', async (req: Request, res: Response) => {
  try {
    const { batchSize = 50 } = req.body;

    const result = await newsSentimentAnalyzer.processUnanalyzedNews(batchSize);

    return res.json({
      success: true,
      data: result,
      message: `Processed ${result.processed} articles, ${result.stockSentimentsStored} stock sentiments stored`
    });
  } catch (error) {
    console.error('Error in /sentiment/analyze:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to analyze news sentiment',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Daily sentiment trend series (aggregated from stored analyzed articles; UTC days)
router.get('/sentiment/trends/daily', async (req: Request, res: Response) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days), 10) || 7));
    const categoryRaw = req.query.category;
    const category =
      typeof categoryRaw === 'string' && categoryRaw.trim() !== '' ? categoryRaw.trim() : undefined;

    const trends = await newsSentimentAnalyzer.getDailyNewsSentimentTrends(days, category);

    return res.json({
      success: true,
      data: trends
    });
  } catch (error) {
    console.error('Error in /sentiment/trends/daily:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get daily news sentiment trends',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get news sentiment analytics
router.get('/sentiment/analytics', async (req: Request, res: Response) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;

    const analytics = await newsSentimentAnalyzer.getNewsAnalytics(hours);

    return res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error in /sentiment/analytics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get news analytics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Analyze specific news text
router.post('/sentiment/text', async (req: Request, res: Response) => {
  try {
    const { title, summary, content } = req.body;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Title is required'
      });
    }

    const textToAnalyze = newsSentimentAnalyzer.buildSentimentInput(title, summary, content);
    const sentiment = await newsSentimentAnalyzer.analyzeSentiment(textToAnalyze, {
      title,
      summary,
      content,
    });

    return res.json({
      success: true,
      data: sentiment
    });
  } catch (error) {
    console.error('Error in /sentiment/text:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to analyze news text',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get sentiment by specific stock from news
router.get('/sentiment/stock/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: 'Symbol is required'
      });
    }

    const hours = parseInt(req.query.hours as string) || 24;

    const analytics = await newsSentimentAnalyzer.getNewsAnalytics(hours);
    const stockData = analytics.stockSentiments.find(s =>
      s.symbol && s.symbol.toUpperCase() === symbol.toUpperCase()
    );

    if (!stockData) {
      return res.status(404).json({
        success: false,
        error: 'Stock not found in recent news sentiment data'
      });
    }

    // Also get related news articles
    const relatedNews = analytics.recentNews.filter(news =>
      news.stocks && news.stocks.some(s => s && s.toUpperCase() === symbol.toUpperCase())
    );

    return res.json({
      success: true,
      data: {
        ...stockData,
        recentNews: relatedNews.slice(0, 10)
      }
    });
  } catch (error) {
    console.error('Error in /sentiment/stock:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get stock news sentiment',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as newsRouter };