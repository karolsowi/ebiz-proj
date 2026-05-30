/**
 * Full Stooq EOD download for S&P 500 names that are missing daily rows
 * or whose earliest bar is after 2020-12-31 (no coverage in calendar 2020).
 *
 * Stooq often requires STOOQ_API_KEY in backend/.env for CSV.
 * Open: https://stooq.pl/q/d/?s=aapl.us&get_apikey
 *
 * Run:  npx tsx scripts/backfill-sp500-gaps.ts
 * Dry:  npx tsx scripts/backfill-sp500-gaps.ts --dry-run
 * Tune: npx tsx scripts/backfill-sp500-gaps.ts --delay=1500
 */
import { client, closeConnection } from '../src/db/connection.js';
import { stooqService } from '../src/services/stooqService.js';

function parseArgs() {
  let dryRun = false;
  let delayMs = 1000;
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') dryRun = true;
    if (a.startsWith('--delay=')) {
      const n = parseInt(a.slice('--delay='.length), 10);
      if (Number.isFinite(n) && n >= 0) delayMs = n;
    }
  }
  return { dryRun, delayMs };
}

async function getGapSymbols(): Promise<string[]> {
  const symbols = stooqService.getSP500Symbols();

  const rows = await client<{ symbol: string; min_d: Date; n: number }[]>`
    SELECT symbol, MIN(date) AS min_d, COUNT(*)::int AS n
    FROM historical_prices
    WHERE timeframe = 'daily'
    GROUP BY symbol
  `;

  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  const cutoff = new Date('2020-12-31T23:59:59.999Z');

  const needs = new Set<string>();
  for (const sym of symbols) {
    const r = bySymbol.get(sym);
    if (!r || r.n === 0) {
      needs.add(sym);
      continue;
    }
    if (new Date(r.min_d) > cutoff) {
      needs.add(sym);
    }
  }

  return [...needs].sort();
}

async function main() {
  const { dryRun, delayMs } = parseArgs();

  if (!dryRun && !process.env.STOOQ_API_KEY?.trim()) {
    console.warn(
      '\n⚠️  STOOQ_API_KEY is not set in backend/.env.\n' +
        '   Without it, Stooq usually returns no CSV rows (see stooqService gate message).\n' +
        '   Get a key: https://stooq.pl/q/d/?s=aapl.us&get_apikey\n'
    );
  }

  const symbols = await getGapSymbols();
  console.log(
    `Backfill queue: ${symbols.length} symbols (no daily rows OR MIN(date) > 2020-12-31)\n`
  );

  if (symbols.length === 0) {
    console.log('Nothing to do.');
    await closeConnection();
    return;
  }

  if (dryRun) {
    console.log(symbols.join(', '));
    await closeConnection();
    return;
  }

  let ok = 0;
  let fail = 0;
  let totalAdded = 0;

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i]!;
    const label = `[${i + 1}/${symbols.length}] ${sym}`;
    process.stdout.write(`${label} … `);

    try {
      const result = await stooqService.downloadAndStoreHistoricalData(sym);
      if (result.success) {
        ok++;
        totalAdded += result.recordsAdded;
        console.log(`OK  +${result.recordsAdded} rows (${result.recordsSkipped} unchanged/skipped)`);
      } else {
        fail++;
        console.log('FAIL (service returned success=false)');
      }
    } catch (e) {
      fail++;
      console.log(`ERR ${e instanceof Error ? e.message : String(e)}`);
    }

    if (i < symbols.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  console.log(`\nFinished: ${ok} succeeded, ${fail} failed, ~${totalAdded} new rows inserted (see per-symbol +counts).`);
  await closeConnection();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
