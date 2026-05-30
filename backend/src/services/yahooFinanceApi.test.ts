import { beforeEach, describe, expect, it, vi } from 'vitest';

const { quoteSummaryMock } = vi.hoisted(() => ({
  quoteSummaryMock: vi.fn(),
}));

vi.mock('yahoo-finance2', () => ({
  default: class MockYahooFinance {
    quoteSummary = quoteSummaryMock;
  },
}));

import { yahooFinanceAPI } from './yahooFinanceApi.js';

describe('yahooFinanceAPI.getNextEarningsCalendar', () => {
  beforeEach(() => {
    quoteSummaryMock.mockReset();
  });

  it('normalizes the earliest Yahoo earnings date and estimates', async () => {
    quoteSummaryMock.mockResolvedValue({
      calendarEvents: {
        earnings: {
          earningsDate: [
            new Date('2026-07-31T20:00:00.000Z'),
            '2026-07-30T20:00:00.000Z',
          ],
          earningsAverage: '1.89077',
          revenueAverage: '108790845560',
          isEarningsDateEstimate: true,
        },
      },
    });

    const result = await yahooFinanceAPI.getNextEarningsCalendar('aapl');

    expect(quoteSummaryMock).toHaveBeenCalledWith('AAPL', {
      modules: ['calendarEvents'],
    });
    expect(result).toEqual({
      symbol: 'AAPL',
      date: '2026-07-30',
      epsEstimate: 1.89077,
      revenueEstimate: 108790845560,
      isDateEstimate: true,
    });
  });

  it('returns null when Yahoo does not expose a usable earnings date', async () => {
    quoteSummaryMock.mockResolvedValue({
      calendarEvents: {
        earnings: {
          earningsDate: ['not-a-date', null],
        },
      },
    });

    await expect(
      yahooFinanceAPI.getNextEarningsCalendar('msft')
    ).resolves.toBeNull();
  });
});

describe('yahooFinanceAPI.getEarningsBackfillRows', () => {
  beforeEach(() => {
    quoteSummaryMock.mockReset();
  });

  it('maps reportedDate and fiscal quarter rows inside the window', async () => {
    quoteSummaryMock.mockResolvedValue({
      earnings: {
        earningsChart: {
          quarterly: [
            {
              actual: 1.0,
              estimate: 0.9,
              periodEndDate: 1_704_067_200,
              reportedDate: 1_704_326_400,
            },
          ],
        },
      },
      earningsHistory: {
        history: [
          {
            epsActual: 0.5,
            epsEstimate: 0.48,
            quarter: '2023-10-31T00:00:00.000Z',
          },
        ],
      },
    });

    const rows = await yahooFinanceAPI.getEarningsBackfillRows('AAPL', '2023-01-01', '2024-12-31');

    expect(quoteSummaryMock).toHaveBeenCalledWith('AAPL', {
      modules: ['earnings', 'earningsHistory'],
    });
    const reported = rows.find((r) => r.source === 'yahoo_reported_quarterly');
    const fiscal = rows.find((r) => r.source === 'yahoo_fiscal_period_end');
    expect(reported?.eventDate).toBe('2024-01-04');
    expect(fiscal?.eventDate).toBe('2023-10-31');
  });
});
