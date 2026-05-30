import { Router, Request, Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { marketDataService } from '../services/marketDataService.js';
import { stockSearchService } from '../services/stockSearchService.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { db } from '../db/connection.js';
import { historicalPrices } from '../db/schema.js';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { BadRequestError, NotFoundError } from '../errors/AppError.js';
import { integrationUserId } from './integrationRouteHelpers.js';

const router = Router();
router.use(requireAuth);

// Stock symbol search (Finnhub / Alpha Vantage — requires API keys in .env)
router.get('/search/:query', async (req: Request, res: Response) => {
  try {
    const query = String(req.params.query ?? '').trim();
    const limit = Math.min(parseInt(String(req.query.limit), 10) || 20, 50);
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    const results = await stockSearchService.searchStocks(query, limit, integrationUserId(req));
    return res.json(results);
  } catch (error) {
    console.error('Error in /search:', error);
    return res.status(500).json({
      error: 'Failed to search stocks',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

router.get('/search', async (req: Request, res: Response) => {
  try {
    const query = String(req.query.q ?? '').trim();
    const limit = Math.min(parseInt(String(req.query.limit), 10) || 20, 50);
    if (!query) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }
    const results = await stockSearchService.searchStocks(query, limit, integrationUserId(req));
    return res.json(results);
  } catch (error) {
    console.error('Error in /search:', error);
    return res.status(500).json({
      error: 'Failed to search stocks',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Get market movers (top gainers, losers, active)
router.get('/movers', async (req: Request, res: Response) => {
  try {
    const movers = await marketDataService.getMarketMovers(integrationUserId(req));
    return res.json(movers);
  } catch (error) {
    console.error('Error in /movers:', error);
    return res.status(500).json({
      error: 'Failed to fetch market movers',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get market overview
router.get('/overview', async (req: Request, res: Response) => {
  try {
    const overview = await marketDataService.getMarketOverview(integrationUserId(req));
    return res.json(overview);
  } catch (error) {
    console.error('Error in /overview:', error);
    return res.status(500).json({
      error: 'Failed to fetch market overview',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get company information
router.get('/company/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    const info = await marketDataService.getCompanyInfo(symbol, integrationUserId(req));
    return res.json(info);
  } catch (error) {
    console.error('Error in /company:', error);
    return res.status(500).json({
      error: 'Failed to fetch company info',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get news (general or for specific symbol)
router.get('/news/:symbol?', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const news = await marketDataService.getNews(symbol, integrationUserId(req));
    return res.json(news);
  } catch (error) {
    console.error('Error in /news:', error);
    return res.status(500).json({
      error: 'Failed to fetch news',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get market status
router.get('/status', async (req: Request, res: Response) => {
  try {
    const status = await marketDataService.getMarketStatus(integrationUserId(req));
    return res.json(status);
  } catch (error) {
    console.error('Error in /status:', error);
    return res.status(500).json({
      error: 'Failed to fetch market status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Seeded historical prices (works without external API keys)
router.get(
  '/prices/:symbol',
  asyncHandler(async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol ?? '').toUpperCase();
    if (!symbol || symbol.length > 10) {
      throw new BadRequestError('Invalid symbol');
    }

    const rows = await db
      .select()
      .from(historicalPrices)
      .where(eq(historicalPrices.symbol, symbol))
      .orderBy(desc(historicalPrices.date))
      .limit(30);

    if (rows.length === 0) {
      throw new NotFoundError(`No price data for ${symbol}. Run db:seed or add historical_prices.`);
    }

    res.json({ symbol, prices: rows });
  })
);

// Get API usage stats
router.get('/usage', async (req: Request, res: Response) => {
  try {
    const stats = marketDataService.getUsageStats();
    return res.json(stats);
  } catch (error) {
    console.error('Error in /usage:', error);
    return res.status(500).json({
      error: 'Failed to fetch usage stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as marketRouter };