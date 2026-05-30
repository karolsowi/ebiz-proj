import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { historicalPrices, indexConstituents } from '../db/schema.js';
import { stooqService } from './stooqService.js';

export const RESEARCH_UNIVERSE_METHODS = [
  'static_current_constituents',
  'point_in_time_index',
] as const;
export type ResearchUniverseMethodology = (typeof RESEARCH_UNIVERSE_METHODS)[number];

export const RESEARCH_UNIVERSE_PRICE_FILTERS = [
  'none',
  'has_price_as_of_date',
  'min_history',
] as const;
export type ResearchUniversePriceFilter = (typeof RESEARCH_UNIVERSE_PRICE_FILTERS)[number];

export interface ResearchUniverseSelection {
  methodology?: ResearchUniverseMethodology;
  indexCode?: string;
  asOfDate: string;
  priceFilter?: ResearchUniversePriceFilter;
  minHistoryTradingDays?: number;
}

/** Default research backtest universe: SP500 members as of `startDate`, price-history filtered. */
export function buildDefaultPointInTimeUniverseSelection(
  startDate: string
): ResearchUniverseSelection {
  return {
    methodology: 'point_in_time_index',
    indexCode: 'SP500',
    asOfDate: startDate,
    priceFilter: 'min_history',
    minHistoryTradingDays: 60,
  };
}

export interface ResearchUniverseWindowSelection {
  methodology?: ResearchUniverseMethodology;
  indexCode?: string;
  fromDate: string;
  toDate: string;
}

export interface ResearchUniverseDiagnostics {
  methodology: ResearchUniverseMethodology;
  indexCode: string;
  asOfDate: string;
  priceFilter: ResearchUniversePriceFilter;
  minHistoryTradingDays: number;
  totalConstituents: number;
  resolvedSymbols: number;
  excludedForPriceData: number;
  coverageStatus: 'point_in_time' | 'static_survivorship_biased';
  notes: string[];
  excludedSymbolsSample: string[];
}

export interface ResolvedResearchUniverse {
  symbols: string[];
  diagnostics: ResearchUniverseDiagnostics;
}

export interface UniverseResolveProgressEvent {
  step: string;
  stepIndex: number;
  stepTotal: number;
  message: string;
}

export type UniverseResolveProgressCallback = (event: UniverseResolveProgressEvent) => void;

export interface IndexConstituentCoverageSummary {
  indexCode: string;
  totalRows: number;
  uniqueSymbols: number;
  earliestEffectiveFrom: string | null;
  latestEffectiveFrom: string | null;
  openEndedRows: number;
  currentConstituentCount: number;
}

interface PriceCoverageRow {
  symbol: string;
  firstDate: string;
  latestDate: string;
  tradingDays: number;
}

function normalizeSymbols(symbols: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const symbol of symbols) {
    const candidate = symbol.trim().toUpperCase();
    if (!candidate || candidate.length > 16 || seen.has(candidate)) continue;
    seen.add(candidate);
    normalized.push(candidate);
  }

  return normalized;
}

function normalizeIndexCode(value?: string): string {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized.length > 0 ? normalized : 'SP500';
}

function assertAsOfDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid asOfDate "${value}". Expected YYYY-MM-DD.`);
  }
  return value;
}

function assertDateRange(fromDateInput: string, toDateInput: string): {
  fromDate: string;
  toDate: string;
} {
  const fromDate = assertAsOfDate(fromDateInput);
  const toDate = assertAsOfDate(toDateInput);

  if (fromDate > toDate) {
    throw new Error(
      `Invalid date range "${fromDate}" -> "${toDate}". Expected fromDate <= toDate.`
    );
  }

  return { fromDate, toDate };
}

export class ResearchUniverseService {
  private async getPointInTimeConstituents(
    indexCode: string,
    asOfDate: string
  ): Promise<string[]> {
    const rows = await db
      .select({ symbol: indexConstituents.symbol })
      .from(indexConstituents)
      .where(and(
        eq(indexConstituents.indexCode, indexCode),
        lte(indexConstituents.effectiveFrom, asOfDate),
        or(
          isNull(indexConstituents.effectiveTo),
          gte(indexConstituents.effectiveTo, asOfDate)
        )
      ));

    return normalizeSymbols(rows.map((row) => row.symbol));
  }

  private async getPointInTimeConstituentsInRange(
    indexCode: string,
    fromDate: string,
    toDate: string
  ): Promise<string[]> {
    const rows = await db
      .select({ symbol: indexConstituents.symbol })
      .from(indexConstituents)
      .where(and(
        eq(indexConstituents.indexCode, indexCode),
        lte(indexConstituents.effectiveFrom, toDate),
        or(
          isNull(indexConstituents.effectiveTo),
          gte(indexConstituents.effectiveTo, fromDate)
        )
      ));

    return normalizeSymbols(rows.map((row) => row.symbol));
  }

  private async getPriceCoverage(
    symbols: string[],
    asOfDate: string
  ): Promise<Map<string, PriceCoverageRow>> {
    if (symbols.length === 0) return new Map();

    const endOfDay = new Date(`${asOfDate}T23:59:59.999Z`);
    const rows = await db
      .select({
        symbol: historicalPrices.symbol,
        firstDate: sql<string>`MIN(${historicalPrices.date})::date::text`,
        latestDate: sql<string>`MAX(${historicalPrices.date})::date::text`,
        tradingDays: sql<number>`COUNT(*)::int`,
      })
      .from(historicalPrices)
      .where(and(
        inArray(historicalPrices.symbol, symbols),
        eq(historicalPrices.timeframe, 'daily'),
        lte(historicalPrices.date, endOfDay)
      ))
      .groupBy(historicalPrices.symbol);

    return new Map(rows.map((row) => [row.symbol.toUpperCase(), {
      symbol: row.symbol.toUpperCase(),
      firstDate: row.firstDate,
      latestDate: row.latestDate,
      tradingDays: Number(row.tradingDays),
    }]));
  }

  async resolveUniverse(
    selection: ResearchUniverseSelection,
    onProgress?: UniverseResolveProgressCallback
  ): Promise<ResolvedResearchUniverse> {
    const stepTotal = 3;
    const emit = (stepIndex: number, step: string, message: string) => {
      onProgress?.({ step, stepIndex, stepTotal, message });
    };

    const methodology = selection.methodology ?? 'static_current_constituents';
    const indexCode = normalizeIndexCode(selection.indexCode);
    const asOfDate = assertAsOfDate(selection.asOfDate);
    const priceFilter = selection.priceFilter ?? 'has_price_as_of_date';
    const minHistoryTradingDays = Math.max(
      1,
      Math.floor(selection.minHistoryTradingDays ?? 60)
    );

    emit(1, 'constituents', `Loading ${indexCode} constituents as of ${asOfDate}...`);

    let baseSymbols: string[];
    const notes: string[] = [];
    let coverageStatus: ResearchUniverseDiagnostics['coverageStatus'];

    if (methodology === 'point_in_time_index') {
      baseSymbols = await this.getPointInTimeConstituents(indexCode, asOfDate);
      coverageStatus = 'point_in_time';
      notes.push(
        `Universe resolved from point-in-time ${indexCode} constituent history as of ${asOfDate}.`
      );

      if (baseSymbols.length === 0) {
        throw new Error(
          `No point-in-time constituents found for ${indexCode} as of ${asOfDate}. ` +
            'Load historical membership rows into index_constituents before using academic universe mode.'
        );
      }
    } else {
      baseSymbols = normalizeSymbols(stooqService.getSP500Symbols());
      coverageStatus = 'static_survivorship_biased';
      notes.push(
        'Universe resolved from the static current constituent list. This remains survivorship-biased and is not point-in-time safe.'
      );
    }

    emit(
      2,
      'price_coverage',
      `Checking daily price history for ${baseSymbols.length} symbols (may take 1-3 min)...`
    );

    const coverage = await this.getPriceCoverage(baseSymbols, asOfDate);

    emit(3, 'filter', `Applying ${priceFilter} eligibility filter...`);

    const resolvedSymbols = baseSymbols.filter((symbol) => {
      const row = coverage.get(symbol);
      if (!row) return false;
      if (priceFilter === 'none') return true;
      if (priceFilter === 'has_price_as_of_date') return true;
      return row.tradingDays >= minHistoryTradingDays;
    });
    const excludedSymbols = baseSymbols.filter((symbol) => !resolvedSymbols.includes(symbol));

    if (priceFilter === 'min_history') {
      notes.push(
        `Filtered constituents to symbols with at least ${minHistoryTradingDays} daily bars on or before ${asOfDate}.`
      );
    } else if (priceFilter === 'has_price_as_of_date') {
      notes.push(
        `Filtered constituents to symbols with at least one daily price on or before ${asOfDate}.`
      );
    } else {
      notes.push('No price-history eligibility filter was applied to the constituent list.');
    }

    if (resolvedSymbols.length === 0) {
      throw new Error(
        `Universe resolution produced 0 symbols for ${indexCode} as of ${asOfDate}. ` +
          'Check constituent coverage and price-history availability.'
      );
    }

    return {
      symbols: resolvedSymbols,
      diagnostics: {
        methodology,
        indexCode,
        asOfDate,
        priceFilter,
        minHistoryTradingDays,
        totalConstituents: baseSymbols.length,
        resolvedSymbols: resolvedSymbols.length,
        excludedForPriceData: excludedSymbols.length,
        coverageStatus,
        notes,
        excludedSymbolsSample: excludedSymbols.slice(0, 25),
      },
    };
  }

  async resolveSymbolsInRange(
    selection: ResearchUniverseWindowSelection
  ): Promise<string[]> {
    const methodology = selection.methodology ?? 'static_current_constituents';
    const indexCode = normalizeIndexCode(selection.indexCode);
    const { fromDate, toDate } = assertDateRange(
      selection.fromDate,
      selection.toDate
    );

    if (methodology === 'point_in_time_index') {
      const symbols = await this.getPointInTimeConstituentsInRange(
        indexCode,
        fromDate,
        toDate
      );

      if (symbols.length === 0) {
        throw new Error(
          `No point-in-time constituents found for ${indexCode} overlapping ${fromDate} -> ${toDate}.`
        );
      }

      return symbols;
    }

    return normalizeSymbols(stooqService.getSP500Symbols());
  }

  async getIndexCoverageSummary(indexCodeInput?: string): Promise<IndexConstituentCoverageSummary> {
    const indexCode = normalizeIndexCode(indexCodeInput);
    const today = new Date().toISOString().slice(0, 10);
    const summaryRows = await db
      .select({
        totalRows: sql<number>`COUNT(*)::int`,
        uniqueSymbols: sql<number>`COUNT(DISTINCT ${indexConstituents.symbol})::int`,
        earliestEffectiveFrom: sql<string | null>`MIN(${indexConstituents.effectiveFrom})`,
        latestEffectiveFrom: sql<string | null>`MAX(${indexConstituents.effectiveFrom})`,
        openEndedRows: sql<number>`COUNT(*) FILTER (WHERE ${indexConstituents.effectiveTo} IS NULL)::int`,
      })
      .from(indexConstituents)
      .where(eq(indexConstituents.indexCode, indexCode));

    const currentRows = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${indexConstituents.symbol})::int` })
      .from(indexConstituents)
      .where(and(
        eq(indexConstituents.indexCode, indexCode),
        lte(indexConstituents.effectiveFrom, today),
        or(
          isNull(indexConstituents.effectiveTo),
          gte(indexConstituents.effectiveTo, today)
        )
      ));

    const summary = summaryRows[0];
    return {
      indexCode,
      totalRows: Number(summary?.totalRows ?? 0),
      uniqueSymbols: Number(summary?.uniqueSymbols ?? 0),
      earliestEffectiveFrom: summary?.earliestEffectiveFrom ?? null,
      latestEffectiveFrom: summary?.latestEffectiveFrom ?? null,
      openEndedRows: Number(summary?.openEndedRows ?? 0),
      currentConstituentCount: Number(currentRows[0]?.count ?? 0),
    };
  }
}

export const researchUniverseService = new ResearchUniverseService();
