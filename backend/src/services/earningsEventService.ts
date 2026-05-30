import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { earningsEvents } from '../db/schema.js';
import {
  finnhubAPI,
  type FinnhubEarningsCalendarEntry,
} from './finnhubApi.js';
import { yahooFinanceAPI } from './yahooFinanceApi.js';

export interface StoredEarningsEvent {
  symbol: string;
  eventDate: string;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  eventHour: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  source: string;
  metadata: Record<string, unknown>;
}

export interface NextEarningsEvent {
  symbol: string;
  eventDate: string;
  daysToEarnings: number;
  source: string;
}

export type EarningsSyncProvider = 'finnhub' | 'yahoo';

export interface EarningsSyncOptions {
  providers?: readonly EarningsSyncProvider[];
}

export interface EarningsSyncResult {
  symbol: string;
  from: string;
  to: string;
  upserted: number;
  providerEvents: Partial<Record<EarningsSyncProvider, number>>;
  providerErrors: Partial<Record<EarningsSyncProvider, string>>;
  providersAttempted: EarningsSyncProvider[];
}

const DEFAULT_SYNC_PROVIDERS: readonly EarningsSyncProvider[] = ['finnhub', 'yahoo'];
const SOURCE_PRIORITY: Record<string, number> = {
  finnhub_calendar: 0,
  yahoo_reported_quarterly: 1,
  yahoo_calendar: 2,
  yahoo_fiscal_period_end: 3,
};

function toDayKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function shiftUtcDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function diffUtcDays(from: Date, toDay: string): number {
  const fromUtc = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate()
  );
  const to = new Date(`${toDay}T00:00:00.000Z`);
  const toUtc = Date.UTC(
    to.getUTCFullYear(),
    to.getUTCMonth(),
    to.getUTCDate()
  );
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

function normalizeDate(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const day = raw.split(/[T\s]/)[0] ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSourcePriority(source: string): number {
  return SOURCE_PRIORITY[source] ?? 99;
}

function getEventCompletenessScore(event: StoredEarningsEvent): number {
  return [
    event.fiscalYear,
    event.fiscalQuarter,
    event.eventHour,
    event.epsActual,
    event.epsEstimate,
    event.revenueActual,
    event.revenueEstimate,
  ].reduce<number>(
    (score, value) => score + (value !== null ? 1 : 0),
    0
  );
}

function comparePreferredEvent(
  left: StoredEarningsEvent,
  right: StoredEarningsEvent
): number {
  const sourcePriorityDiff =
    getSourcePriority(left.source) - getSourcePriority(right.source);
  if (sourcePriorityDiff !== 0) {
    return sourcePriorityDiff;
  }

  const completenessDiff =
    getEventCompletenessScore(right) - getEventCompletenessScore(left);
  if (completenessDiff !== 0) {
    return completenessDiff;
  }

  return left.source.localeCompare(right.source);
}

function mergePreferredEvents(
  events: readonly StoredEarningsEvent[]
): StoredEarningsEvent[] {
  const preferredByDay = new Map<string, StoredEarningsEvent>();

  for (const event of events) {
    const key = `${event.symbol}:${event.eventDate}`;
    const existing = preferredByDay.get(key);
    if (!existing || comparePreferredEvent(event, existing) < 0) {
      preferredByDay.set(key, event);
    }
  }

  return [...preferredByDay.values()].sort((left, right) =>
    left.eventDate.localeCompare(right.eventDate)
  );
}

function dedupeExactProviderEvents(
  events: readonly StoredEarningsEvent[]
): StoredEarningsEvent[] {
  const deduped = new Map<string, StoredEarningsEvent>();

  for (const event of events) {
    const key = `${event.symbol}:${event.eventDate}:${event.source}`;
    const existing = deduped.get(key);
    if (!existing || comparePreferredEvent(event, existing) < 0) {
      deduped.set(key, event);
    }
  }

  return [...deduped.values()];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldAttemptYahooSync(
  to: string,
  finnhubEvents: readonly StoredEarningsEvent[],
  finnhubFailed: boolean
): boolean {
  const today = toDayKey(new Date());
  if (to < today) {
    return false;
  }

  if (finnhubFailed) {
    return true;
  }

  return !finnhubEvents.some((event) => event.eventDate >= today && event.eventDate <= to);
}

function toStoredEvent(
  entry: FinnhubEarningsCalendarEntry,
  source: string
): StoredEarningsEvent | null {
  const symbol = String(entry.symbol ?? '').trim().toUpperCase();
  const eventDate = normalizeDate(entry.date);
  if (!symbol || !eventDate) return null;

  return {
    symbol,
    eventDate,
    fiscalYear: toOptionalNumber(entry.year),
    fiscalQuarter: toOptionalNumber(entry.quarter),
    eventHour: String(entry.hour ?? '').trim() || null,
    epsActual: toOptionalNumber(entry.epsActual),
    epsEstimate: toOptionalNumber(entry.epsEstimate),
    revenueActual: toOptionalNumber(entry.revenueActual),
    revenueEstimate: toOptionalNumber(entry.revenueEstimate),
    source,
    metadata: {
      provider: 'finnhub',
    },
  };
}

export function scoreCalendarCatalyst(daysToEarnings: number | null): number {
  if (daysToEarnings === null || daysToEarnings < 0) return 0;
  if (daysToEarnings <= 3) return 1.0;
  if (daysToEarnings <= 7) return 0.8;
  if (daysToEarnings <= 14) return 0.5;
  if (daysToEarnings <= 30) return 0.2;
  return 0;
}

export class EarningsEventService {
  private async fetchFinnhubEvents(
    symbol: string,
    from: string,
    to: string
  ): Promise<StoredEarningsEvent[]> {
    const response = await finnhubAPI.getEarningsCalendar({
      symbol,
      from,
      to,
    });

    return response
      .map((entry) => toStoredEvent(entry, 'finnhub_calendar'))
      .filter((entry): entry is StoredEarningsEvent => entry !== null);
  }

  private async fetchYahooEvents(
    symbol: string,
    from: string,
    to: string
  ): Promise<StoredEarningsEvent[]> {
    const entry = await yahooFinanceAPI.getNextEarningsCalendar(symbol);
    if (!entry || entry.date < from || entry.date > to) {
      return [];
    }

    return [
      {
        symbol: entry.symbol,
        eventDate: entry.date,
        fiscalYear: null,
        fiscalQuarter: null,
        eventHour: null,
        epsActual: null,
        epsEstimate: entry.epsEstimate,
        revenueActual: null,
        revenueEstimate: entry.revenueEstimate,
        source: 'yahoo_calendar',
        metadata: {
          provider: 'yahoo_finance2',
          isEarningsDateEstimate: entry.isDateEstimate,
        },
      },
    ];
  }

  private async fetchYahooBackfillEvents(
    symbol: string,
    from: string,
    to: string
  ): Promise<StoredEarningsEvent[]> {
    const rows = await yahooFinanceAPI.getEarningsBackfillRows(symbol, from, to);
    return rows.map((row) => ({
      symbol,
      eventDate: row.eventDate,
      fiscalYear: row.fiscalYear,
      fiscalQuarter: row.fiscalQuarter,
      eventHour: null,
      epsActual: row.epsActual,
      epsEstimate: row.epsEstimate,
      revenueActual: null,
      revenueEstimate: null,
      source: row.source,
      metadata: row.metadata,
    }));
  }

  async upsertEvents(events: readonly StoredEarningsEvent[]): Promise<number> {
    let upserts = 0;

    for (const event of events) {
      await db.insert(earningsEvents)
        .values({
          symbol: event.symbol,
          eventDate: event.eventDate,
          fiscalYear: event.fiscalYear,
          fiscalQuarter: event.fiscalQuarter,
          eventHour: event.eventHour,
          epsActual: event.epsActual?.toString() ?? null,
          epsEstimate: event.epsEstimate?.toString() ?? null,
          revenueActual: event.revenueActual?.toString() ?? null,
          revenueEstimate: event.revenueEstimate?.toString() ?? null,
          source: event.source,
          metadata: event.metadata,
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            earningsEvents.symbol,
            earningsEvents.eventDate,
            earningsEvents.source,
          ],
          set: {
            fiscalYear: event.fiscalYear,
            fiscalQuarter: event.fiscalQuarter,
            eventHour: event.eventHour,
            epsActual: event.epsActual?.toString() ?? null,
            epsEstimate: event.epsEstimate?.toString() ?? null,
            revenueActual: event.revenueActual?.toString() ?? null,
            revenueEstimate: event.revenueEstimate?.toString() ?? null,
            metadata: event.metadata,
            fetchedAt: new Date(),
          },
        });
      upserts += 1;
    }

    return upserts;
  }

  async syncSymbolCalendarDetailed(
    symbol: string,
    from: string,
    to: string,
    options: EarningsSyncOptions = {}
  ): Promise<EarningsSyncResult> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const requestedProviders = [
      ...new Set((options.providers ?? DEFAULT_SYNC_PROVIDERS).map((provider) => provider)),
    ];
    const providerEvents: Partial<Record<EarningsSyncProvider, number>> = {};
    const providerErrors: Partial<Record<EarningsSyncProvider, string>> = {};
    const providersAttempted: EarningsSyncProvider[] = [];
    const collectedEvents: StoredEarningsEvent[] = [];

    let finnhubEvents: StoredEarningsEvent[] = [];
    let finnhubFailed = false;

    if (requestedProviders.includes('finnhub')) {
      providersAttempted.push('finnhub');
      try {
        finnhubEvents = await this.fetchFinnhubEvents(normalizedSymbol, from, to);
        providerEvents.finnhub = finnhubEvents.length;
        collectedEvents.push(...finnhubEvents);
      } catch (error) {
        finnhubFailed = true;
        providerErrors.finnhub = toErrorMessage(error);
      }
    }

    if (requestedProviders.includes('yahoo')) {
      providersAttempted.push('yahoo');
      let yahooEventCount = 0;
      try {
        if (shouldAttemptYahooSync(to, finnhubEvents, finnhubFailed)) {
          const yahooEvents = await this.fetchYahooEvents(normalizedSymbol, from, to);
          collectedEvents.push(...yahooEvents);
          yahooEventCount += yahooEvents.length;
        }
        const yahooBackfill = await this.fetchYahooBackfillEvents(normalizedSymbol, from, to);
        collectedEvents.push(...yahooBackfill);
        yahooEventCount += yahooBackfill.length;
        providerEvents.yahoo = yahooEventCount;
      } catch (error) {
        providerErrors.yahoo = toErrorMessage(error);
      }
    }

    if (collectedEvents.length === 0 && providersAttempted.length > 0) {
      const failedAttempts = providersAttempted.filter((provider) => providerErrors[provider]);
      if (failedAttempts.length === providersAttempted.length) {
        throw new Error(
          `Failed to sync earnings events for ${normalizedSymbol}: ${failedAttempts
            .map((provider) => `${provider}=${providerErrors[provider]}`)
            .join('; ')}`
        );
      }
    }

    const upserted = await this.upsertEvents(dedupeExactProviderEvents(collectedEvents));

    return {
      symbol: normalizedSymbol,
      from,
      to,
      upserted,
      providerEvents,
      providerErrors,
      providersAttempted,
    };
  }

  async syncSymbolCalendar(
    symbol: string,
    from: string,
    to: string,
    options: EarningsSyncOptions = {}
  ): Promise<number> {
    const result = await this.syncSymbolCalendarDetailed(symbol, from, to, options);
    return result.upserted;
  }

  async getEventsInRange(
    symbol: string,
    from: string,
    to: string
  ): Promise<StoredEarningsEvent[]> {
    const rows = await db
      .select()
      .from(earningsEvents)
      .where(
        and(
          eq(earningsEvents.symbol, symbol.toUpperCase()),
          gte(earningsEvents.eventDate, from),
          lte(earningsEvents.eventDate, to)
        )
      )
      .orderBy(asc(earningsEvents.eventDate));

    return mergePreferredEvents(rows.map((row) => ({
      symbol: row.symbol,
      eventDate: row.eventDate,
      fiscalYear: row.fiscalYear ?? null,
      fiscalQuarter: row.fiscalQuarter ?? null,
      eventHour: row.eventHour ?? null,
      epsActual: row.epsActual !== null ? Number(row.epsActual) : null,
      epsEstimate: row.epsEstimate !== null ? Number(row.epsEstimate) : null,
      revenueActual: row.revenueActual !== null ? Number(row.revenueActual) : null,
      revenueEstimate: row.revenueEstimate !== null ? Number(row.revenueEstimate) : null,
      source: row.source,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    })));
  }

  async ensureRecentSymbolCoverage(
    symbol: string,
    asOfDate: Date
  ): Promise<boolean> {
    const today = toDayKey(new Date());
    const asOfDay = toDayKey(asOfDate);
    const ageInDays = Math.abs(diffUtcDays(new Date(`${asOfDay}T00:00:00.000Z`), today));

    if (ageInDays > 400) {
      return false;
    }

    try {
      await this.syncSymbolCalendar(
        symbol,
        shiftUtcDays(asOfDay, -365),
        shiftUtcDays(asOfDay, 400)
      );
      return true;
    } catch {
      return false;
    }
  }

  async getNextEarningsEvent(
    symbol: string,
    asOfDate: Date,
    lookaheadDays: number = 365
  ): Promise<NextEarningsEvent | null> {
    const asOfDay = toDayKey(asOfDate);
    const horizonDay = shiftUtcDays(asOfDay, lookaheadDays);

    const [event] = await this.getEventsInRange(
      symbol.toUpperCase(),
      asOfDay,
      horizonDay
    );

    if (!event) {
      return null;
    }

    return {
      symbol: event.symbol,
      eventDate: event.eventDate,
      daysToEarnings: diffUtcDays(asOfDate, event.eventDate),
      source: event.source,
    };
  }
}

export const earningsEventService = new EarningsEventService();
