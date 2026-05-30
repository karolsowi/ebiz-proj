/**
 * Scrape Yahoo Finance earnings calendar HTML (embedded root.App.main JSON) and upsert
 * into earnings_events with source `yahoo_calendar_scrape`.
 *
 * Yahoo may return a consent / GDPR interstitial without real data — run from a network
 * where finance.yahoo.com returns the full calendar page, and respect Yahoo's terms.
 * If the HTML has no `root.App.main`, set **`YAHOO_COOKIE`** in `.env` (Cookie header value
 * copied while logged in on finance.yahoo.com) and retry.
 *
 * Usage:
 *   # One symbol (all rows Yahoo lists for that ticker)
 *   npx tsx scripts/scrape_yahoo_earnings_calendar.ts "--symbol=NVDA" "--dry-run"
 *
 *   # Calendar day range (each day = all tickers that day; can be slow)
 *   npx tsx scripts/scrape_yahoo_earnings_calendar.ts "--from=2024-06-01" "--to=2024-06-07" "--delay-ms=2500"
 *
 *   # Symbol + optional date filter on scraped rows
 *   npx tsx scripts/scrape_yahoo_earnings_calendar.ts "--symbol=AAPL" "--from=2020-01-01" "--to=2025-12-31"
 */
import { closeConnection } from '../src/db/connection.js';
import { earningsEventService } from '../src/services/earningsEventService.js';
import type { StoredEarningsEvent } from '../src/services/earningsEventService.js';
import {
  scrapeEarningsDateRange,
  scrapeEarningsForSymbol,
  type YahooCalendarScrapeRow,
} from '../src/services/yahooEarningsCalendarScraper.js';

function getFlag(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.some((a) => a === name || a.startsWith(`${name}=`));
}

function toStoredEvents(rows: YahooCalendarScrapeRow[]): StoredEarningsEvent[] {
  return rows.map((row) => ({
    symbol: row.symbol,
    eventDate: row.eventDate,
    fiscalYear: null,
    fiscalQuarter: null,
    eventHour: row.timeType,
    epsActual: row.epsActual,
    epsEstimate: row.epsEstimate,
    revenueActual: null,
    revenueEstimate: null,
    source: 'yahoo_calendar_scrape',
    metadata: {
      provider: 'yahoo_html_scraper',
      companyName: row.companyName,
      epsSurprisePct: row.epsSurprisePct,
      yahooRawKeys: Object.keys(row.raw).slice(0, 30),
    },
  }));
}

function filterByRange(
  rows: YahooCalendarScrapeRow[],
  from?: string,
  to?: string
): YahooCalendarScrapeRow[] {
  if (!from && !to) return rows;
  return rows.filter((r) => {
    if (from && r.eventDate < from) return false;
    if (to && r.eventDate > to) return false;
    return true;
  });
}

async function main() {
  const symbol = getFlag('--symbol')?.trim();
  const from = getFlag('--from');
  const to = getFlag('--to');
  const dryRun = hasFlag('--dry-run');
  const delayMs = Number(getFlag('--delay-ms') ?? '2000');
  const pageSize = Number(getFlag('--page-size') ?? '100');

  if (!symbol && (!from || !to)) {
    console.error(
      'Provide either --symbol=TICKER or both --from=YYYY-MM-DD and --to=YYYY-MM-DD (inclusive).'
    );
    process.exit(1);
  }

  let rows: YahooCalendarScrapeRow[] = [];

  if (symbol) {
    console.log(`Fetching Yahoo earnings calendar for symbol=${symbol}...`);
    rows = await scrapeEarningsForSymbol(symbol, { delayMs: 0 });
    rows = filterByRange(rows, from, to);
    console.log(`Rows after optional date filter: ${rows.length}`);
  } else {
    console.log(`Scrape range ${from} .. ${to} (one HTTP batch per calendar day)...`);
    rows = await scrapeEarningsDateRange(from!, to!, {
      pageSize: Number.isFinite(pageSize) ? pageSize : 100,
      delayMs: Number.isFinite(delayMs) ? delayMs : 2000,
      onProgress: (m) => console.log(m),
    });
    console.log(`Total unique symbol+date rows: ${rows.length}`);
  }

  if (rows.length === 0) {
    console.warn('No rows — consent wall, wrong URL shape, or empty calendar.');
  }

  if (dryRun) {
    console.log('Dry run: first 10 rows:', JSON.stringify(rows.slice(0, 10), null, 2));
    await closeConnection();
    return;
  }

  const stored = toStoredEvents(rows);
  let upserted = 0;
  for (const chunk of chunkArray(stored, 200)) {
    upserted += await earningsEventService.upsertEvents(chunk);
  }
  console.log(`Upserted ${upserted} earnings_events (source=yahoo_calendar_scrape).`);
  await closeConnection();
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeConnection();
  process.exit(1);
});
