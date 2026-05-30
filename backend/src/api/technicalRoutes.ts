import { Router } from 'express';
import { technicalAnalysisService } from '../services/technicalAnalysisService.js';
import { priceService } from '../services/databaseService.js';
import { stooqService } from '../services/stooqService.js';
import { logger } from '../services/logger.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();
router.use(requireAuth);

async function ensureDailyHistoryForSymbol(sym: string): Promise<void> {
  let rows = await priceService.getPriceHistory(sym, undefined, undefined, 'daily');
  if (rows.length >= 50) return;

  try {
    await stooqService.downloadAndStoreIncremental(sym);
    rows = await priceService.getPriceHistory(sym, undefined, undefined, 'daily');
    if (rows.length >= 50) return;
    await stooqService.downloadAndStoreHistoricalData(sym);
  } catch (err) {
    logger.warn({ err, sym }, 'technical: Stooq backfill failed');
  }
}

/**
 * GET /api/technical/:symbol/chart
 * OHLCV + indicator arrays for charts (register before /:symbol)
 */
router.get('/:symbol/chart', async (req, res) => {
  try {
    const symbol = req.params['symbol'];
    const timeframe = (req.query['timeframe'] as string) || 'daily';
    const days = parseInt(req.query['days'] as string || '100', 10);
    const startDateParam = req.query['startDate'] as string;
    const endDateParam = req.query['endDate'] as string;
    const limit = parseInt(req.query['limit'] as string || '500', 10);

    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }

    const startDate = startDateParam ? new Date(startDateParam) : undefined;
    const endDate = endDateParam ? new Date(endDateParam) : undefined;

    const sym = symbol.toUpperCase();

    let history = await priceService.getPriceHistory(sym, startDate, endDate, timeframe);

    if (history.length === 0) {
      try {
        await stooqService.downloadAndStoreIncremental(sym);
        history = await priceService.getPriceHistory(sym, startDate, endDate, timeframe);
        if (history.length === 0) {
          await stooqService.downloadAndStoreHistoricalData(sym);
          history = await priceService.getPriceHistory(sym, startDate, endDate, timeframe);
        }
      } catch (err) {
        logger.warn({ err, sym }, 'technical chart: Stooq backfill failed');
      }
    }

    // newest-first → chronological oldest → newest
    let chronological = [...history].reverse();
    const cap =
      limit > 0 ? Math.min(Math.max(limit, 1), 5000) : Math.min(Math.max(days, 1), 5000);
    if (chronological.length > cap) {
      chronological = chronological.slice(-cap);
    }
    const chartData = chronological;

    const indicatorsData = await technicalAnalysisService.getChartIndicators(sym, timeframe);

    let indicators = null;
    if (indicatorsData) {
      const dataLength = chartData.length;
      const indicatorLen = indicatorsData.sma20.length;
      const sliceStart = Math.max(0, indicatorLen - dataLength);

      indicators = {
        sma20: indicatorsData.sma20.slice(sliceStart),
        sma50: indicatorsData.sma50.slice(sliceStart),
        ema20: indicatorsData.ema20.slice(sliceStart),
        obv: indicatorsData.obv.slice(sliceStart),
        bbUpper: indicatorsData.bbUpper.slice(sliceStart),
        bbLower: indicatorsData.bbLower.slice(sliceStart),
        vwap: indicatorsData.vwap.slice(sliceStart),
        supportResistanceLevels: indicatorsData.supportResistanceLevels,
        detectedPatterns: indicatorsData.detectedPatterns
      };
    }

    return res.json({ data: chartData, indicators });
  } catch (error) {
    console.error(`Error fetching chart data for ${req.params['symbol']}:`, error);
    return res.status(500).json({ error: 'Failed to fetch chart data' });
  }
});

/**
 * GET /api/technical/:symbol
 * Technical analysis indicators
 */
router.get('/:symbol', async (req, res) => {
  try {
    const symbol = req.params['symbol'];
    const timeframe = (req.query['timeframe'] as string) || 'daily';
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }

    const sym = symbol.toUpperCase();
    if (timeframe === 'daily') {
      await ensureDailyHistoryForSymbol(sym);
    }

    const analysis = await technicalAnalysisService.analyzeSymbol(symbol, timeframe);

    if (!analysis) {
      return res.status(404).json({ error: `Not enough historical data available to perform Technical Analysis for ${symbol}` });
    }

    return res.json(analysis);
  } catch (error) {
    console.error(`Error performing technical analysis for ${req.params['symbol']}:`, error);
    return res.status(500).json({ error: 'Failed to perform technical analysis' });
  }
});

export default router;
