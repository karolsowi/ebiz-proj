// Ensure environment variables are loaded
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Database connection configuration
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:default@localhost:5432/inwest_db';
console.log('🔑 Database connecting to:', connectionString.replace(/:[^:@]*@/, ':***@'));

// Create PostgreSQL connection with faster timeouts for development
const client = postgres(connectionString, {
  max: Number(process.env.DB_POOL_MAX ?? 25),
  idle_timeout: 20, // Close idle connections after 20 seconds
  connect_timeout: 3, // Reduced connection timeout to 3 seconds for faster startup
  prepare: false, // Disable prepared statements for faster connection
  onnotice: () => { }, // Disable notices for cleaner logs
});

// Create Drizzle database instance
export const db = drizzle(client, { schema });

// Export the client for direct access
export { client };

// Export types for use in other files
export type Database = typeof db;

// Utility function to close database connection
export const closeConnection = async () => {
  await client.end();
};

// Health check function with timeout
export const checkDatabaseConnection = async (): Promise<boolean> => {
  try {
    // Use a promise with timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Database connection timeout')), 2000)
    );

    const connectionPromise = client`SELECT 1`;

    await Promise.race([connectionPromise, timeoutPromise]);
    return true;
  } catch (error) {
    console.warn('Database connection failed (this is normal if PostgreSQL is not running):', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}; 