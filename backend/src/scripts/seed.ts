import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import {
  users,
  historicalPrices,
  portfolioEntries,
  watchlist,
  userSettings,
} from '../db/schema.js';
import { DEMO_USER_ID } from '../constants/integration.js';
import { importIntegrationKeysFromEnv } from '../services/integrationKeysFromEnv.js';

const DEMO_EMAIL = 'demo@demo.com';
const DEMO_PASSWORD = 'Demo1234!';
const symbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN'];

async function main() {
  console.log('Starting database seeding...');

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  await db
    .insert(users)
    .values({
      id: DEMO_USER_ID,
      email: DEMO_EMAIL,
      firstName: 'Demo',
      lastName: 'User',
      passwordHash,
      role: 'user',
      emailVerified: true,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash,
        firstName: 'Demo',
        lastName: 'User',
        emailVerified: true,
      },
    });

  await db.delete(portfolioEntries).where(eq(portfolioEntries.userId, DEMO_USER_ID));
  await db.delete(watchlist).where(eq(watchlist.userId, DEMO_USER_ID));

  await db
    .insert(userSettings)
    .values({
      userId: DEMO_USER_ID,
      theme: 'system',
      language: 'en',
      timezone: 'Europe/Warsaw',
      currency: 'USD',
      paperTradingMode: true,
    })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        timezone: 'Europe/Warsaw',
        language: 'en',
        paperTradingMode: true,
        updatedAt: new Date(),
      },
    });

  const priceDataEntries = [];
  for (const symbol of symbols) {
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const basePrice = Math.random() * 200 + 50;
      const open = basePrice + (Math.random() - 0.5) * 10;
      const close = open + (Math.random() - 0.5) * 15;
      const high = Math.max(open, close) + Math.random() * 5;
      const low = Math.min(open, close) - Math.random() * 5;
      priceDataEntries.push({
        symbol,
        date,
        open: open.toString(),
        close: close.toString(),
        high: high.toString(),
        low: low.toString(),
        volume: Math.floor(Math.random() * 10000000) + 1000000,
        source: 'seed',
      });
    }
  }

  for (const symbol of symbols) {
    await db.delete(historicalPrices).where(eq(historicalPrices.symbol, symbol));
  }
  await db.insert(historicalPrices).values(priceDataEntries);

  await db.insert(portfolioEntries).values([
    {
      userId: DEMO_USER_ID,
      symbol: 'AAPL',
      name: 'Apple Inc.',
      quantity: '10',
      averageCost: '175.50',
      currentPrice: '190.00',
      totalValue: '1900.00',
      assetType: 'stock',
      source: 'seed',
    },
    {
      userId: DEMO_USER_ID,
      symbol: 'MSFT',
      name: 'Microsoft Corp.',
      quantity: '5',
      averageCost: '380.00',
      currentPrice: '410.00',
      totalValue: '2050.00',
      assetType: 'stock',
      source: 'seed',
    },
  ]);

  await db.insert(watchlist).values([
    { userId: DEMO_USER_ID, symbol: 'GOOGL', name: 'Alphabet Inc.' },
    { userId: DEMO_USER_ID, symbol: 'TSLA', name: 'Tesla Inc.', notes: 'Watch for volatility' },
  ]);

  const keysImported = await importIntegrationKeysFromEnv(DEMO_USER_ID);
  if (keysImported > 0) {
    console.log(`Imported ${keysImported} API key set(s) from environment for demo user.`);
  }

  console.log('Database seeding completed.');
  console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
