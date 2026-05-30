/**
 * Open a visible Chrome window, load Yahoo Finance earnings calendar — you handle
 * cookie/consent or login in the browser — then press Enter in this terminal (or use
 * `--wait-ms` / Enter). Reads **`driver.getPageSource()`** with Cheerio (same serialized HTML as
 * the live page), then `executeScript` on the default document and each `<iframe>`, then legacy
 * `root.App.main`. Symbol mode can click **Next** to merge extra pages (omit `--no-pagination` when
 * Yahoo splits history across pages).
 *
 * Day calendar (`--from` / `--to`): the day-screener table usually has no per-row `startdatetime`
 * cell (date is implied by `?day=` in the URL). That day is passed as a fallback when parsing rows.
 *
 * Requires Chrome (Selenium 4 resolves chromedriver when possible).
 *
 * Usage (prefer `npx tsx` on Windows so npm does not treat `--symbol` as an npm flag):
 *   npx tsx scripts/scrape_yahoo_earnings_selenium.ts --symbol=NVDA --dry-run
 *   npx tsx scripts/scrape_yahoo_earnings_selenium.ts --from=2024-06-01 --to=2024-06-03 --delay-ms=2000
 *     (day calendar: all tickers reporting in that range, one combined table per day)
 *   npx tsx scripts/scrape_yahoo_earnings_selenium.ts --universe=sp500 --dry-run
 *     (every S&P 500 symbol’s earnings history tab; slow — use `--symbol-delay-ms`, `--max-symbols` for tests)
 *
 * Optional:
 *   `--wait-ms=15000` — wait that many ms instead of "press Enter" (first pause; also used
 *     between pages when `--wait-each-page` is set).
 *   `--wait-each-page` — pause before every navigation after the first page.
 *   `--settle-ms=0` — extra ms after load before reading the DOM (default 0; increase if you ever need it).
 *   `--universe=sp500` — scrape each symbol like `--symbol` (see `stooqService.getSP500Symbols()`).
 *   `--symbols-file=path.txt` — one ticker per line (`#` comments ok); mutually exclusive with `--universe`.
 *   `--symbol-start-index=0` — skip first N symbols in the batch list (resume).
 *   `--max-symbols=20` — only process first N symbols after the start index (smoke tests).
 *   `--symbol-delay-ms=2000` — pause between tickers after the first (rate limit / let table render).
 *   `--no-pagination` — for `?symbol=` views only read the first table page (skip “Next”; use when full
 *     history is already visible on page 1).
 */
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Builder, Browser, By } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import type { WebDriver } from 'selenium-webdriver';
import { closeConnection } from '../src/db/connection.js';
import { earningsEventService } from '../src/services/earningsEventService.js';
import type { StoredEarningsEvent } from '../src/services/earningsEventService.js';
import { stooqService } from '../src/services/stooqService.js';
import {
  dedupeYahooCalendarScrapeRows,
  eventDateFromYahooCalendarDatetimeLabel,
  extractRootAppMainJson,
  mapDomExtractedToScrapeRows,
  scrapeRowsFromHtml,
  scrapeRowsFromRootAppMain,
  type YahooCalendarDomExtractedRow,
  type YahooCalendarScrapeRow,
} from '../src/services/yahooEarningsCalendarScraper.js';

function getFlag(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.some((a) => a === name || a.startsWith(`${name}=`));
}

function addUtcDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayDiffInclusive(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00.000Z`).getTime();
  const b = new Date(`${to}T12:00:00.000Z`).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

function buildDayUrl(day: string, offset: number, size: number): string {
  const u = new URL('https://finance.yahoo.com/calendar/earnings');
  u.searchParams.set('day', day);
  u.searchParams.set('offset', String(offset));
  u.searchParams.set('size', String(size));
  return u.toString();
}

function buildSymbolUrl(symbol: string): string {
  const u = new URL('https://finance.yahoo.com/calendar/earnings');
  u.searchParams.set('symbol', symbol.trim().toUpperCase());
  return u.toString();
}

async function promptLine(message: string): Promise<void> {
  const rl = readline.createInterface({ input, output });
  await rl.question(message);
  rl.close();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
      provider: 'yahoo_html_scraper_selenium',
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

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function readSymbolsFromFile(path: string): string[] {
  const raw = readFileSync(path, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.split('#')[0]!.trim())
    .filter(Boolean)
    .map((s) => s.trim().toUpperCase());
}

async function buildChromeDriver(): Promise<WebDriver> {
  const options = new chrome.Options();
  return new Builder().forBrowser(Browser.CHROME).setChromeOptions(options).build();
}

/** Shared: locate calendar `<tr>`s in light DOM + shadow roots, then ticker cells as fallback. */
const FIND_CALENDAR_ROW_ELEMENTS_JS = [
  '  function findRowElements() {',
  '    var found = [];',
  '    function walk(node) {',
  '      if (!node || !node.querySelectorAll) return;',
  '      var trs = node.querySelectorAll("tr[data-testid=\\"data-table-v2-row\\"]");',
  '      for (var i = 0; i < trs.length; i++) found.push(trs[i]);',
  '      var stars = node.querySelectorAll("*");',
  '      for (var j = 0; j < stars.length; j++) {',
  '        if (stars[j].shadowRoot) walk(stars[j].shadowRoot);',
  '      }',
  '    }',
  '    walk(document);',
  '    if (found.length) return found;',
  '    function walkTicker(node) {',
  '      if (!node || !node.querySelectorAll) return;',
  '      var tds = node.querySelectorAll("td[data-testid-cell=\\"ticker\\"]");',
  '      for (var k = 0; k < tds.length; k++) {',
  '        var tr = tds[k].closest("tr");',
  '        if (tr && found.indexOf(tr) === -1) found.push(tr);',
  '      }',
  '      var stars2 = node.querySelectorAll("*");',
  '      for (var j2 = 0; j2 < stars2.length; j2++) {',
  '        if (stars2[j2].shadowRoot) walkTicker(stars2[j2].shadowRoot);',
  '      }',
  '    }',
  '    walkTicker(document);',
  '    return found;',
  '  }',
].join('\n');

/**
 * In-browser scrape for Yahoo’s rendered calendar table. Must be a **string** script: passing a
 * `function` from ts/tsx can inject helpers like `__name` into the serialized function body,
 * which Chrome then throws on.
 *
 * `calendarDayYmd` — when set (YYYY-MM-DD), used if the row has no `startdatetime` cell (day
 * screener view only has `eventname` / `startdatetimetype`, date is implied by the URL).
 */
function buildCalendarDomExtractJs(calendarDayYmd: string | null): string {
  const fallbackLiteral =
    calendarDayYmd && /^\d{4}-\d{2}-\d{2}$/.test(calendarDayYmd)
      ? JSON.stringify(calendarDayYmd)
      : 'null';
  return [
    'return (function() {',
    '  var CALENDAR_DAY_FALLBACK = ' + fallbackLiteral + ';',
    '  function parseNum(s) {',
    '    if (s == null) return null;',
    "    var t = String(s).replace(/\\u2212/g, '-').replace(/,/g, '').replace(/%/g, '').replace(/^\\+/,'').trim();",
    "    if (t === '' || t === '-' || t === '\\u2013' || t === '\\u2014') return null;",
    '    var n = Number(t);',
    '    return (typeof n === "number" && isFinite(n)) ? n : null;',
    '  }',
    FIND_CALENDAR_ROW_ELEMENTS_JS,
    '  var rows = [];',
    '  var trs = findRowElements();',
    '  for (var i = 0; i < trs.length; i++) {',
    '    var tr = trs[i];',
    '    function cell(name) {',
    "      var td = tr.querySelector('td[data-testid-cell=\"' + name + '\"]');",
    "      if (!td) return '';",
    "      return td.innerText.replace(/\\s+/g, ' ').trim();",
    '    }',
    "    var tickerA = tr.querySelector('td[data-testid-cell=\"ticker\"] a[href*=\"/quote/\"]');",
    "    var href = tickerA ? (tickerA.getAttribute('href') || '') : '';",
    "    var sym = '';",
    "    var qi = href.indexOf('/quote/');",
    "    if (qi !== -1) {",
    "      var rest = href.slice(qi + '/quote/'.length);",
    "      var stop = rest.search(/[/?#]/);",
    "      sym = (stop === -1 ? rest : rest.slice(0, stop)).trim().toUpperCase().replace(/\\./g, '-');",
    '    } else if (tickerA) {',
    "      sym = (tickerA.getAttribute('title') || tickerA.textContent || '').trim().toUpperCase().replace(/\\./g, '-');",
    '    }',
    "    var startLabel = cell('startdatetime').replace(/\\s+/g, ' ').trim();",
    '    var eventDate = null;',
    '    if (startLabel) {',
    "      var sl = startLabel.replace(/ at /g, ' ');",
    "      sl = sl.replace(/\\b(\\d{1,2})\\s+(AM|PM)\\b/gi, function(_, h, ap) { return h + ':00 ' + ap; });",
    '      var parsed = Date.parse(sl);',
    '      if (isFinite(parsed)) {',
    "        eventDate = new Date(parsed).toISOString().slice(0, 10);",
    '      }',
    '    }',
    '    if (!eventDate && CALENDAR_DAY_FALLBACK) {',
    '      eventDate = CALENDAR_DAY_FALLBACK;',
    '    }',
    '    if (!sym || !eventDate) continue;',
    '    rows.push({',
    '      symbol: sym,',
    "      companyName: cell('companyshortname') || null,",
    '      eventDate: eventDate,',
    "      epsEstimate: parseNum(cell('epsestimate')),",
    "      epsActual: parseNum(cell('epsactual')),",
    "      epsSurprisePct: parseNum(cell('epssurprisepct'))",
    '    });',
    '  }',
    '  return rows;',
    '})();',
  ].join('\n');
}

async function extractDomCalendarRows(
  driver: WebDriver,
  calendarDayYmd: string | null
): Promise<YahooCalendarScrapeRow[]> {
  const raw = (await driver.executeScript(buildCalendarDomExtractJs(calendarDayYmd))) as unknown;

  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }
  return mapDomExtractedToScrapeRows(raw as YahooCalendarDomExtractedRow[]);
}

function parseNumLoose(s: string): number | null {
  const t = s
    .replace(/\u2212/g, '-')
    .replace(/,/g, '')
    .replace(/%/g, '')
    .replace(/^\+/, '')
    .trim();
  if (t === '' || t === '-' || t === '\u2013' || t === '\u2014') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the earnings table from the HTML string Selenium returns (`getPageSource` / outerHTML).
 * This often succeeds when in-page `executeScript` sees an empty document (iframes, etc.).
 */
function scrapeRowsFromBrowserSerializedHtml(
  html: string,
  calendarDayYmd: string | null
): YahooCalendarScrapeRow[] {
  try {
    const $ = load(html);
    const extracted: YahooCalendarDomExtractedRow[] = [];
    const fallbackDay =
      calendarDayYmd && /^\d{4}-\d{2}-\d{2}$/.test(calendarDayYmd) ? calendarDayYmd : null;
    $('tr[data-testid="data-table-v2-row"]').each((_, el) => {
      const $tr = $(el);
      const cell = (name: string) =>
        $tr.find(`td[data-testid-cell="${name}"]`).first().text().replace(/\s+/g, ' ').trim();
      const tickerA = $tr.find('td[data-testid-cell="ticker"] a[href*="/quote/"]').first();
      const href = (tickerA.attr('href') ?? '').trim();
      let sym = '';
      const qi = href.indexOf('/quote/');
      if (qi !== -1) {
        const rest = href.slice(qi + '/quote/'.length);
        const stop = rest.search(/[/?#]/);
        sym = (stop === -1 ? rest : rest.slice(0, stop))
          .trim()
          .toUpperCase()
          .replace(/\./g, '-');
      } else if (tickerA.length > 0) {
        sym = (tickerA.attr('title') ?? tickerA.text() ?? '')
          .trim()
          .toUpperCase()
          .replace(/\./g, '-');
      }
      let eventDate = eventDateFromYahooCalendarDatetimeLabel(cell('startdatetime'));
      if (!eventDate && fallbackDay) {
        eventDate = fallbackDay;
      }
      if (!eventDate || !sym) return;
      extracted.push({
        symbol: sym,
        companyName: cell('companyshortname') || null,
        eventDate,
        epsEstimate: parseNumLoose(cell('epsestimate')),
        epsActual: parseNumLoose(cell('epsactual')),
        epsSurprisePct: parseNumLoose(cell('epssurprisepct')),
      });
    });
    return mapDomExtractedToScrapeRows(extracted);
  } catch {
    return [];
  }
}

/** Run DOM extract script on default document, then on each iframe (Yahoo sometimes nests the grid). */
async function extractDomCalendarRowsAllFrames(
  driver: WebDriver,
  calendarDayYmd: string | null
): Promise<YahooCalendarScrapeRow[]> {
  await driver.switchTo().defaultContent();
  let rows = await extractDomCalendarRows(driver, calendarDayYmd);
  if (rows.length > 0) return rows;

  const frames = await driver.findElements(By.css('iframe'));
  for (let i = 0; i < frames.length; i += 1) {
    try {
      await driver.switchTo().defaultContent();
      await driver.switchTo().frame(frames[i]!);
      rows = await extractDomCalendarRows(driver, calendarDayYmd);
      if (rows.length > 0) {
        await driver.switchTo().defaultContent();
        return rows;
      }
    } catch {
      // stale or cross-origin frame
    }
  }
  await driver.switchTo().defaultContent();
  return [];
}

/**
 * Symbol calendar may paginate in the UI (e.g. 25 rows × N pages). Merge pages until
 * “Next” is disabled or a pass adds no new symbol+date rows — unless `paginate` is false.
 */
async function collectSymbolCalendarPages(
  driver: WebDriver,
  settleMs: number,
  paginate: boolean
): Promise<YahooCalendarScrapeRow[]> {
  const seen = new Set<string>();
  const merged: YahooCalendarScrapeRow[] = [];

  for (;;) {
    const batch = await scrapeRowsFromLivePage(
      driver,
      merged.length === 0 ? settleMs : 0,
      null
    );
    let added = 0;
    for (const r of batch) {
      const k = `${r.symbol}:${r.eventDate}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(r);
      added += 1;
    }

    if (!paginate) break;

    let nextEnabled = false;
    try {
      nextEnabled = await driver.executeScript<boolean>(
        `const b = document.querySelector('[data-testid="next-page-button"]'); return !!(b && b.offsetParent !== null && !b.disabled);`
      );
    } catch {
      nextEnabled = false;
    }
    if (!nextEnabled) break;
    if (added === 0) break;

    await driver.findElement(By.css('[data-testid="next-page-button"]')).click();
    await sleep(Math.max(500, settleMs > 0 ? settleMs : 800));
  }

  return merged;
}

/**
 * Read the calendar: serialized page HTML first (Cheerio), then live DOM in all frames, then legacy JSON.
 */
async function scrapeRowsFromLivePage(
  driver: WebDriver,
  settleMs: number,
  /** Set for day-screener URLs (`?day=YYYY-MM-DD`) when rows omit `startdatetime`. */
  calendarDayYmd: string | null
): Promise<YahooCalendarScrapeRow[]> {
  if (settleMs > 0) {
    await sleep(settleMs);
  }

  const html = await driver.getPageSource();
  const fromSerialized = scrapeRowsFromBrowserSerializedHtml(html, calendarDayYmd);
  if (fromSerialized.length > 0) {
    return fromSerialized;
  }

  const fromFrames = await extractDomCalendarRowsAllFrames(driver, calendarDayYmd);
  if (fromFrames.length > 0) {
    return fromFrames;
  }

  let fromGlobal: unknown | null = null;
  try {
    fromGlobal = await driver.executeScript<unknown | null>(`
      try {
        if (typeof root !== 'undefined' && root != null && root.App && root.App.main != null) {
          return root.App.main;
        }
      } catch (e) {}
      return null;
    `);
  } catch {
    fromGlobal = null;
  }
  if (fromGlobal != null) {
    return scrapeRowsFromRootAppMain(fromGlobal);
  }

  let scriptBlob = '';
  try {
    scriptBlob = await driver.executeScript<string>(`
      return Array.from(document.querySelectorAll('script'))
        .map((s) => String(s.textContent || '') + String(s.innerHTML || ''))
        .join('\\n');
    `);
  } catch {
    scriptBlob = '';
  }

  const blob = `${scriptBlob}\n${html}`;
  try {
    const root = extractRootAppMainJson(blob);
    return scrapeRowsFromRootAppMain(root);
  } catch {
    try {
      return scrapeRowsFromHtml(html);
    } catch {
      throw new Error(
        'No earnings rows: no table in getPageSource(), nothing in iframes, and no root.App.main.'
      );
    }
  }
}

async function main() {
  const symbol =
    getFlag('--symbol')?.trim() ?? process.env.EARNINGS_SELENIUM_SYMBOL?.trim();
  const universe =
    getFlag('--universe')?.trim().toLowerCase() ??
    process.env.EARNINGS_SELENIUM_UNIVERSE?.trim().toLowerCase();
  const symbolsFile = getFlag('--symbols-file')?.trim();
  const from = getFlag('--from') ?? process.env.EARNINGS_SELENIUM_FROM;
  const to = getFlag('--to') ?? process.env.EARNINGS_SELENIUM_TO;
  const dryRun =
    hasFlag('--dry-run') || ['1', 'true', 'yes'].includes(String(process.env.EARNINGS_SELENIUM_DRY_RUN ?? '').toLowerCase());
  const delayMs = Number(getFlag('--delay-ms') ?? '2000');
  const pageSize = Number.isFinite(Number(getFlag('--page-size')))
    ? Number(getFlag('--page-size'))
    : 100;
  const waitEachPage = hasFlag('--wait-each-page');
  const waitMsRaw = getFlag('--wait-ms');
  const waitMs =
    waitMsRaw !== undefined && Number.isFinite(Number(waitMsRaw))
      ? Math.max(0, Number(waitMsRaw))
      : undefined;
  const settleMsRaw = getFlag('--settle-ms');
  const settleMs =
    settleMsRaw !== undefined && Number.isFinite(Number(settleMsRaw))
      ? Math.max(0, Number(settleMsRaw))
      : 0;
  const symbolPaginate = !hasFlag('--no-pagination');

  let batchSymbols: string[] = [];
  if (symbolsFile) {
    batchSymbols = readSymbolsFromFile(symbolsFile);
  } else if (universe === 'sp500' || universe === 'sp-500') {
    batchSymbols = stooqService.getSP500Symbols();
  } else if (universe) {
    console.error(`Unknown --universe=${universe} (supported: sp500).`);
    process.exit(1);
  }
  const hasBatch = batchSymbols.length > 0;

  if (symbol && hasBatch) {
    console.error('Use either --symbol=TICKER or a batch (--universe=sp500 / --symbols-file=), not both.');
    process.exit(1);
  }
  if (symbolsFile && universe) {
    console.error('Use either --symbols-file= or --universe=sp500, not both.');
    process.exit(1);
  }
  if (hasBatch && from && !to) {
    console.error('When using --from= for a batch run, also pass --to= (inclusive), or omit both.');
    process.exit(1);
  }
  if (hasBatch && !from && to) {
    console.error('When using --to= for a batch run, also pass --from=, or omit both.');
    process.exit(1);
  }

  const dayMode = !symbol && !hasBatch;
  if (dayMode && (!from || !to)) {
    console.error(
      'Provide --symbol=TICKER, or --universe=sp500 / --symbols-file=PATH.txt, or both --from= and --to= for the day calendar (all tickers reporting those days).'
    );
    process.exit(1);
  }

  const driver = await buildChromeDriver();
  const merged: YahooCalendarScrapeRow[] = [];
  let didFirstWait = false;

  const waitIfNeeded = async (label: string) => {
    if (!didFirstWait) {
      if (waitMs !== undefined && waitMs > 0) {
        console.log(
          `--wait-ms=${waitMs}: pause so you can finish consent / load the table.\n${label}`
        );
        await sleep(waitMs);
      } else {
        await promptLine(
          `${label}\nWhen the earnings table is visible, press Enter here to capture this page...\n> `
        );
      }
      didFirstWait = true;
      return;
    }
    if (waitEachPage) {
      if (waitMs !== undefined && waitMs > 0) {
        console.log(`--wait-ms=${waitMs}: pause before next page.\n${label}`);
        await sleep(waitMs);
      } else {
        await promptLine(`Press Enter to load and capture: ${label}\n> `);
      }
    }
  };

  try {
    if (symbol) {
      const url = buildSymbolUrl(symbol);
      await driver.get(url);
      await waitIfNeeded(url);
      merged.push(...(await collectSymbolCalendarPages(driver, settleMs, symbolPaginate)));
    } else if (hasBatch) {
      const startIdxRaw = getFlag('--symbol-start-index');
      const startIdx =
        startIdxRaw !== undefined && Number.isFinite(Number(startIdxRaw))
          ? Math.max(0, Math.floor(Number(startIdxRaw)))
          : 0;
      const maxSymRaw = getFlag('--max-symbols');
      const maxSymbols =
        maxSymRaw !== undefined && Number.isFinite(Number(maxSymRaw))
          ? Math.max(1, Math.floor(Number(maxSymRaw)))
          : undefined;
      const symbolDelayMsRaw = getFlag('--symbol-delay-ms');
      const symbolDelayMs =
        symbolDelayMsRaw !== undefined && Number.isFinite(Number(symbolDelayMsRaw))
          ? Math.max(0, Number(symbolDelayMsRaw))
          : 2000;

      let slice = batchSymbols.slice(startIdx);
      if (maxSymbols !== undefined) {
        slice = slice.slice(0, maxSymbols);
      }
      console.log(
        `Batch mode: ${slice.length} symbol(s) (full list ${batchSymbols.length}, start index ${startIdx}).`
      );

      for (let si = 0; si < slice.length; si += 1) {
        const sym = slice[si]!;
        const url = buildSymbolUrl(sym);
        await driver.get(url);
        if (si === 0) {
          await waitIfNeeded(url);
        } else {
          await sleep(symbolDelayMs);
        }
        try {
          const pageRows = await collectSymbolCalendarPages(driver, settleMs, symbolPaginate);
          merged.push(...pageRows);
          console.log(
            `[${startIdx + si + 1}/${batchSymbols.length}] ${sym}: +${pageRows.length} row(s); raw cumulative ${merged.length}`
          );
        } catch (err) {
          console.warn(`[${sym}]`, err instanceof Error ? err.message : err);
        }
      }
    } else {
      const n = dayDiffInclusive(from!, to!);
      if (n > 400) {
        throw new Error(`Refusing to scrape ${n} days in one run (>400). Split the range.`);
      }

      const firstUrl = buildDayUrl(from!, 0, pageSize);
      await driver.get(firstUrl);
      await waitIfNeeded(firstUrl);

      for (let i = 0; i < n; i += 1) {
        const day = addUtcDays(from!, i);
        let offset = 0;
        for (;;) {
          if (i !== 0 || offset !== 0) {
            const u = buildDayUrl(day, offset, pageSize);
            await waitIfNeeded(u);
            await driver.get(u);
            if (Number.isFinite(delayMs) && delayMs > 0) {
              await new Promise((r) => setTimeout(r, delayMs));
            }
          }
          const pageRows = await scrapeRowsFromLivePage(driver, settleMs, day);
          merged.push(...pageRows);
          console.log(`day ${day} offset ${offset}: ${pageRows.length} rows`);
          if (pageRows.length < pageSize) break;
          offset += pageSize;
        }
      }
    }
  } finally {
    await driver.quit();
  }

  let rows = dedupeYahooCalendarScrapeRows(merged);
  if (symbol || hasBatch) {
    rows = filterByRange(rows, from, to);
  }
  console.log(`Unique symbol+date rows: ${rows.length}`);

  if (rows.length === 0) {
    console.warn('No rows — page may still be consent wall or wrong view.');
  }

  if (dryRun) {
    console.log('Dry run (first 10):', JSON.stringify(rows.slice(0, 10), null, 2));
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

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeConnection();
  process.exit(1);
});
