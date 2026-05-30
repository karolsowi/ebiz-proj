import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireAlpacaClient } from './integrationRouteHelpers.js';

const router = Router();
router.use(requireAuth);

// Helper function to handle Alpaca API errors
const handleAlpacaError = (error: any, defaultValue: any) => {
  if (error.message?.includes('403') || error.message?.includes('forbidden')) {
    console.warn('Alpaca API authentication failed - returning empty data');
    return defaultValue;
  }
  throw error;
};

// Get account information
router.get('/account', async (req: Request, res: Response) => {
  const alpaca = await requireAlpacaClient(req, res);
  if (!alpaca) return;
  try {
    const account = await alpaca.getAccount();
    res.json(account);
  } catch (error) {
    console.error('Error in /account:', error);
    try {
      // Return null for account if auth fails instead of mock data
      const result = handleAlpacaError(error, null);
      res.json(result);
    } catch {
      res.status(500).json({
        error: 'Failed to fetch account information',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
});

// Get positions
router.get('/positions', async (req: Request, res: Response) => {
  const alpaca = await requireAlpacaClient(req, res);
  if (!alpaca) return;
  try {
    const positions = await alpaca.getPositions();
    res.json(positions);
  } catch (error) {
    console.error('Error in /positions:', error);
    try {
      // Return empty array for positions if auth fails instead of mock data
      const result = handleAlpacaError(error, []);
      res.json(result);
    } catch {
      res.status(500).json({
        error: 'Failed to fetch positions',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
});

// Get orders
router.get('/orders', async (req: Request, res: Response) => {
  const alpaca = await requireAlpacaClient(req, res);
  if (!alpaca) return;
  try {
    const { status, limit, after, until, direction, nested, symbols } = req.query;
    const params = {
      ...(status && { status: status as 'open' | 'closed' | 'all' }),
      ...(limit && { limit: parseInt(limit as string) }),
      ...(after && { after: after as string }),
      ...(until && { until: until as string }),
      ...(direction && { direction: direction as 'asc' | 'desc' }),
      ...(nested && { nested: nested === 'true' }),
      ...(symbols && { symbols: symbols as string })
    };
    const orders = await alpaca.getOrders(params);
    res.json(orders);
  } catch (error) {
    console.error('Error in /orders:', error);
    try {
      // Return empty array for orders if auth fails instead of mock data
      const result = handleAlpacaError(error, []);
      res.json(result);
    } catch {
      res.status(500).json({
        error: 'Failed to fetch orders',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
});

// Create order
router.post('/orders', async (req: Request, res: Response) => {
  const alpaca = await requireAlpacaClient(req, res);
  if (!alpaca) return;
  try {
    const orderRequest = req.body;
    const order = await alpaca.createOrder(orderRequest);
    res.json(order);
  } catch (error) {
    console.error('Error in /orders POST:', error);
    res.status(500).json({
      error: 'Failed to create order',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Cancel order
router.delete('/orders/:orderId', async (req: Request, res: Response) => {
  const alpaca = await requireAlpacaClient(req, res);
  if (!alpaca) return;
  try {
    const { orderId } = req.params;

    if (!orderId) {
      res.status(400).json({ error: 'Order ID is required' });
      return;
    }

    await alpaca.cancelOrder(orderId);
    res.json({ message: 'Order cancelled successfully' });
  } catch (error) {
    console.error('Error in /orders DELETE:', error);
    res.status(500).json({
      error: 'Failed to cancel order',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get portfolio history
router.get('/portfolio/history', async (req: Request, res: Response) => {
  const alpaca = await requireAlpacaClient(req, res);
  if (!alpaca) return;
  try {
    const { period, timeframe, end_date, extended_hours } = req.query;
    const params = {
      ...(period && { period: period as '1D' | '1W' | '1M' | '3M' | '1Y' | 'all' }),
      ...(timeframe && { timeframe: timeframe as '1Min' | '5Min' | '15Min' | '1H' | '1D' }),
      ...(end_date && { end_date: end_date as string }),
      ...(extended_hours && { extended_hours: extended_hours === 'true' })
    };
    const history = await alpaca.getPortfolioHistory(params);
    res.json(history);
  } catch (error) {
    console.error('Error in /portfolio/history:', error);
    res.status(500).json({
      error: 'Failed to fetch portfolio history',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get watchlists
router.get('/watchlists', async (req: Request, res: Response) => {
  const alpaca = await requireAlpacaClient(req, res);
  if (!alpaca) return;
  try {
    const watchlists = await alpaca.getWatchlists();
    res.json(watchlists);
  } catch (error) {
    console.error('Error in /watchlists:', error);
    res.status(500).json({
      error: 'Failed to fetch watchlists',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get assets
router.get('/assets', async (req: Request, res: Response) => {
  const alpaca = await requireAlpacaClient(req, res);
  if (!alpaca) return;
  try {
    const { status, asset_class, exchange } = req.query;
    const params = {
      ...(status && { status: status as 'active' | 'inactive' }),
      ...(asset_class && { asset_class: asset_class as string }),
      ...(exchange && { exchange: exchange as string })
    };
    const assets = await alpaca.getAssets(params);
    res.json(assets);
  } catch (error) {
    console.error('Error in /assets:', error);
    res.status(500).json({
      error: 'Failed to fetch assets',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as alpacaRouter };