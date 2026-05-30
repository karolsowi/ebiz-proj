/**
 * Unofficial scraper for Yahoo Finance earnings calendar HTML.
 * Yahoo embeds state in `root.App.main = {...};` — this mirrors the approach used by
 * community tools (e.g. yahoo-earnings-calendar). Yahoo may change layout without notice.
 *
 * Use only where you are allowed to; respect robots / terms and rate-limit requests.
 */

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export interface YahooCalendarScrapeRow {
  symbol: string;
  companyName: string | null;
  /** YYYY-MM-DD (UTC calendar day from Yahoo `startdatetime`) */
  eventDate: string;
  /** Raw Yahoo time type when present (e.g. TAS, BMO, AMC) */
  timeType: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
  epsSurprisePct: number | null;
  raw: Record<string, unknown>;
}

function walkStores(stores: Record<string, unknown>): unknown[] | null {
  const sr = stores.ScreenerResultsStore ?? stores['ScreenerResultsStore'];
  if (!sr || typeof sr !== 'object') return null;
  const results = (sr as Record<string, unknown>).results;
  if (!results || typeof results !== 'object') return null;
  const rows = (results as Record<string, unknown>).rows;
  return Array.isArray(rows) ? rows : null;
}

export function extractRootAppMainJson(html: string): unknown {
  const normalized = html.replace(/\r\n/g, '\n');
  const lower = normalized.toLowerCase();
  const markerEq = 'root.app.main = ';
  const markerBare = 'root.app.main=';
  let idx = lower.indexOf(markerEq);
  if (idx === -1) {
    idx = lower.indexOf(markerBare);
  }

  let line: string | undefined;
  if (idx !== -1) {
    const lineStart = normalized.lastIndexOf('\n', idx) + 1;
    const lineEnd = normalized.indexOf('\n', idx);
    line =
      lineEnd === -1
        ? normalized.slice(lineStart)
        : normalized.slice(lineStart, lineEnd);
  }

  if (!line) {
    const m = normalized.match(/root\.App\.main\s*=\s*(\{)/i);
    if (m?.index !== undefined) {
      const start = m.index + m[0].length - 1;
      line = extractBalancedJsonFrom(normalized, start) ?? undefined;
    }
  }

  if (!line) {
    throw new Error(
      'Could not find embedded root.App.main JSON (Yahoo layout, bot block, or consent wall — try from a desktop browser network, or set YAHOO_COOKIE with a copied Cookie header value).'
    );
  }

  const trimmedLine = line.trim();
  let jsonStr: string;
  if (trimmedLine.startsWith('{')) {
    jsonStr = trimmedLine;
  } else {
    const li = line.toLowerCase();
    const mi = li.indexOf('root.app.main');
    const cutFrom = mi === -1 ? line.indexOf('=') : line.indexOf('=', mi);
    if (cutFrom === -1) {
      throw new Error('Could not locate assignment in root.App.main line.');
    }
    jsonStr = line.slice(cutFrom + 1).trim();
  }
  if (jsonStr.endsWith(';')) jsonStr = jsonStr.slice(0, -1);
  const scriptClose = jsonStr.indexOf('</script>');
  if (scriptClose !== -1) {
    jsonStr = jsonStr.slice(0, scriptClose).trim();
    if (jsonStr.endsWith(';')) jsonStr = jsonStr.slice(0, -1).trim();
  }
  try {
    return JSON.parse(jsonStr) as unknown;
  } catch {
    const brace = jsonStr.indexOf('{');
    if (brace === -1) {
      throw new Error('Failed to parse root.App.main JSON payload.');
    }
    const balanced = extractBalancedJsonFrom(jsonStr, brace);
    if (!balanced) {
      throw new Error('Failed to parse root.App.main JSON payload.');
    }
    return JSON.parse(balanced) as unknown;
  }
}

/** Best-effort brace matching from first `{` (for minified one-line pages). */
function extractBalancedJsonFrom(s: string, startBrace: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startBrace; i < s.length; i += 1) {
    const c = s[i]!;
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === '\\') {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') depth += 1;
    if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        return s.slice(startBrace, i + 1);
      }
    }
  }
  return null;
}

export function calendarRowsFromRootApp(root: unknown): unknown[] {
  const r = root as Record<string, unknown>;
  const ctx = r.context as Record<string, unknown> | undefined;
  const disp = ctx?.dispatcher as Record<string, unknown> | undefined;
  const stores = disp?.stores as Record<string, unknown> | undefined;
  if (!stores) {
    const keys = r && typeof r === 'object' ? Object.keys(r).slice(0, 20).join(', ') : '';
    throw new Error(`Unexpected root.App.main shape (no context.dispatcher.stores). Keys: ${keys}`);
  }
  const rows = walkStores(stores);
  if (!rows) {
    const storeKeys = Object.keys(stores).slice(0, 40).join(', ');
    throw new Error(`No ScreenerResultsStore.results.rows in stores. Store keys: ${storeKeys}`);
  }
  return rows;
}

function pickString(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function pickNumber(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function startDateTimeToUtcDay(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

export function mapRowToScrapeRow(row: unknown): YahooCalendarScrapeRow | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as Record<string, unknown>;
  const symbolRaw =
    pickString(o, 'ticker', 'symbol') ?? pickString(o, 'Ticker', 'Symbol');
  if (!symbolRaw) return null;
  const symbol = symbolRaw.toUpperCase().replace(/\./g, '-');

  const start =
    pickString(o, 'startdatetime', 'startDateTime', 'startDate') ??
    (typeof o.startdatetime === 'string' ? o.startdatetime : null);
  const eventDate = startDateTimeToUtcDay(start);
  if (!eventDate) return null;

  return {
    symbol,
    companyName: pickString(o, 'companyshortname', 'companyShortName', 'companyname'),
    eventDate,
    timeType: pickString(o, 'startdatetimetype', 'startDateTimeType', 'timeType'),
    epsEstimate: pickNumber(o, 'epsestimate', 'epsEstimate'),
    epsActual: pickNumber(o, 'epsactual', 'epsActual'),
    epsSurprisePct: pickNumber(o, 'epssurprisepct', 'epsSurprisePct'),
    raw: o,
  };
}

export interface FetchCalendarHtmlOptions {
  userAgent?: string;
  signal?: AbortSignal;
}

export async function fetchCalendarHtml(
  url: string,
  options: FetchCalendarHtmlOptions = {}
): Promise<string> {
  const init: RequestInit = {
    redirect: 'follow',
    headers: {
      'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };
  const cookie = process.env.YAHOO_COOKIE?.trim();
  if (cookie) {
    (init.headers as Record<string, string>).Cookie = cookie;
  }
  if (options.signal) {
    init.signal = options.signal;
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`Yahoo calendar HTTP ${res.status} for ${url}`);
  }
  return res.text();
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

/**
 * Paginated earnings for a single calendar day (all symbols Yahoo lists that day).
 */
export async function scrapeEarningsForDay(
  day: string,
  options: { pageSize?: number; delayMs?: number } = {}
): Promise<YahooCalendarScrapeRow[]> {
  const pageSize = options.pageSize ?? 100;
  const delayMs = options.delayMs ?? 0;
  const out: YahooCalendarScrapeRow[] = [];
  let offset = 0;

  for (;;) {
    const url = buildDayUrl(day, offset, pageSize);
    const html = await fetchCalendarHtml(url);
    const root = extractRootAppMainJson(html);
    const rawRows = calendarRowsFromRootApp(root);
    const mapped = rawRows
      .map(mapRowToScrapeRow)
      .filter((r): r is YahooCalendarScrapeRow => r !== null);
    out.push(...mapped);
    if (mapped.length < pageSize) break;
    offset += pageSize;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  return dedupeRows(out);
}

/**
 * All earnings rows Yahoo exposes for one ticker on the symbol calendar view.
 */
export async function scrapeEarningsForSymbol(
  symbol: string,
  options: { delayMs?: number } = {}
): Promise<YahooCalendarScrapeRow[]> {
  const url = buildSymbolUrl(symbol);
  const html = await fetchCalendarHtml(url);
  const root = extractRootAppMainJson(html);
  const rawRows = calendarRowsFromRootApp(root);
  const mapped = rawRows
    .map(mapRowToScrapeRow)
    .filter((r): r is YahooCalendarScrapeRow => r !== null);
  if (options.delayMs && options.delayMs > 0) {
    await new Promise((r) => setTimeout(r, options.delayMs));
  }
  return dedupeRows(mapped);
}

/** Map already-parsed `root.App.main` into scrape rows (used by Selenium live-page reads). */
export function scrapeRowsFromRootAppMain(root: unknown): YahooCalendarScrapeRow[] {
  const rawRows = calendarRowsFromRootApp(root);
  const mapped = rawRows
    .map(mapRowToScrapeRow)
    .filter((r): r is YahooCalendarScrapeRow => r !== null);
  return dedupeRows(mapped);
}

/**
 * Parse already-fetched Yahoo earnings calendar HTML (e.g. from Selenium after manual consent).
 */
export function scrapeRowsFromHtml(html: string): YahooCalendarScrapeRow[] {
  const root = extractRootAppMainJson(html);
  return scrapeRowsFromRootAppMain(root);
}

export function dedupeYahooCalendarScrapeRows(
  rows: YahooCalendarScrapeRow[]
): YahooCalendarScrapeRow[] {
  return dedupeRows(rows);
}

function dedupeRows(rows: YahooCalendarScrapeRow[]): YahooCalendarScrapeRow[] {
  const seen = new Set<string>();
  const out: YahooCalendarScrapeRow[] = [];
  for (const row of rows) {
    const k = `${row.symbol}:${row.eventDate}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

/**
 * Yahoo calendar cells use labels like `May 20, 2026 at 4 PM EDT`. Node’s `Date.parse` returns
 * `NaN` when the hour has no minutes (`4 PM`); inserting `:00` matches typical browser parsing.
 */
export function normalizeYahooEarningsDatetimeLabelForParse(label: string): string {
  return String(label ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ at /g, ' ')
    .replace(/\b(\d{1,2})\s+(AM|PM)\b/gi, (_, h, ap) => `${h}:00 ${ap}`);
}

/** `YYYY-MM-DD` from a Yahoo table `startdatetime` cell (same day logic as the Selenium path). */
export function eventDateFromYahooCalendarDatetimeLabel(label: string): string | null {
  const normalized = normalizeYahooEarningsDatetimeLabelForParse(label);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

/** One row from Yahoo’s rendered earnings table (`data-table-v2-row` / `data-testid-cell`). */
export interface YahooCalendarDomExtractedRow {
  symbol: string;
  companyName: string | null;
  eventDate: string;
  epsEstimate: number | null;
  epsActual: number | null;
  epsSurprisePct: number | null;
}

/** Map browser-extracted table rows into the same shape as `root.App.main` scraping. */
export function mapDomExtractedToScrapeRows(rows: YahooCalendarDomExtractedRow[]): YahooCalendarScrapeRow[] {
  const out: YahooCalendarScrapeRow[] = [];
  for (const r of rows) {
    const symbol = String(r.symbol ?? '')
      .trim()
      .toUpperCase()
      .replace(/\./g, '-');
    const eventDate = String(r.eventDate ?? '').trim();
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) continue;
    const epsEstimate =
      typeof r.epsEstimate === 'number' && Number.isFinite(r.epsEstimate) ? r.epsEstimate : null;
    const epsActual =
      typeof r.epsActual === 'number' && Number.isFinite(r.epsActual) ? r.epsActual : null;
    const epsSurprisePct =
      typeof r.epsSurprisePct === 'number' && Number.isFinite(r.epsSurprisePct)
        ? r.epsSurprisePct
        : null;
    out.push({
      symbol,
      companyName: r.companyName ?? null,
      eventDate,
      timeType: null,
      epsEstimate,
      epsActual,
      epsSurprisePct,
      raw: {
        source: 'yahoo_dom_calendar_v2',
        symbol: r.symbol,
        companyName: r.companyName,
        eventDate: r.eventDate,
        epsEstimate,
        epsActual,
        epsSurprisePct,
      },
    });
  }
  return dedupeRows(out);
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

/**
 * Iterate each calendar day in [from, to] (inclusive) and merge rows.
 */
export async function scrapeEarningsDateRange(
  from: string,
  to: string,
  options: { pageSize?: number; delayMs?: number; onProgress?: (msg: string) => void } = {}
): Promise<YahooCalendarScrapeRow[]> {
  if (from > to) throw new Error(`from (${from}) must be <= to (${to})`);
  const n = dayDiffInclusive(from, to);
  if (n > 400) {
    throw new Error(`Refusing to scrape ${n} days in one run (>400). Split the range.`);
  }

  const merged: YahooCalendarScrapeRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const day = addUtcDays(from, i);
    options.onProgress?.(`day ${day} (${i + 1}/${n})`);
    const rows = await scrapeEarningsForDay(day, options);
    merged.push(...rows);
    if (options.delayMs && options.delayMs > 0) {
      await new Promise((r) => setTimeout(r, options.delayMs));
    }
  }
  return dedupeRows(merged);
}
