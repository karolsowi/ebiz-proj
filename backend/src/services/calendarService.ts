import { randomUUID } from 'crypto';
import { and, eq, gte, lte } from 'drizzle-orm';
import { finnhubAPI } from './finnhubApi.js';
import { portfolioService as portfolioDataService } from './databaseService.js';
import { earningsEventService } from './earningsEventService.js';
import { db } from '../db/connection.js';
import { calendarReminders } from '../db/schema.js';

export type CalendarEventType = 'earnings' | 'holiday' | 'economic' | 'personal';

export interface CalendarEventModel {
  id: string;
  title: string;
  type: CalendarEventType;
  start: string;
  end?: string;
  allDay: boolean;
  symbol?: string;
  description?: string;
  source: 'finnhub' | 'system' | 'user';
}

interface UpsertReminderInput {
  title: string;
  start: string;
  end?: string;
  description?: string;
  allDay?: boolean;
  createdBy: string;
}

class CalendarService {
  private toDateOnly(value: string | Date): string {
    return new Date(value).toISOString().split('T')[0] || '';
  }

  private toDateRange(input: { from: string; to: string }) {
    const fromDate = new Date(`${input.from}T00:00:00.000Z`);
    const toDate = new Date(`${input.to}T23:59:59.999Z`);
    return { fromDate, toDate };
  }

  private isWithinRange(dateStr: string, fromDate: Date, toDate: Date): boolean {
    const value = new Date(`${dateStr}T00:00:00.000Z`).getTime();
    return value >= fromDate.getTime() && value <= toDate.getTime();
  }

  private buildEconomicEvents(fromDate: Date, toDate: Date): CalendarEventModel[] {
    const events: CalendarEventModel[] = [];
    const cursor = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), 1));

    while (cursor <= toDate) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth();

      // CPI estimate around the 12th
      const cpiDate = new Date(Date.UTC(year, month, 12));
      if (cpiDate >= fromDate && cpiDate <= toDate) {
        events.push({
          id: `econ-cpi-${year}-${month}`,
          title: 'US CPI Release',
          type: 'economic',
          start: this.toDateOnly(cpiDate),
          allDay: true,
          description: 'Estimated inflation data release window',
          source: 'system',
        });
      }

      // FOMC-style window around the 20th
      const fomcDate = new Date(Date.UTC(year, month, 20));
      if (fomcDate >= fromDate && fomcDate <= toDate) {
        events.push({
          id: `econ-fomc-${year}-${month}`,
          title: 'Fed / FOMC Window',
          type: 'economic',
          start: this.toDateOnly(fomcDate),
          allDay: true,
          description: 'Potential policy meeting/communication window',
          source: 'system',
        });
      }

      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    return events;
  }

  async getEvents(input: {
    userId: string;
    from: string;
    to: string;
    symbols?: string[];
    types?: CalendarEventType[];
  }): Promise<CalendarEventModel[]> {
    const { fromDate, toDate } = this.toDateRange(input);
    const normalizedTypes = input.types && input.types.length > 0 ? input.types : ['earnings', 'holiday', 'economic', 'personal'];
    const events: CalendarEventModel[] = [];

    if (normalizedTypes.includes('earnings')) {
      let symbols = input.symbols ?? [];
      if (symbols.length === 0) {
        const holdings = await portfolioDataService.getAllEntries(input.userId);
        symbols = holdings.slice(0, 20).map((holding) => holding.symbol);
      }

      for (const symbol of symbols) {
        try {
          await earningsEventService.ensureRecentSymbolCoverage(symbol, fromDate);
          const earnings = await earningsEventService.getEventsInRange(
            symbol,
            this.toDateOnly(fromDate),
            this.toDateOnly(toDate)
          );
          for (const item of earnings) {
            if (!item.eventDate || !this.isWithinRange(item.eventDate, fromDate, toDate)) {
              continue;
            }
            events.push({
              id: `earnings-${symbol}-${item.eventDate}`,
              title: `${symbol} Earnings`,
              type: 'earnings',
              start: item.eventDate,
              allDay: true,
              symbol,
              description: `Estimate: ${item.epsEstimate ?? 'n/a'}, Actual: ${item.epsActual ?? 'n/a'}`,
              source: 'finnhub',
            });
          }
        } catch {
          // Ignore per-symbol failures so the rest of calendar still loads
        }
      }
    }

    if (normalizedTypes.includes('holiday')) {
      try {
        const holidays = await finnhubAPI.getMarketHolidays();
        for (const holiday of holidays) {
          if (!holiday.atDate || !this.isWithinRange(holiday.atDate, fromDate, toDate)) {
            continue;
          }
          events.push({
            id: `holiday-${holiday.atDate}-${holiday.eventName}`,
            title: holiday.eventName,
            type: 'holiday',
            start: holiday.atDate,
            allDay: true,
            description: holiday.tradingHour,
            source: 'finnhub',
          });
        }
      } catch {
        // Ignore if holiday feed fails
      }
    }

    if (normalizedTypes.includes('economic')) {
      events.push(...this.buildEconomicEvents(fromDate, toDate));
    }

    if (normalizedTypes.includes('personal')) {
      const reminders = await db
        .select()
        .from(calendarReminders)
        .where(
          and(
            gte(calendarReminders.startAt, fromDate),
            lte(calendarReminders.startAt, toDate),
            eq(calendarReminders.createdBy, input.userId)
          )
        );

      for (const reminder of reminders) {
        const mapped: CalendarEventModel = {
          id: reminder.id,
          title: reminder.title,
          type: 'personal',
          start: this.toDateOnly(reminder.startAt),
          allDay: reminder.allDay,
          source: 'user',
          ...(reminder.endAt ? { end: this.toDateOnly(reminder.endAt) } : {}),
          ...(reminder.description ? { description: reminder.description } : {}),
        };
        events.push(mapped);
      }
    }

    return events.sort((a, b) => a.start.localeCompare(b.start));
  }

  async createReminder(input: UpsertReminderInput): Promise<CalendarEventModel> {
    const id = `personal-${randomUUID()}`;
    const inserted = await db
      .insert(calendarReminders)
      .values({
        id,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        startAt: new Date(`${this.toDateOnly(input.start)}T00:00:00.000Z`),
        endAt: input.end ? new Date(`${this.toDateOnly(input.end)}T00:00:00.000Z`) : null,
        allDay: input.allDay ?? true,
        createdBy: input.createdBy,
      })
      .returning();

    const reminder = inserted[0]!;
    return {
      id: reminder.id,
      title: reminder.title,
      type: 'personal',
      start: this.toDateOnly(reminder.startAt),
      allDay: reminder.allDay,
      source: 'user',
      ...(reminder.endAt ? { end: this.toDateOnly(reminder.endAt) } : {}),
      ...(reminder.description ? { description: reminder.description } : {}),
    };
  }

  async updateReminder(id: string, input: UpsertReminderInput): Promise<CalendarEventModel | null> {
    const updated = await db
      .update(calendarReminders)
      .set({
        title: input.title.trim(),
        description: input.description?.trim() || null,
        startAt: new Date(`${this.toDateOnly(input.start)}T00:00:00.000Z`),
        endAt: input.end ? new Date(`${this.toDateOnly(input.end)}T00:00:00.000Z`) : null,
        allDay: input.allDay ?? true,
        updatedAt: new Date(),
      })
      .where(and(eq(calendarReminders.id, id), eq(calendarReminders.createdBy, input.createdBy)))
      .returning();

    const reminder = updated[0];
    if (!reminder) return null;

    return {
      id: reminder.id,
      title: reminder.title,
      type: 'personal',
      start: this.toDateOnly(reminder.startAt),
      allDay: reminder.allDay,
      source: 'user',
      ...(reminder.endAt ? { end: this.toDateOnly(reminder.endAt) } : {}),
      ...(reminder.description ? { description: reminder.description } : {}),
    };
  }

  async deleteReminder(id: string, createdBy: string): Promise<boolean> {
    const deleted = await db
      .delete(calendarReminders)
      .where(and(eq(calendarReminders.id, id), eq(calendarReminders.createdBy, createdBy)))
      .returning();
    return deleted.length > 0;
  }
}

export const calendarService = new CalendarService();
