import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireAlphaVantageClient } from './integrationRouteHelpers.js';

const router = Router();
router.use(requireAuth);

// Get quote for a symbol
router.get('/quote/:symbol', async (req: Request, res: Response): Promise<void> => {
  const av = await requireAlphaVantageClient(req, res);
  if (!av) return;
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required' });
      return;
    }
    const quote = await av.getQuote(symbol);
    res.json(quote);
  } catch (error) {
    console.error('Error in /quote:', error);
    res.status(500).json({
      error: 'Failed to fetch quote',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get company overview
router.get('/overview/:symbol', async (req: Request, res: Response): Promise<void> => {
  const av = await requireAlphaVantageClient(req, res);
  if (!av) return;
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required' });
      return;
    }
    const overview = await av.getCompanyOverview(symbol);
    res.json(overview);
  } catch (error) {
    console.error('Error in /overview:', error);
    res.status(500).json({
      error: 'Failed to fetch company overview',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get time series data
router.get('/timeseries/:symbol', async (req: Request, res: Response): Promise<void> => {
  const av = await requireAlphaVantageClient(req, res);
  if (!av) return;
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required' });
      return;
    }
    const { interval = 'daily' } = req.query;
    const data = await av.getTimeSeries(symbol, interval as 'daily' | 'weekly' | 'monthly');
    res.json(data);
  } catch (error) {
    console.error('Error in /timeseries:', error);
    res.status(500).json({
      error: 'Failed to fetch time series',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Search symbols
router.get('/search', async (req: Request, res: Response): Promise<void> => {
  const av = await requireAlphaVantageClient(req, res);
  if (!av) return;
  try {
    const { keywords } = req.query;
    if (!keywords || typeof keywords !== 'string') {
      res.status(400).json({ error: 'Query parameter keywords is required' });
      return;
    }
    const results = await av.searchSymbols(keywords);
    res.json(results);
  } catch (error) {
    console.error('Error in /search:', error);
    res.status(500).json({
      error: 'Failed to search symbols',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get top gainers and losers
router.get('/movers', async (req: Request, res: Response) => {
  const av = await requireAlphaVantageClient(req, res);
  if (!av) return;
  try {
    const movers = await av.getTopGainersLosers();
    res.json(movers);
  } catch (error) {
    console.error('Error in /movers:', error);
    res.status(500).json({
      error: 'Failed to fetch market movers',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as alphaVantageRouter };
