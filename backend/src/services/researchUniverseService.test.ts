import { describe, expect, it, vi } from 'vitest';
import { ResearchUniverseService } from './researchUniverseService.js';

describe('ResearchUniverseService', () => {
  it('resolves point-in-time constituents and filters by minimum history', async () => {
    const service = new ResearchUniverseService();
    const internal = service as any;

    vi.spyOn(internal, 'getPointInTimeConstituents').mockResolvedValue([
      'AAPL',
      'MSFT',
      'NVDA',
    ]);
    vi.spyOn(internal, 'getPriceCoverage').mockResolvedValue(new Map([
      ['AAPL', { symbol: 'AAPL', firstDate: '2020-01-01', latestDate: '2023-01-03', tradingDays: 252 }],
      ['MSFT', { symbol: 'MSFT', firstDate: '2022-11-01', latestDate: '2023-01-03', tradingDays: 40 }],
      ['NVDA', { symbol: 'NVDA', firstDate: '2021-01-01', latestDate: '2023-01-03', tradingDays: 300 }],
    ]));

    const resolved = await service.resolveUniverse({
      methodology: 'point_in_time_index',
      indexCode: 'SP500',
      asOfDate: '2023-01-03',
      priceFilter: 'min_history',
      minHistoryTradingDays: 60,
    });

    expect(resolved.symbols).toEqual(['AAPL', 'NVDA']);
    expect(resolved.diagnostics.coverageStatus).toBe('point_in_time');
    expect(resolved.diagnostics.totalConstituents).toBe(3);
    expect(resolved.diagnostics.excludedForPriceData).toBe(1);
    expect(resolved.diagnostics.excludedSymbolsSample).toEqual(['MSFT']);
  });

  it('fails clearly when point-in-time membership data is missing', async () => {
    const service = new ResearchUniverseService();
    const internal = service as any;

    vi.spyOn(internal, 'getPointInTimeConstituents').mockResolvedValue([]);

    await expect(service.resolveUniverse({
      methodology: 'point_in_time_index',
      indexCode: 'SP500',
      asOfDate: '2023-01-03',
    })).rejects.toThrow('No point-in-time constituents found');
  });

  it('resolves all symbols that were members during a point-in-time date window', async () => {
    const service = new ResearchUniverseService();
    const internal = service as any;

    vi.spyOn(internal, 'getPointInTimeConstituentsInRange').mockResolvedValue([
      'AAPL',
      'MSFT',
      'GEHC',
    ]);

    const symbols = await service.resolveSymbolsInRange({
      methodology: 'point_in_time_index',
      indexCode: 'SP500',
      fromDate: '2021-01-01',
      toDate: '2023-12-31',
    });

    expect(symbols).toEqual(['AAPL', 'MSFT', 'GEHC']);
  });
});
