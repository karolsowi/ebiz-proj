import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireFinnhubClient } from './integrationRouteHelpers.js';

const router = Router();
router.use(requireAuth);

// Get quote for a symbol
router.get('/quote/:symbol', async (req: Request, res: Response) => {
  const finnhub = await requireFinnhubClient(req, res);
  if (!finnhub) return;
  try {
    const { symbol } = req.params;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    const quote = await finnhub.getQuote(symbol);
    return res.json(quote);
  } catch (error) {
    console.error('Error in /quote:', error);
    return res.status(500).json({
      error: 'Failed to fetch quote',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get company profile
router.get('/company/:symbol', async (req: Request, res: Response) => {
  const finnhub = await requireFinnhubClient(req, res);
  if (!finnhub) return;
  try {
    const { symbol } = req.params;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    const profile = await finnhub.getCompanyProfile(symbol);
    return res.json(profile);
  } catch (error) {
    console.error('Error in /company:', error);
    return res.status(500).json({
      error: 'Failed to fetch company profile',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get company news for specific symbol
router.get('/news/:symbol', async (req: Request, res: Response) => {
  const finnhub = await requireFinnhubClient(req, res);
  if (!finnhub) return;
  try {
    const { symbol } = req.params;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    const { from, to } = req.query;
    const news = await finnhub.getCompanyNews(symbol, from as string, to as string);
    return res.json(news);
  } catch (error) {
    console.error('Error in /news:', error);
    return res.status(500).json({
      error: 'Failed to fetch company news',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get general news
router.get('/news', async (req: Request, res: Response) => {
  const finnhub = await requireFinnhubClient(req, res);
  if (!finnhub) return;
  try {
    const { category = 'general' } = req.query;
    const news = await finnhub.getGeneralNews(category as string);
    return res.json(news);
  } catch (error) {
    console.error('Error in /news:', error);
    return res.status(500).json({
      error: 'Failed to fetch general news',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Search symbols
router.get('/search', async (req: Request, res: Response) => {
  const finnhub = await requireFinnhubClient(req, res);
  if (!finnhub) return;
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }
    const results = await finnhub.searchSymbols(q);
    return res.json(results);
  } catch (error) {
    console.error('Error in /search:', error);
    return res.status(500).json({
      error: 'Failed to search symbols',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get basic financials
router.get('/financials/:symbol', async (req: Request, res: Response) => {
  const finnhub = await requireFinnhubClient(req, res);
  if (!finnhub) return;
  try {
    const { symbol } = req.params;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    const financials = await finnhub.getBasicFinancials(symbol);
    return res.json(financials);
  } catch (error) {
    console.error('Error in /financials:', error);
    return res.status(500).json({
      error: 'Failed to fetch basic financials',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get recommendation trends
router.get('/recommendations/:symbol', async (req: Request, res: Response) => {
  const finnhub = await requireFinnhubClient(req, res);
  if (!finnhub) return;
  try {
    const { symbol } = req.params;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    const recommendations = await finnhub.getRecommendationTrends(symbol);
    return res.json(recommendations);
  } catch (error) {
    console.error('Error in /recommendations:', error);
    return res.status(500).json({
      error: 'Failed to fetch recommendation trends',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get earnings
router.get('/earnings/:symbol', async (req: Request, res: Response) => {
  const finnhub = await requireFinnhubClient(req, res);
  if (!finnhub) return;
  try {
    const { symbol } = req.params;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    const earnings = await finnhub.getEarnings(symbol);
    return res.json(earnings);
  } catch (error) {
    console.error('Error in /earnings:', error);
    return res.status(500).json({
      error: 'Failed to fetch earnings',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as finnhubRouter };
