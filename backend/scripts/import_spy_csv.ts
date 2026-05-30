/**
 * Upsert Yahoo-style SPY CSV (Date,Open,High,Low,Close,Volume,Dividends) into historical_prices.
 *
 * Usage:
 *   npx tsx scripts/import_spy_csv.ts
 *   npx tsx scripts/import_spy_csv.ts ../../SPY.csv
 */
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { fileURLToPath } from 'url';
import { and, eq } from 'drizzle-orm';
import { db, closeConnection } from '../src/db/connection.js';
import { historicalPrices } from '../src/db/schema.js';

const SYMBOL = 'SPY';
const SOURCE = 'yahoo_csv';

type PriceInsert = typeof historicalPrices.$inferInsert;

function calendarDateUtc(raw: string): Date | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  const datePart = trimmed.split(/[\sT]/)[0];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo - 1, d));
}

function rowToInsert(row: Record<string, string>): PriceInsert | null {
  const date = calendarDateUtc(row.Date);
  if (!date || !row.Close) return null;

  const open = Number(row.Open);
  const high = Number(row.High);
  const low = Number(row.Low);
  const close = Number(row.Close);
  const vol = Number(String(row.Volume ?? '').trim());
  const div = Number(String(row.Dividends ?? '0').trim());

  if (Number.isNaN(close)) return null;

  return {
    symbol: SYMBOL,
    date,
    open: Number.isFinite(open) ? open.toFixed(8) : '0',
    high: Number.isFinite(high) ? high.toFixed(8) : '0',
    low: Number.isFinite(low) ? low.toFixed(8) : '0',
    close: close.toFixed(8),
    volume: Number.isFinite(vol) && vol >= 0 ? Math.floor(vol) : null,
    adjustedClose: close.toFixed(8),
    dividendAmount:
      Number.isFinite(div) && div !== 0 ? div.toFixed(8) : null,
    splitCoefficient: null,
    source: SOURCE,
    timeframe: 'daily',
  };
}

async function parseCsv(filePath: string): Promise<PriceInsert[]> {
  const records: PriceInsert[] = [];

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row: Record<string, string>) => {
        const rec = rowToInsert(row);
        if (rec) records.push(rec);
      })
      .on('end', () => resolve())
      .on('error', reject);
  });

  return records;
}

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const defaultPath = path.resolve(__dirname, '..', '..', 'SPY.csv');
  const filePath = path.resolve(process.argv[2] ?? defaultPath);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const records = await parseCsv(filePath);
  console.log(`Parsed ${records.length} valid SPY rows from ${path.basename(filePath)}`);

  await db.transaction(async (tx) => {
    const del = await tx
      .delete(historicalPrices)
      .where(
        and(eq(historicalPrices.symbol, SYMBOL), eq(historicalPrices.timeframe, 'daily'))
      )
      .returning({ id: historicalPrices.id });
    console.log(`Removed ${del.length} existing SPY daily rows before import`);

    const chunkSize = 500;
    for (let i = 0; i < records.length; i += chunkSize) {
      const batch = records.slice(i, i + chunkSize);
      await tx.insert(historicalPrices).values(batch);
      console.log(`Inserted ${Math.min(i + chunkSize, records.length)} / ${records.length}`);
    }
  });

  console.log('Import complete.');
  await closeConnection();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
