import { describe, expect, it } from 'vitest';
import {
  calendarRowsFromRootApp,
  eventDateFromYahooCalendarDatetimeLabel,
  extractRootAppMainJson,
  mapDomExtractedToScrapeRows,
  mapRowToScrapeRow,
  normalizeYahooEarningsDatetimeLabelForParse,
  scrapeRowsFromHtml,
  scrapeRowsFromRootAppMain,
} from './yahooEarningsCalendarScraper.js';

describe('yahooEarningsCalendarScraper', () => {
  it('extracts and parses embedded calendar rows', () => {
    const embedded = {
      context: {
        dispatcher: {
          stores: {
            ScreenerResultsStore: {
              results: {
                rows: [
                  {
                    ticker: 'TEST',
                    companyshortname: 'Test Co',
                    startdatetime: '2024-06-15T20:00:00.000Z',
                    startdatetimetype: 'AMC',
                    epsestimate: 1.25,
                    epsactual: 1.3,
                    epssurprisepct: 4,
                  },
                ],
              },
            },
          },
        },
      },
    };

    const line = `root.App.main = ${JSON.stringify(embedded)};`;
    const html = `<html><body><script>\n${line}\n</script></body></html>`;
    const root = extractRootAppMainJson(html);
    const rows = calendarRowsFromRootApp(root);
    expect(rows).toHaveLength(1);
    const mapped = mapRowToScrapeRow(rows[0]);
    expect(mapped?.symbol).toBe('TEST');
    expect(mapped?.eventDate).toBe('2024-06-15');
    expect(mapped?.epsActual).toBe(1.3);
    expect(mapped?.timeType).toBe('AMC');
  });

  it('extracts minified one-line root.App.main via brace matching', () => {
    const embedded = {
      context: {
        dispatcher: {
          stores: {
            ScreenerResultsStore: { results: { rows: [] } },
          },
        },
      },
    };
    const html = `<html><body><script>root.App.main = ${JSON.stringify(embedded)};foo()</script></body></html>`;
    const root = extractRootAppMainJson(html);
    const rows = calendarRowsFromRootApp(root);
    expect(rows).toHaveLength(0);
  });

  it('scrapeRowsFromHtml maps rows like the fetch path', () => {
    const embedded = {
      context: {
        dispatcher: {
          stores: {
            ScreenerResultsStore: {
              results: {
                rows: [
                  {
                    ticker: 'AB',
                    startdatetime: '2024-06-10T12:00:00.000Z',
                    startdatetimetype: 'TNS',
                  },
                ],
              },
            },
          },
        },
      },
    };
    const html = `<html><script>root.App.main = ${JSON.stringify(embedded)};</script></html>`;
    const out = scrapeRowsFromHtml(html);
    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe('AB');
    expect(out[0]?.eventDate).toBe('2024-06-10');
  });

  it('scrapeRowsFromRootAppMain maps parsed root object', () => {
    const embedded = {
      context: {
        dispatcher: {
          stores: {
            ScreenerResultsStore: {
              results: {
                rows: [
                  {
                    ticker: 'XY',
                    startdatetime: '2024-01-02T12:00:00.000Z',
                  },
                ],
              },
            },
          },
        },
      },
    };
    const out = scrapeRowsFromRootAppMain(embedded);
    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe('XY');
  });

  it('parses Yahoo table datetime labels without minutes before AM/PM (Node Date.parse)', () => {
    expect(normalizeYahooEarningsDatetimeLabelForParse('May 20, 2026 at 4 PM EDT')).toBe(
      'May 20, 2026 4:00 PM EDT'
    );
    expect(eventDateFromYahooCalendarDatetimeLabel('May 20, 2026 at 4 PM EDT')).toBe('2026-05-20');
    expect(eventDateFromYahooCalendarDatetimeLabel('February 25, 2026 at 4 PM EST')).toBe(
      '2026-02-25'
    );
  });

  it('mapDomExtractedToScrapeRows normalizes symbols and dates', () => {
    const out = mapDomExtractedToScrapeRows([
      {
        symbol: 'BRK.B',
        companyName: 'Berkshire',
        eventDate: '2024-03-01',
        epsEstimate: 1.5,
        epsActual: null,
        epsSurprisePct: -2.5,
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe('BRK-B');
    expect(out[0]?.eventDate).toBe('2024-03-01');
    expect(out[0]?.raw.source).toBe('yahoo_dom_calendar_v2');
  });
});
