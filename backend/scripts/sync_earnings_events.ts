import { closeConnection } from '../src/db/connection.js';
import {
  earningsEventService,
  type EarningsSyncProvider,
} from '../src/services/earningsEventService.js';
import {
  researchUniverseService,
  type ResearchUniverseMethodology,
} from '../src/services/researchUniverseService.js';

function getFlag(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
}

function toDayKey(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function uniqueSymbols(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNonNegativeNumberFlag(name: string, fallback: number): number {
  const raw = getFlag(name);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveProviders(): EarningsSyncProvider[] | undefined {
  const rawProviders = getFlag('--providers');
  if (!rawProviders) {
    return undefined;
  }

  const providers = [...new Set(
    rawProviders
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )];

  const supportedProviders: readonly EarningsSyncProvider[] = ['finnhub', 'yahoo'];
  const invalidProviders = providers.filter(
    (provider): provider is string =>
      !supportedProviders.includes(provider as EarningsSyncProvider)
  );
  if (invalidProviders.length > 0) {
    throw new Error(
      `Unsupported earnings providers: ${invalidProviders.join(', ')}. Supported values: ${supportedProviders.join(', ')}.`
    );
  }

  return providers as EarningsSyncProvider[];
}

function resolveMethodology(): ResearchUniverseMethodology {
  const rawMethodology = getFlag('--methodology')?.trim().toLowerCase();
  if (!rawMethodology) {
    return 'static_current_constituents';
  }

  if (
    rawMethodology === 'static_current_constituents' ||
    rawMethodology === 'point_in_time_index'
  ) {
    return rawMethodology;
  }

  throw new Error(
    `Unsupported methodology: ${rawMethodology}. Supported values: static_current_constituents, point_in_time_index.`
  );
}

async function resolveSymbols(input: {
  from: string;
  to: string;
  methodology: ResearchUniverseMethodology;
}): Promise<string[]> {
  const rawSymbols = getFlag('--symbols');
  if (rawSymbols) {
    return uniqueSymbols(rawSymbols.split(','));
  }

  const indexCode = (getFlag('--index-code') ?? 'SP500').trim().toUpperCase();
  const asOfDate = getFlag('--as-of-date') ?? toDayKey(new Date());
  const limit = Number(getFlag('--limit') ?? '');
  const resolvedSymbols = input.methodology === 'point_in_time_index'
    ? await researchUniverseService.resolveSymbolsInRange({
        methodology: input.methodology,
        indexCode,
        fromDate: input.from,
        toDate: input.to,
      })
    : (await researchUniverseService.resolveUniverse({
        methodology: input.methodology,
        indexCode,
        asOfDate,
        priceFilter: 'none',
      })).symbols;

  return Number.isFinite(limit) && limit > 0
    ? resolvedSymbols.slice(0, limit)
    : resolvedSymbols;
}

async function main() {
  const from = getFlag('--from') ?? '2015-01-01';
  const to = getFlag('--to') ?? toDayKey(new Date(Date.now() + 365 * 86_400_000));
  const methodology = resolveMethodology();
  const symbols = await resolveSymbols({ from, to, methodology });
  if (symbols.length === 0) {
    throw new Error(
      'No symbols resolved. Use --symbols=AAPL,MSFT or load constituents first and pass --index-code=SP500.'
    );
  }
  const providers = resolveProviders();
  const delayMs = parseNonNegativeNumberFlag('--delay-ms', 750);
  const batchSize = parseNonNegativeNumberFlag('--batch-size', 25);
  const batchPauseMs = parseNonNegativeNumberFlag('--batch-pause-ms', 4000);

  console.log(
    `Resolved ${symbols.length} symbols using ${methodology} for earnings sync (${from} -> ${to}).`
  );

  let processedSymbols = 0;
  let successfulSymbols = 0;
  let failedSymbols = 0;
  let syncedEvents = 0;

  for (const symbol of symbols) {
    try {
      const result = await earningsEventService.syncSymbolCalendarDetailed(symbol, from, to, {
        providers,
      });
      processedSymbols += 1;
      successfulSymbols += 1;
      syncedEvents += result.upserted;

      const providerSummary = result.providersAttempted.length > 0
        ? result.providersAttempted
            .map((provider) => {
              const events = result.providerEvents[provider] ?? 0;
              const error = result.providerErrors[provider];
              return error
                ? `${provider}:${events} (${error})`
                : `${provider}:${events}`;
            })
            .join(', ')
        : 'no provider attempts';

      console.log(
        `[${processedSymbols}/${symbols.length}] ${symbol}: upserted ${result.upserted} earnings events [${providerSummary}]`
      );
    } catch (error) {
      processedSymbols += 1;
      failedSymbols += 1;
      console.warn(
        `[${processedSymbols}/${symbols.length}] ${symbol}: sync failed - ${error instanceof Error ? error.message : error}`
      );
    }

    if (processedSymbols < symbols.length && delayMs > 0) {
      await sleep(delayMs);
    }

    if (
      batchSize > 0 &&
      batchPauseMs > 0 &&
      processedSymbols < symbols.length &&
      processedSymbols % batchSize === 0
    ) {
      console.log(
        `Pausing ${batchPauseMs}ms after ${processedSymbols} symbols to reduce provider rate-limit pressure...`
      );
      await sleep(batchPauseMs);
    }
  }

  if (successfulSymbols === 0 && failedSymbols > 0) {
    throw new Error(`Earnings sync failed for all ${failedSymbols} processed symbols.`);
  }

  console.log(
    `Earnings sync complete: ${successfulSymbols} succeeded, ${failedSymbols} failed, ${syncedEvents} events upserted (${from} -> ${to}).`
  );
}

main()
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await closeConnection();
  });
