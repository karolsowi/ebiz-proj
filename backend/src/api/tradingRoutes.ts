import { Router, Request, Response } from 'express';
import { tradingService, TradeOrder, TradeHistoryFilter } from '../services/tradingService';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();
router.use(requireAuth);

function uid(req: Request): string {
  return req.user!.userId;
}

// Initialize trading account
router.post('/initialize', async (req: Request, res: Response) => {
  try {
    await tradingService.initializeAccount(uid(req));
    res.json({ message: 'Trading account initialized successfully' });
  } catch (error) {
    console.error('Error initializing trading account:', error);
    const err = error as Error & { status?: number; code?: string; service?: string };
    if (err.status === 400 && err.code === 'INTEGRATION_KEYS_MISSING') {
      res.status(400).json({
        error: err.message,
        message: err.message,
        code: err.code,
        service: err.service ?? 'alpaca',
      });
      return;
    }
    res.status(500).json({ error: 'Failed to initialize trading account' });
  }
});

// Get account info
router.get('/account', async (req: Request, res: Response) => {
  try {
    const accountInfo = await tradingService.getAccountInfo(uid(req));
    res.json(accountInfo);
  } catch (error) {
    console.error('Error fetching account info:', error);
    const err = error as Error & { status?: number; code?: string; service?: string };
    if (err.status === 400 && err.code === 'INTEGRATION_KEYS_MISSING') {
      res.status(400).json({
        error: err.message,
        message: err.message,
        code: err.code,
        service: err.service ?? 'alpaca',
      });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch account info' });
  }
});

// Sync account data with broker
router.post('/sync', async (req: Request, res: Response) => {
  try {
    await tradingService.syncAccountData(uid(req));
    await tradingService.syncOrders(uid(req));
    await tradingService.syncExecutions(uid(req));
    res.json({ message: 'Account data, orders, and executions synced successfully' });
  } catch (error) {
    console.error('Error syncing account data:', error);
    res.status(500).json({ error: 'Failed to sync account data' });
  }
});

// Sync orders with broker
router.post('/sync-orders', async (req: Request, res: Response) => {
  try {
    const limit = req.body.limit ? parseInt(req.body.limit as string) : 500;
    await tradingService.syncOrders(uid(req), limit);
    res.json({ message: 'Order synchronization complete' });
  } catch (error) {
    console.error('Error syncing orders:', error);
    res.status(500).json({ error: 'Failed to sync orders' });
  }
});

// Place a trade order
router.post('/orders', async (req: Request, res: Response): Promise<void> => {
  try {
    const orderData: TradeOrder = req.body;

    // Validate required fields
    if (!orderData.symbol || !orderData.side || !orderData.type || !orderData.qty) {
      res.status(400).json({
        error: 'Missing required fields: symbol, side, type, qty'
      });
      return;
    }

    const result = await tradingService.placeOrder(uid(req), orderData);
    res.json({
      ...result,
      message: 'Order placed successfully',
      paperTrading: true, // Always true for now
    });
  } catch (error) {
    console.error('Error placing order:', error);
    if (tradingService.isRiskViolationError(error)) {
      res.status(400).json({
        error: 'Order rejected by risk controls',
        code: 'RISK_RULE_VIOLATION',
        violations: error.violations,
      });
      return;
    }
    res.status(500).json({
      error: 'Failed to place order',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/risk-settings', async (req: Request, res: Response) => {
  try {
    const settings = await tradingService.getRiskSettings(uid(req));
    res.json(settings);
  } catch (error) {
    console.error('Error fetching risk settings:', error);
    res.status(500).json({ error: 'Failed to fetch risk settings' });
  }
});

router.put('/risk-settings', async (req: Request, res: Response) => {
  try {
    const { maxPositionSizePercent, dailyLossLimit, perTradeRiskPercent } = req.body || {};
    const parseNum = (value: unknown) => (value === undefined ? undefined : Number(value));
    const maxPositionSize = parseNum(maxPositionSizePercent);
    const dailyLoss = parseNum(dailyLossLimit);
    const perTradeRisk = parseNum(perTradeRiskPercent);

    const isInvalid =
      (maxPositionSize !== undefined && (!Number.isFinite(maxPositionSize) || maxPositionSize <= 0 || maxPositionSize > 100)) ||
      (dailyLoss !== undefined && (!Number.isFinite(dailyLoss) || dailyLoss <= 0)) ||
      (perTradeRisk !== undefined && (!Number.isFinite(perTradeRisk) || perTradeRisk <= 0 || perTradeRisk > 50));

    if (isInvalid) {
      res.status(400).json({
        error: 'Invalid risk settings. Expected: maxPositionSizePercent (0-100], dailyLossLimit (>0), perTradeRiskPercent (0-50].',
      });
      return;
    }

    const updated = await tradingService.updateRiskSettings(uid(req), {
      ...(maxPositionSize !== undefined ? { maxPositionSizePercent: maxPositionSize } : {}),
      ...(dailyLoss !== undefined ? { dailyLossLimit: dailyLoss } : {}),
      ...(perTradeRisk !== undefined ? { perTradeRiskPercent: perTradeRisk } : {}),
    });
    res.json(updated);
  } catch (error) {
    console.error('Error updating risk settings:', error);
    res.status(500).json({ error: 'Failed to update risk settings' });
  }
});

// Cancel an order
router.delete('/orders/:orderId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'Missing orderId' });
      return;
    }
    await tradingService.cancelOrder(uid(req), orderId);
    res.json({ message: 'Order canceled successfully' });
  } catch (error) {
    console.error('Error canceling order:', error);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

// Get trade history
router.get('/history', async (req: Request, res: Response) => {
  try {
    const filter: TradeHistoryFilter = {};
    if (req.query.startDate) filter.startDate = new Date(req.query.startDate as string);
    if (req.query.endDate) filter.endDate = new Date(req.query.endDate as string);
    if (typeof req.query.symbol === 'string') filter.symbol = req.query.symbol;
    if (req.query.side === 'buy' || req.query.side === 'sell') filter.side = req.query.side;
    if (typeof req.query.status === 'string') filter.status = req.query.status;
    if (req.query.limit) filter.limit = parseInt(req.query.limit as string);
    if (req.query.page) filter.page = parseInt(req.query.page as string);
    if (req.query.offset) filter.offset = parseInt(req.query.offset as string);

    // Optional: Trigger a sync if requested
    if (req.query.sync === 'true') {
      await tradingService.syncOrders(uid(req));
    }

    const result = await tradingService.getTradeHistory(uid(req), filter);
    res.json({
      ...result,
      paperTrading: true,
    });
  } catch (error) {
    console.error('Error fetching trade history:', error);
    res.status(500).json({ error: 'Failed to fetch trade history' });
  }
});

// Get trading statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const period = req.query.period ? {
      startDate: new Date(req.query.startDate as string),
      endDate: new Date(req.query.endDate as string),
    } : undefined;

    const stats = await tradingService.getTradingStats(uid(req), period);
    res.json({
      ...stats,
      paperTrading: true,
    });
  } catch (error) {
    console.error('Error fetching trading stats:', error);
    res.status(500).json({ error: 'Failed to fetch trading stats' });
  }
});

// Get current positions
router.get('/positions', async (req: Request, res: Response) => {
  try {
    const positions = await tradingService.getPositions(uid(req));
    res.json({
      positions,
      count: positions.length,
      paperTrading: true,
    });
  } catch (error) {
    console.error('Error fetching positions:', error);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

// Close position
router.post('/positions/:symbol/close', async (req: Request, res: Response): Promise<void> => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Missing symbol parameter' });
      return;
    }
    const result = await tradingService.closePosition(uid(req), symbol);
    res.json({
      ...result,
      message: `Position for ${symbol} closed successfully`,
      paperTrading: true,
    });
  } catch (error) {
    console.error('Error closing position:', error);
    res.status(500).json({
      error: 'Failed to close position',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Check if using paper trading
router.get('/environment', async (req: Request, res: Response) => {
  try {
    const isPaper = tradingService.isPaperTrading();
    const accountInfo = await tradingService.getAccountInfo(uid(req));

    res.json({
      isPaperTrading: isPaper,
      environment: isPaper ? 'paper' : 'live',
      accountType: accountInfo.accountType,
      provider: accountInfo.provider,
      warning: isPaper ? 'You are using paper trading - no real money is involved' : 'Live trading - real money is at risk',
    });
  } catch (error) {
    console.error('Error checking trading environment:', error);
    res.status(500).json({ error: 'Failed to check trading environment' });
  }
});

// Get trade executions
router.get('/executions', async (req: Request, res: Response) => {
  try {
    const filter: TradeHistoryFilter = {
      limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };
    if (req.query.startDate) filter.startDate = new Date(req.query.startDate as string);
    if (req.query.endDate) filter.endDate = new Date(req.query.endDate as string);
    if (req.query.symbol) filter.symbol = req.query.symbol as string;

    const executions = await tradingService.getTradeExecutions(uid(req), filter);
    res.json(executions);
  } catch (error) {
    console.error('Error fetching trade executions:', error);
    res.status(500).json({ error: 'Failed to fetch trade executions' });
  }
});

// Get trading sessions
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const filter: TradeHistoryFilter = {
      limit: req.query.limit ? parseInt(req.query.limit as string) : 30,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };
    if (req.query.startDate) filter.startDate = new Date(req.query.startDate as string);
    if (req.query.endDate) filter.endDate = new Date(req.query.endDate as string);

    const sessions = await tradingService.getTradingSessions(uid(req), filter);
    res.json(sessions);
  } catch (error) {
    console.error('Error fetching trading sessions:', error);
    res.status(500).json({ error: 'Failed to fetch trading sessions' });
  }
});

// Get orders with additional details
router.get('/orders', async (req: Request, res: Response) => {
  try {
    const filter: TradeHistoryFilter = {
      limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };
    if (req.query.startDate) filter.startDate = new Date(req.query.startDate as string);
    if (req.query.endDate) filter.endDate = new Date(req.query.endDate as string);
    if (req.query.symbol) filter.symbol = req.query.symbol as string;
    if (req.query.status) filter.status = req.query.status as string;
    if (req.query.side) filter.side = req.query.side as 'buy' | 'sell';

    const orders = await tradingService.getOrders(uid(req), filter);
    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Health check for trading service
router.get('/health', async (req: Request, res: Response) => {
  try {
    const accountInfo = await tradingService.getAccountInfo(uid(req));
    res.json({
      status: 'healthy',
      service: 'trading',
      paperTrading: accountInfo.accountType === 'paper',
      provider: accountInfo.provider,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Trading service health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      service: 'trading',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;