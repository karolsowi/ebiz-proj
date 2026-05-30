import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
});

interface YahooCalendarEventsResponse {
  calendarEvents?: {
    earnings?: {
      earningsDate?: unknown[];
      earningsAverage?: number | null;
      revenueAverage?: number | null;
      isEarningsDateEstimate?: boolean;
    };
  };
}

export interface YahooEarningsCalendarEntry {
  symbol: string;
  date: string;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  isDateEstimate: boolean;
}

interface YahooEarningsChartQuarterlyRow {
  actual?: number | null;
  estimate?: number | null;
  periodEndDate?: number | null;
  reportedDate?: number | null;
}

interface YahooEarningsHistoryRow {
  epsActual?: number | null;
  epsEstimate?: number | null;
  quarter?: string | Date | null;
}

interface YahooEarningsModulesResponse {
  earnings?: {
    earningsChart?: {
      quarterly?: YahooEarningsChartQuarterlyRow[];
    };
  };
  earningsHistory?: {
    history?: YahooEarningsHistoryRow[];
  };
}

export interface YahooBackfillEarningsRow {
  eventDate: string;
  epsActual: number | null;
  epsEstimate: number | null;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  source: 'yahoo_reported_quarterly' | 'yahoo_fiscal_period_end';
  metadata: Record<string, unknown>;
}

function normalizeDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString().slice(0, 10)
    : null;
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unixSecondsToDayKey(sec: number): string | null {
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function fiscalPartsFromDay(day: string): { fiscalYear: number | null; fiscalQuarter: number | null } {
  const d = new Date(`${day}T12:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) {
    return { fiscalYear: null, fiscalQuarter: null };
  }
  return {
    fiscalYear: d.getUTCFullYear(),
    fiscalQuarter: Math.floor(d.getUTCMonth() / 3) + 1,
  };
}

class YahooFinanceAPI {
  async getNextEarningsCalendar(
    symbol: string
  ): Promise<YahooEarningsCalendarEntry | null> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const data = await yahooFinance.quoteSummary(normalizedSymbol, {
      modules: ['calendarEvents'],
    }) as YahooCalendarEventsResponse;

    const earnings = data.calendarEvents?.earnings;
    const eventDate = Array.isArray(earnings?.earningsDate)
      ? earnings.earningsDate
          .map((value) => normalizeDate(value))
          .filter((value): value is string => value !== null)
          .sort((left, right) => left.localeCompare(right))[0] ?? null
      : null;

    if (!eventDate) {
      return null;
    }

    return {
      symbol: normalizedSymbol,
      date: eventDate,
      epsEstimate: toOptionalNumber(earnings?.earningsAverage),
      revenueEstimate: toOptionalNumber(earnings?.revenueAverage),
      isDateEstimate: Boolean(earnings?.isEarningsDateEstimate),
    };
  }

  /**
   * Best-effort historical-ish rows from Yahoo `quoteSummary` (`earnings` + `earningsHistory`).
   * Yahoo typically returns only a **small number of recent quarters** (often ~4), not a full
   * multi-year earnings calendar. Rows are only returned when Yahoo dates fall inside `[from, to]`.
   *
   * - `yahoo_reported_quarterly`: `earningsChart.quarterly[].reportedDate` (Unix → day), when present.
   * - `yahoo_fiscal_period_end`: `earningsHistory.history[].quarter` (fiscal period end), not the
   *   press-release day — weaker for “days to earnings” but can land inside old research windows.
   */
  async getEarningsBackfillRows(
    symbol: string,
    from: string,
    to: string
  ): Promise<YahooBackfillEarningsRow[]> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const data = await yahooFinance.quoteSummary(normalizedSymbol, {
      modules: ['earnings', 'earningsHistory'],
    }) as YahooEarningsModulesResponse;

    const out: YahooBackfillEarningsRow[] = [];
    const seenReported = new Set<string>();
    const quarterly = data.earnings?.earningsChart?.quarterly;
    if (Array.isArray(quarterly)) {
      for (const row of quarterly) {
        const reported =
          typeof row.reportedDate === 'number'
            ? unixSecondsToDayKey(row.reportedDate)
            : null;
        if (!reported || reported < from || reported > to) continue;
        if (seenReported.has(reported)) continue;
        seenReported.add(reported);
        const { fiscalYear, fiscalQuarter } = fiscalPartsFromDay(reported);
        out.push({
          eventDate: reported,
          epsActual: toOptionalNumber(row.actual),
          epsEstimate: toOptionalNumber(row.estimate),
          fiscalYear,
          fiscalQuarter,
          source: 'yahoo_reported_quarterly',
          metadata: {
            provider: 'yahoo_finance2',
            yahooKind: 'earningsChart.reportedDate',
            periodEndDate:
              typeof row.periodEndDate === 'number'
                ? unixSecondsToDayKey(row.periodEndDate)
                : null,
          },
        });
      }
    }

    const history = data.earningsHistory?.history;
    if (Array.isArray(history)) {
      for (const row of history) {
        const day = normalizeDate(row.quarter);
        if (!day || day < from || day > to) continue;
        if (seenReported.has(day)) continue;
        seenReported.add(day);
        const { fiscalYear, fiscalQuarter } = fiscalPartsFromDay(day);
        out.push({
          eventDate: day,
          epsActual: toOptionalNumber(row.epsActual),
          epsEstimate: toOptionalNumber(row.epsEstimate),
          fiscalYear,
          fiscalQuarter,
          source: 'yahoo_fiscal_period_end',
          metadata: {
            provider: 'yahoo_finance2',
            yahooKind: 'earningsHistory.quarter',
          },
        });
      }
    }

    return out.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  }
}

export const yahooFinanceAPI = new YahooFinanceAPI();
