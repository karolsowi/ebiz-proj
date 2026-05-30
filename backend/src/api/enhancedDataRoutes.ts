import express, { Request, Response } from 'express';
import { enhancedApiService } from '../services/enhancedApiService.js';
import { dataStorageService } from '../services/dataStorageService.js';
import { schedulerService } from '../services/schedulerService.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(requireAuth);

function uid(req: Request): string {
  return req.user!.userId;
}

// Get quote with intelligent caching
router.get('/quote/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const { source = 'auto', maxAge = '1', preferCache = 'true' } = req.query;

    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ error: 'Valid symbol is required' });
    }

    const quote = await enhancedApiService.getQuote({
      symbol: symbol.toUpperCase(),
      source: source as any,
      maxAge: parseInt(maxAge as string),
      preferCache: preferCache === 'true'
    });

    return res.json({
      success: true,
      data: quote,
      cached: quote.cached || false,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching quote:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get multiple quotes efficiently
router.post('/quotes', async (req: Request, res: Response) => {
  try {
    const { symbols = [], source = 'auto', preferCache = true } = req.body;

    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: 'Array of symbols is required' });
    }

    if (symbols.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 symbols allowed per request' });
    }

    const quotes = await Promise.allSettled(
      symbols.map(symbol =>
        enhancedApiService.getQuote({
          symbol: symbol.toUpperCase(),
          source,
          preferCache
        })
      )
    );

    const results = quotes.map((result, index) => ({
      symbol: symbols[index].toUpperCase(),
      success: result.status === 'fulfilled',
      data: result.status === 'fulfilled' ? (result as PromiseFulfilledResult<any>).value : null,
      error: result.status === 'rejected' ? (result as PromiseRejectedResult).reason.message : null
    }));

    const successful = results.filter(r => r.success).length;

    return res.json({
      success: true,
      total: symbols.length,
      successful,
      failed: symbols.length - successful,
      results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching multiple quotes:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ==================== HISTORICAL DATA ENDPOINTS ====================

// Get historical data with caching
router.get('/historical/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const {
      interval = 'daily',
      startDate,
      endDate,
      source = 'auto',
      preferCache = 'true'
    } = req.query;

    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ error: 'Valid symbol is required' });
    }

    const request: any = {
      symbol: symbol.toUpperCase(),
      interval,
      source,
      preferCache: preferCache === 'true'
    };

    if (startDate && typeof startDate === 'string') {
      request.startDate = new Date(startDate);
    }
    if (endDate && typeof endDate === 'string') {
      request.endDate = new Date(endDate);
    }

    const historicalData = await enhancedApiService.getHistoricalData(request);

    return res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      interval,
      dataPoints: historicalData.length,
      data: historicalData,
      dateRange: historicalData.length > 0 ? {
        start: historicalData[historicalData.length - 1]?.date,
        end: historicalData[0]?.date
      } : null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching historical data:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ==================== NEWS ENDPOINTS ====================

// Get aggregated news with caching
router.get('/news', async (req: Request, res: Response) => {
  try {
    const {
      symbols,
      category,
      limit = '25',
      hours = '24',
      sources = 'finnhub,alphavantage',
      preferCache = 'true'
    } = req.query;

    const symbolsArray = symbols ?
      (typeof symbols === 'string' ? symbols.split(',').map(s => s.trim().toUpperCase()) : [])
      : [];

    const sourcesArray = typeof sources === 'string' ? sources.split(',') : ['finnhub'];

    const news = await enhancedApiService.getNews(
      {
        symbols: symbolsArray,
        category: category as string,
        limit: parseInt(limit as string),
        hours: parseInt(hours as string),
        sources: sourcesArray as any,
        preferCache: preferCache === 'true',
      },
      uid(req)
    );

    return res.json({
      success: true,
      total: news.length,
      filters: {
        symbols: symbolsArray,
        category,
        hours: parseInt(hours as string),
        sources: sourcesArray
      },
      data: news,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching news:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ==================== SENTIMENT ENDPOINTS ====================

// Get Reddit sentiment analysis
router.get('/sentiment/reddit', async (req: Request, res: Response) => {
  try {
    const { symbols, hours = '24' } = req.query;

    const symbolsArray = symbols ?
      (typeof symbols === 'string' ? symbols.split(',').map(s => s.trim().toUpperCase()) : [])
      : ['SPY', 'QQQ', 'AAPL', 'MSFT', 'GOOGL'];

    const sentiment = await enhancedApiService.getRedditSentiment(
      symbolsArray,
      parseInt(hours as string)
    );

    return res.json({
      success: true,
      symbols: symbolsArray,
      hoursAnalyzed: parseInt(hours as string),
      data: sentiment,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching Reddit sentiment:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ==================== TRADING DATA ENDPOINTS ====================

// Sync and get trading data
router.get('/trading/sync', async (req: Request, res: Response) => {
  try {
    const tradingData = await enhancedApiService.syncTradingData(uid(req));

    return res.json({
      success: true,
      data: tradingData,
      cached: tradingData.cached || false,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error syncing trading data:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ==================== BULK OPERATIONS ====================

// Refresh all portfolio data
router.post('/portfolio/refresh', async (req: Request, res: Response) => {
  try {
    const { symbols = [] } = req.body;

    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: 'Array of symbols is required' });
    }

    if (symbols.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 symbols allowed for bulk refresh' });
    }

    console.log(`Starting bulk refresh for ${symbols.length} symbols`);
    const results = await enhancedApiService.refreshAllPortfolioData(
      symbols.map((s: string) => s.toUpperCase())
    );

    return res.json({
      success: true,
      total: symbols.length,
      successful: results.success,
      failed: results.failed,
      errors: results.errors,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error refreshing portfolio data:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ==================== SYSTEM STATUS ENDPOINTS ====================

// Get service status and statistics
router.get('/status', async (req: Request, res: Response) => {
  try {
    const status = await enhancedApiService.getServiceStatus();

    return res.json({
      success: true,
      status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting service status:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Perform system maintenance
router.post('/maintenance', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const maintenanceResults = await enhancedApiService.performMaintenance();

    return res.json({
      success: true,
      results: maintenanceResults,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error performing maintenance:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ==================== DATA VALIDATION ENDPOINTS ====================

// Validate stored data integrity
router.get('/validate', async (req: Request, res: Response) => {
  try {
    const validation = await dataStorageService.validateStoredData();

    return res.json({
      success: true,
      validation,
      recommendations: {
        missingPrices: validation.missingPrices.length > 0 ?
          `Consider refreshing data for ${validation.missingPrices.length} symbols` :
          'All portfolio symbols have recent price data',
        cacheHealth: validation.cacheHitRatio > 0.5 ?
          'Cache is performing well' :
          'Cache hit ratio is low, consider adjusting TTL values',
        dataAge: validation.newestData ?
          `Latest data is from ${validation.newestData.toISOString().split('T')[0]}` :
          'No historical data found'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error validating data:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Clear expired cache manually
router.delete('/cache/expired', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const cleared = await dataStorageService.clearExpiredCache();

    return res.json({
      success: true,
      cleared,
      message: `Cleared ${cleared} expired cache entries`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ==================== ANALYTICS ENDPOINTS ====================

// Get data usage analytics
router.get('/analytics/usage', async (req: Request, res: Response) => {
  try {
    const { hours = '24' } = req.query;
    const hoursNum = parseInt(hours as string);

    // This could be expanded with more detailed analytics
    const stats = await dataStorageService.getStorageStats();
    const validation = await dataStorageService.validateStoredData();

    return res.json({
      success: true,
      period: `${hoursNum} hours`,
      storage: stats,
      cache: {
        hitRatio: validation.cacheHitRatio,
        totalEntries: stats.cachedResponses
      },
      dataQuality: {
        totalRecords: validation.totalRecords,
        missingData: validation.missingPrices.length,
        coverage: validation.missingPrices.length === 0 ? '100%' :
          `${((1 - validation.missingPrices.length / 100) * 100).toFixed(1)}%`
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting usage analytics:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ==================== SCHEDULER CONTROL ENDPOINTS ====================

// Get scheduler status
router.get('/scheduler/status', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const status = schedulerService.getStatus();
    const healthCheck = await schedulerService.healthCheck();

    return res.json({
      success: true,
      scheduler: status,
      health: healthCheck,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting scheduler status:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Manually trigger market data update
router.post('/scheduler/trigger/market', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    await schedulerService.triggerMarketDataUpdate();

    return res.json({
      success: true,
      message: 'Market data update triggered successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error triggering market data update:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Manually trigger news update
router.post('/scheduler/trigger/news', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    await schedulerService.triggerNewsUpdate();

    return res.json({
      success: true,
      message: 'News update triggered successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error triggering news update:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Manually trigger sentiment update
router.post('/scheduler/trigger/sentiment', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    await schedulerService.triggerSentimentUpdate();

    return res.json({
      success: true,
      message: 'Sentiment update triggered successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error triggering sentiment update:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Manually trigger full refresh
router.post('/scheduler/trigger/full', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    await schedulerService.triggerFullRefresh();

    return res.json({
      success: true,
      message: 'Full data refresh triggered successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error triggering full refresh:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Manually trigger maintenance
router.post('/scheduler/trigger/maintenance', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    await schedulerService.triggerMaintenance();

    return res.json({
      success: true,
      message: 'Maintenance triggered successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error triggering maintenance:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;