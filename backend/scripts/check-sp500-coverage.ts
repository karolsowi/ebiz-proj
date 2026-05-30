/**
 * One-off: compare hard-coded S&P 500 list vs historical_prices (daily).
 * Run: npx tsx scripts/check-sp500-coverage.ts
 */
import { client, closeConnection } from '../src/db/connection.js';
import { stooqService } from '../src/services/stooqService.js';

async function main() {
  const symbols = stooqService.getSP500Symbols();
  const spSet = new Set(symbols);

  const rows = await client<
    { symbol: string; min_d: Date; max_d: Date; n: number }[]
  >`
    SELECT symbol,
           MIN(date) AS min_d,
           MAX(date) AS max_d,
           COUNT(*)::int AS n
    FROM historical_prices
    WHERE timeframe = 'daily'
    GROUP BY symbol
  `;

  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));

  const noData: string[] = [];
  /** min(date) strictly after 2020-12-31 → no bar in calendar year 2020 */
  const no2020: string[] = [];
  /** min(date) after 2020-01-01 — series starts after start of 2020 */
  const startsAfterJan2020: Array<{ symbol: string; min: string }> = [];

  const cutoff2020End = new Date('2020-12-31T23:59:59.999Z');
  const cutoff2020Start = new Date('2020-01-01T00:00:00.000Z');

  for (const sym of symbols) {
    const r = bySymbol.get(sym);
    if (!r || r.n === 0) {
      noData.push(sym);
      continue;
    }
    const min = new Date(r.min_d);
    const max = new Date(r.max_d);
    if (min > cutoff2020End) {
      no2020.push(sym);
    }
    if (min > cutoff2020Start) {
      startsAfterJan2020.push({ symbol: sym, min: min.toISOString().slice(0, 10) });
    }
  }

  // Symbols in DB daily but not in our SP500 list (extra)
  const extraInDb = rows
    .filter((r) => !spSet.has(r.symbol))
    .map((r) => r.symbol)
    .sort();

  console.log('=== S&P 500 list vs historical_prices (timeframe=daily) ===\n');
  console.log(`S&P list size:     ${symbols.length}`);
  console.log(`Symbols with rows: ${symbols.length - noData.length}`);
  console.log(`Symbols no data:   ${noData.length}`);
  console.log(`Have any bar in 2020 (min ≤ 2020-12-31): ${symbols.length - no2020.length}`);
  console.log(`Missing year 2020 entirely (min > 2020-12-31): ${no2020.length}`);
  console.log(`Min date after 2020-01-01 (late start): ${startsAfterJan2020.length}`);

  const withData = symbols.length - noData.length;
  if (withData > 0) {
    const mins = symbols
      .filter((s) => bySymbol.has(s))
      .map((s) => new Date(bySymbol.get(s)!.min_d).getTime());
    const minMs = Math.min(...mins);
    const maxMs = Math.max(...mins);
    console.log(
      `\nEarliest first-bar among SP500 (that have data): ${new Date(minMs).toISOString().slice(0, 10)}`
    );
    console.log(
      `Latest first-bar among SP500 (that have data):   ${new Date(maxMs).toISOString().slice(0, 10)}`
    );
  }

  if (noData.length) {
    console.log(`\n--- No daily rows (${noData.length}) ---`);
    console.log(noData.slice(0, 80).join(', ') + (noData.length > 80 ? ' …' : ''));
  }
  if (no2020.length) {
    console.log(`\n--- No 2020 data (min > 2020-12-31) (${no2020.length}) ---`);
    console.log(no2020.join(', '));
  }
  if (startsAfterJan2020.length && startsAfterJan2020.length <= 40) {
    console.log('\n--- First bar after 2020-01-01 (subset) ---');
    for (const x of startsAfterJan2020.slice(0, 40)) {
      console.log(`  ${x.symbol}: ${x.min}`);
    }
    if (startsAfterJan2020.length > 40) console.log(`  … +${startsAfterJan2020.length - 40} more`);
  }

  if (extraInDb.length) {
    console.log(`\n--- Daily symbols in DB not in S&P list: ${extraInDb.length} ---`);
    console.log(extraInDb.slice(0, 30).join(', ') + (extraInDb.length > 30 ? ' …' : ''));
  }

  await closeConnection();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
