/**
 * Import point-in-time index constituent windows into index_constituents.
 *
 * Supported formats:
 * - CSV with columns:
 *   index_code,symbol,effective_from,effective_to,source,metadata
 * - JSON array with the same keys (or camelCase variants)
 *
 * Usage:
 *   npx tsx scripts/import_index_constituents.ts ./data/sp500_membership.csv
 *   npx tsx scripts/import_index_constituents.ts ./data/sp500_membership.csv --index-code=SP500
 *   npx tsx scripts/import_index_constituents.ts ./data/sp500_membership.json --source=wrds_export
 */
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { fileURLToPath } from 'url';
import { db, closeConnection } from '../src/db/connection.js';
import { indexConstituents } from '../src/db/schema.js';

type IndexConstituentInsert = typeof indexConstituents.$inferInsert;

function getFlag(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
}

function normalizeDate(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const day = raw.split(/[T\s]/)[0] ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  const raw = String(value ?? '').trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return { raw };
  }
}

function toRecord(
  row: Record<string, unknown>,
  fallbackIndexCode: string,
  fallbackSource: string
): IndexConstituentInsert | null {
  const indexCode = String(
    row.index_code ?? row.indexCode ?? fallbackIndexCode
  ).trim().toUpperCase();
  const symbol = String(
    row.symbol ?? row.ticker ?? ''
  ).trim().toUpperCase();
  const effectiveFrom = normalizeDate(
    row.effective_from ?? row.effectiveFrom ?? row.start_date ?? row.startDate ?? row.from
  );
  const effectiveTo = normalizeDate(
    row.effective_to ?? row.effectiveTo ?? row.end_date ?? row.endDate ?? row.to
  );
  const source = String(
    row.source ?? fallbackSource
  ).trim() || fallbackSource;

  if (!indexCode || !symbol || !effectiveFrom) {
    return null;
  }

  return {
    indexCode,
    symbol,
    effectiveFrom,
    effectiveTo,
    source,
    metadata: parseMetadata(row.metadata),
  };
}

async function parseCsvFile(
  filePath: string,
  fallbackIndexCode: string,
  fallbackSource: string
): Promise<IndexConstituentInsert[]> {
  const records: IndexConstituentInsert[] = [];

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row: Record<string, unknown>) => {
        const record = toRecord(row, fallbackIndexCode, fallbackSource);
        if (record) records.push(record);
      })
      .on('end', () => resolve())
      .on('error', reject);
  });

  return records;
}

async function parseJsonFile(
  filePath: string,
  fallbackIndexCode: string,
  fallbackSource: string
): Promise<IndexConstituentInsert[]> {
  const raw = await fs.promises.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('JSON constituent import expects an array of rows');
  }

  return parsed
    .map((row) => toRecord(row as Record<string, unknown>, fallbackIndexCode, fallbackSource))
    .filter((row): row is IndexConstituentInsert => row !== null);
}

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error(
      'Usage: npx tsx scripts/import_index_constituents.ts <file.csv|file.json> [--index-code=SP500] [--source=manual]'
    );
    process.exit(1);
  }

  const filePath = path.resolve(__dirname, '..', inputArg);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const fallbackIndexCode = (getFlag('--index-code') ?? 'SP500').trim().toUpperCase();
  const fallbackSource = (getFlag('--source') ?? 'manual_import').trim();
  const ext = path.extname(filePath).toLowerCase();

  const records = ext === '.json'
    ? await parseJsonFile(filePath, fallbackIndexCode, fallbackSource)
    : await parseCsvFile(filePath, fallbackIndexCode, fallbackSource);

  console.log(`Parsed ${records.length} constituent membership rows from ${path.basename(filePath)}`);
  if (records.length === 0) {
    console.warn('No valid rows found.');
    await closeConnection();
    return;
  }

  let upserts = 0;
  for (const record of records) {
    await db.insert(indexConstituents)
      .values(record)
      .onConflictDoUpdate({
        target: [
          indexConstituents.indexCode,
          indexConstituents.symbol,
          indexConstituents.effectiveFrom,
        ],
        set: {
          effectiveTo: record.effectiveTo ?? null,
          source: record.source,
          metadata: record.metadata,
        },
      });
    upserts += 1;
    if (upserts % 500 === 0) {
      console.log(`Upserted ${upserts} / ${records.length}`);
    }
  }

  console.log(`Import complete: ${upserts} rows upserted into index_constituents.`);
  await closeConnection();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await closeConnection();
  process.exit(1);
});
