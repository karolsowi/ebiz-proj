import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrategyEngine } from './strategyEngine.js';
import { priceService } from './databaseService.js';
import { earningsEventService } from './earningsEventService.js';

function missingCoverage() {
  return {
    observed: false,
    observations: 0,
    coveragePct: 0,
    latestObservationDate: null,
  };
}

function stubNonCalendarSignals(engine: StrategyEngine) {
  vi.spyOn(priceService, 'getPriceHistory').mockResolvedValue([
    { close: '100' },
  ] as any);

  vi.spyOn(engine as any, 'gatherRedditSignals').mockResolvedValue({
    sentiment: 0,
    mentions: 0,
    trendScore: 0,
    coverage: missingCoverage(),
  });

  vi.spyOn(engine as any, 'gatherNewsSignals').mockResolvedValue({
    sentiment: 0,
    mentions: 0,
    coverage: missingCoverage(),
  });

  vi.spyOn(engine as any, 'gatherTASignals').mockResolvedValue({
    taScore: 0,
    taSignal: 'Neutral',
    taTrend: 0,
    taMomentum: 0,
    volumeAnalysis: 0,
    supportProximity: 0,
    patternScore: 0,
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 110,
    atr14: 2,
  });

  vi.spyOn(engine as any, 'gatherSectorSignals').mockResolvedValue({
    sentiment: 0,
    coverage: missingCoverage(),
  });
}

describe('StrategyEngine calendar catalyst fidelity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses persisted earnings events for calendar catalyst scoring', async () => {
    const engine = new StrategyEngine();
    stubNonCalendarSignals(engine);

    const getNextSpy = vi
      .spyOn(earningsEventService, 'getNextEarningsEvent')
      .mockResolvedValue({
        symbol: 'AAPL',
        eventDate: '2024-01-15',
        daysToEarnings: 5,
        source: 'finnhub_calendar',
      });
    const ensureSpy = vi
      .spyOn(earningsEventService, 'ensureRecentSymbolCoverage')
      .mockResolvedValue(false);

    const signals = await engine.gatherAllSignals(
      'AAPL',
      new Date('2024-01-10T00:00:00.000Z')
    );

    expect(signals).not.toBeNull();
    expect(signals?.daysToEarnings).toBe(5);
    expect(signals?.calendarCatalystScore).toBe(0.8);
    expect(signals?.coverage?.calendar_catalyst).toEqual({
      observed: true,
      observations: 1,
      coveragePct: 1,
      latestObservationDate: '2024-01-15',
    });
    expect(getNextSpy).toHaveBeenCalledTimes(1);
    expect(ensureSpy).not.toHaveBeenCalled();
  });

  it('hydrates recent earnings coverage before marking the catalyst signal missing', async () => {
    const engine = new StrategyEngine();
    stubNonCalendarSignals(engine);

    const getNextSpy = vi
      .spyOn(earningsEventService, 'getNextEarningsEvent')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const ensureSpy = vi
      .spyOn(earningsEventService, 'ensureRecentSymbolCoverage')
      .mockResolvedValue(true);

    const signals = await engine.gatherAllSignals(
      'MSFT',
      new Date('2024-01-10T00:00:00.000Z')
    );

    expect(signals).not.toBeNull();
    expect(signals?.daysToEarnings).toBeNull();
    expect(signals?.calendarCatalystScore).toBe(0);
    expect(signals?.coverage?.calendar_catalyst).toEqual({
      observed: false,
      observations: 0,
      coveragePct: 0,
      latestObservationDate: null,
    });
    expect(getNextSpy).toHaveBeenCalledTimes(2);
    expect(ensureSpy).toHaveBeenCalledWith(
      'MSFT',
      new Date('2024-01-10T00:00:00.000Z')
    );
  });
});
