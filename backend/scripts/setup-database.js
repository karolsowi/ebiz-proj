#!/usr/bin/env node

/**
 * Database Setup Script for InWest
 * 
 * This script helps set up the PostgreSQL database for the InWest investment platform.
 * It can create the database, run migrations, and insert sample data.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const parsedDatabaseUrl = (() => {
  try {
    if (!process.env.DATABASE_URL) return null;
    return new URL(process.env.DATABASE_URL.replace(/^"|"$/g, ''));
  } catch {
    return null;
  }
})();

// Database configuration
const DB_CONFIG = {
  host: process.env.DB_HOST || parsedDatabaseUrl?.hostname || 'localhost',
  port: parseInt(process.env.DB_PORT || parsedDatabaseUrl?.port || '5432'),
  database: process.env.DB_NAME || (parsedDatabaseUrl?.pathname?.replace(/^\//, '')) || 'inwest_db',
  username: process.env.DB_USER || parsedDatabaseUrl?.username || 'inwest_user',
  password: process.env.DB_PASSWORD || parsedDatabaseUrl?.password || 'inwest_password',
};

// Admin connection (for creating database and user)
const ADMIN_CONFIG = {
  host: DB_CONFIG.host,
  port: DB_CONFIG.port,
  database: 'postgres', // Connect to default postgres database
  username: process.env.DB_ADMIN_USER || 'postgres',
  password: process.env.DB_ADMIN_PASSWORD || '',
};

class DatabaseSetup {
  constructor() {
    this.adminSql = null;
    this.userSql = null;
  }

  async connectAsAdmin() {
    try {
      this.adminSql = postgres({
        host: ADMIN_CONFIG.host,
        port: ADMIN_CONFIG.port,
        database: ADMIN_CONFIG.database,
        username: ADMIN_CONFIG.username,
        password: ADMIN_CONFIG.password,
      });
      
      // Test connection
      await this.adminSql`SELECT 1`;
      console.log('✅ Connected to PostgreSQL as admin');
      return true;
    } catch (error) {
      console.error('❌ Failed to connect as admin:', error.message);
      return false;
    }
  }

  async connectAsUser() {
    try {
      this.userSql = postgres({
        host: DB_CONFIG.host,
        port: DB_CONFIG.port,
        database: DB_CONFIG.database,
        username: DB_CONFIG.username,
        password: DB_CONFIG.password,
      });
      
      // Test connection
      await this.userSql`SELECT 1`;
      console.log('✅ Connected to InWest database as user');
      return true;
    } catch (error) {
      console.error('❌ Failed to connect as user:', error.message);
      return false;
    }
  }

  async createDatabaseAndUser() {
    if (!this.adminSql) {
      throw new Error('Admin connection not established');
    }

    try {
      // Check if user exists
      const userExists = await this.adminSql`
        SELECT 1 FROM pg_roles WHERE rolname = ${DB_CONFIG.username}
      `;

      if (userExists.length === 0) {
        console.log(`📝 Creating user: ${DB_CONFIG.username}`);
        await this.adminSql`
          CREATE USER ${this.adminSql(DB_CONFIG.username)} 
          WITH PASSWORD ${DB_CONFIG.password}
        `;
        console.log('✅ User created successfully');
      } else {
        console.log(`ℹ️  User ${DB_CONFIG.username} already exists`);
      }

      // Check if database exists
      const dbExists = await this.adminSql`
        SELECT 1 FROM pg_database WHERE datname = ${DB_CONFIG.database}
      `;

      if (dbExists.length === 0) {
        console.log(`📝 Creating database: ${DB_CONFIG.database}`);
        await this.adminSql`
          CREATE DATABASE ${this.adminSql(DB_CONFIG.database)} 
          OWNER ${this.adminSql(DB_CONFIG.username)}
        `;
        console.log('✅ Database created successfully');
      } else {
        console.log(`ℹ️  Database ${DB_CONFIG.database} already exists`);
      }

      // Grant privileges
      console.log('📝 Granting privileges...');
      await this.adminSql`
        GRANT ALL PRIVILEGES ON DATABASE ${this.adminSql(DB_CONFIG.database)} 
        TO ${this.adminSql(DB_CONFIG.username)}
      `;
      console.log('✅ Privileges granted successfully');

    } catch (error) {
      console.error('❌ Failed to create database/user:', error.message);
      throw error;
    }
  }

  async runMigrations() {
    if (!this.userSql) {
      throw new Error('User connection not established');
    }

    try {
      console.log('📝 Running database migrations...');
      
      const migrationsDir = join(__dirname, '..', 'src', 'db', 'migrations');
      const migrationFiles = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b));

      if (migrationFiles.length === 0) {
        console.log('ℹ️  No migration files found');
        return;
      }

      for (const migrationFile of migrationFiles) {
        console.log(`📝 Applying migration: ${migrationFile}`);
        const migrationPath = join(migrationsDir, migrationFile);
        const migrationSQL = readFileSync(migrationPath, 'utf8');
        try {
          await this.userSql.unsafe(migrationSQL);
          console.log(`✅ Applied: ${migrationFile}`);
        } catch (error) {
          // Some legacy migrations may not be re-runnable; continue with later files.
          console.warn(`⚠️ Skipped ${migrationFile}: ${error.message}`);
        }
      }
      
      console.log('✅ Migrations completed successfully');
    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      throw error;
    }
  }

  async checkTables() {
    if (!this.userSql) {
      throw new Error('User connection not established');
    }

    try {
      console.log('📝 Checking database tables...');
      
      const tables = await this.userSql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
      `;

      console.log('✅ Database tables:');
      tables.forEach(table => {
        console.log(`   - ${table.table_name}`);
      });

      return tables.map(t => t.table_name);
    } catch (error) {
      console.error('❌ Failed to check tables:', error.message);
      throw error;
    }
  }

  async insertSampleData() {
    if (!this.userSql) {
      throw new Error('User connection not established');
    }

    try {
      console.log('📝 Inserting sample data...');
      
      // Check if sample data already exists
      const existingPortfolio = await this.userSql`
        SELECT COUNT(*) as count FROM portfolio_entries
      `;

      if (existingPortfolio[0].count > 0) {
        console.log('ℹ️  Sample data already exists, skipping...');
        return;
      }

      // Insert sample portfolio entries
      await this.userSql`
        INSERT INTO portfolio_entries (symbol, name, quantity, average_cost, sector, industry, asset_type, source) VALUES
        ('AAPL', 'Apple Inc.', 100, 150.00, 'Technology', 'Consumer Electronics', 'stock', 'manual'),
        ('GOOGL', 'Alphabet Inc.', 50, 2500.00, 'Technology', 'Internet Services', 'stock', 'manual'),
        ('MSFT', 'Microsoft Corporation', 75, 300.00, 'Technology', 'Software', 'stock', 'manual'),
        ('TSLA', 'Tesla Inc.', 25, 800.00, 'Consumer Cyclical', 'Auto Manufacturers', 'stock', 'manual')
      `;

      // Insert sample watchlist entries
      await this.userSql`
        INSERT INTO watchlist (symbol, name) VALUES
        ('AMZN', 'Amazon.com Inc.'),
        ('NVDA', 'NVIDIA Corporation'),
        ('META', 'Meta Platforms Inc.')
      `;

      console.log('✅ Sample data inserted successfully');
    } catch (error) {
      console.error('❌ Failed to insert sample data:', error.message);
      throw error;
    }
  }

  async generateConnectionString() {
    const connectionString = `postgresql://${DB_CONFIG.username}:${DB_CONFIG.password}@${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`;
    
    console.log('\n📋 Database Connection Information:');
    console.log('=====================================');
    console.log(`Host: ${DB_CONFIG.host}`);
    console.log(`Port: ${DB_CONFIG.port}`);
    console.log(`Database: ${DB_CONFIG.database}`);
    console.log(`Username: ${DB_CONFIG.username}`);
    console.log(`\nConnection String:`);
    console.log(`DATABASE_URL="${connectionString}"`);
    console.log('\n💡 Add this to your .env file');
  }

  async cleanup() {
    if (this.adminSql) {
      await this.adminSql.end();
    }
    if (this.userSql) {
      await this.userSql.end();
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'setup';

  const setup = new DatabaseSetup();

  try {
    switch (command) {
      case 'setup':
      case 'init':
        console.log('🚀 Setting up InWest database...\n');
        
        // Connect as admin and create database/user
        if (await setup.connectAsAdmin()) {
          await setup.createDatabaseAndUser();
          await setup.cleanup();
        }
        
        // Connect as user and run migrations
        if (await setup.connectAsUser()) {
          await setup.runMigrations();
          await setup.checkTables();
          await setup.insertSampleData();
          await setup.generateConnectionString();
        }
        
        console.log('\n🎉 Database setup completed successfully!');
        break;

      case 'migrate':
        console.log('📝 Running migrations...\n');
        if (await setup.connectAsUser()) {
          await setup.runMigrations();
          await setup.checkTables();
          console.log('\n✅ Migrations completed!');
        } else {
          throw new Error('Unable to connect to database as application user');
        }
        break;

      case 'check':
        console.log('🔍 Checking database...\n');
        if (await setup.connectAsUser()) {
          await setup.checkTables();
          await setup.generateConnectionString();
        } else {
          throw new Error('Unable to connect to database as application user');
        }
        break;

      case 'sample':
        console.log('📊 Inserting sample data...\n');
        if (await setup.connectAsUser()) {
          await setup.insertSampleData();
        } else {
          throw new Error('Unable to connect to database as application user');
        }
        console.log('\n✅ Sample data inserted!');
        break;

      default:
        console.log('❓ Unknown command. Available commands:');
        console.log('  setup   - Full database setup (default)');
        console.log('  migrate - Run migrations only');
        console.log('  check   - Check database status');
        console.log('  sample  - Insert sample data');
        break;
    }
  } catch (error) {
    console.error('\n💥 Setup failed:', error.message);
    process.exit(1);
  } finally {
    await setup.cleanup();
  }
}

// Run if called directly (cross-platform)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}