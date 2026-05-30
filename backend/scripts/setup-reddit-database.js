#!/usr/bin/env node

/**
 * Reddit Sentiment Analysis Database Setup Script
 * 
 * This script sets up the database for Reddit sentiment analysis functionality.
 * It creates the necessary tables and initializes default configurations.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database configuration
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'inwest_db',
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
};

class RedditDatabaseSetup {
  constructor() {
    this.sql = null;
  }

  async connect() {
    try {
      this.sql = postgres({
        host: DB_CONFIG.host,
        port: DB_CONFIG.port,
        database: DB_CONFIG.database,
        username: DB_CONFIG.username,
        password: DB_CONFIG.password,
      });
      
      // Test connection
      await this.sql`SELECT 1`;
      console.log('✅ Connected to database successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to database:', error.message);
      console.log('\n💡 Make sure PostgreSQL is running and the database exists.');
      console.log('💡 You can create the database with: CREATE DATABASE inwest_db;');
      return false;
    }
  }

  async createRedditTables() {
    try {
      console.log('📝 Creating Reddit-related tables...');

      // Create RedditPost table
      await this.sql`
        CREATE TABLE IF NOT EXISTS "RedditPost" (
          id TEXT PRIMARY KEY,
          subreddit TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT,
          author TEXT NOT NULL,
          score INTEGER NOT NULL,
          "upvoteRatio" DOUBLE PRECISION NOT NULL,
          "numComments" INTEGER NOT NULL,
          created TIMESTAMP(3) NOT NULL,
          url TEXT,
          domain TEXT,
          flair TEXT,
          "isStickied" BOOLEAN NOT NULL DEFAULT false,
          "isLocked" BOOLEAN NOT NULL DEFAULT false,
          "isNsfw" BOOLEAN NOT NULL DEFAULT false,
          permalink TEXT NOT NULL,
          "sentimentScore" DOUBLE PRECISION,
          "sentimentLabel" TEXT,
          "confidenceScore" DOUBLE PRECISION,
          "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;

      // Create indexes for RedditPost
      await this.sql`CREATE INDEX IF NOT EXISTS "RedditPost_subreddit_created_idx" ON "RedditPost"(subreddit, created)`;
      await this.sql`CREATE INDEX IF NOT EXISTS "RedditPost_created_idx" ON "RedditPost"(created)`;
      await this.sql`CREATE INDEX IF NOT EXISTS "RedditPost_sentimentScore_idx" ON "RedditPost"("sentimentScore")`;
      await this.sql`CREATE INDEX IF NOT EXISTS "RedditPost_fetchedAt_idx" ON "RedditPost"("fetchedAt")`;

      // Create RedditComment table
      await this.sql`
        CREATE TABLE IF NOT EXISTS "RedditComment" (
          id TEXT PRIMARY KEY,
          "postId" TEXT NOT NULL,
          "parentId" TEXT,
          author TEXT NOT NULL,
          content TEXT NOT NULL,
          score INTEGER NOT NULL,
          created TIMESTAMP(3) NOT NULL,
          edited TIMESTAMP(3),
          "isStickied" BOOLEAN NOT NULL DEFAULT false,
          depth INTEGER NOT NULL DEFAULT 0,
          "sentimentScore" DOUBLE PRECISION,
          "sentimentLabel" TEXT,
          "confidenceScore" DOUBLE PRECISION,
          "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY ("postId") REFERENCES "RedditPost"(id) ON DELETE CASCADE
        )
      `;

      // Create indexes for RedditComment
      await this.sql`CREATE INDEX IF NOT EXISTS "RedditComment_postId_idx" ON "RedditComment"("postId")`;
      await this.sql`CREATE INDEX IF NOT EXISTS "RedditComment_parentId_idx" ON "RedditComment"("parentId")`;
      await this.sql`CREATE INDEX IF NOT EXISTS "RedditComment_created_idx" ON "RedditComment"(created)`;
      await this.sql`CREATE INDEX IF NOT EXISTS "RedditComment_sentimentScore_idx" ON "RedditComment"("sentimentScore")`;

      // Create RedditApiCall table
      await this.sql`
        CREATE TABLE IF NOT EXISTS "RedditApiCall" (
          id SERIAL PRIMARY KEY,
          endpoint TEXT NOT NULL,
          method TEXT NOT NULL DEFAULT 'GET',
          parameters JSONB,
          "responseCode" INTEGER NOT NULL,
          "responseTime" INTEGER NOT NULL,
          "rateLimited" BOOLEAN NOT NULL DEFAULT false,
          "errorMessage" TEXT,
          "postId" TEXT,
          "postsCount" INTEGER,
          "commentsCount" INTEGER,
          "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY ("postId") REFERENCES "RedditPost"(id)
        )
      `;

      // Create indexes for RedditApiCall
      await this.sql`CREATE INDEX IF NOT EXISTS "RedditApiCall_endpoint_calledAt_idx" ON "RedditApiCall"(endpoint, "calledAt")`;
      await this.sql`CREATE INDEX IF NOT EXISTS "RedditApiCall_calledAt_idx" ON "RedditApiCall"("calledAt")`;
      await this.sql`CREATE INDEX IF NOT EXISTS "RedditApiCall_rateLimited_idx" ON "RedditApiCall"("rateLimited")`;

      // Create SubredditConfig table
      await this.sql`
        CREATE TABLE IF NOT EXISTS "SubredditConfig" (
          id SERIAL PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          "displayName" TEXT NOT NULL,
          description TEXT,
          "isActive" BOOLEAN NOT NULL DEFAULT true,
          "fetchPosts" BOOLEAN NOT NULL DEFAULT true,
          "fetchComments" BOOLEAN NOT NULL DEFAULT true,
          "maxPostAge" INTEGER NOT NULL DEFAULT 7,
          "maxCommentAge" INTEGER NOT NULL DEFAULT 2,
          "lastFetched" TIMESTAMP(3),
          "fetchInterval" INTEGER NOT NULL DEFAULT 300,
          "enableSentiment" BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;

      // Create indexes for SubredditConfig
      await this.sql`CREATE INDEX IF NOT EXISTS "SubredditConfig_isActive_idx" ON "SubredditConfig"("isActive")`;
      await this.sql`CREATE INDEX IF NOT EXISTS "SubredditConfig_lastFetched_idx" ON "SubredditConfig"("lastFetched")`;

      // Create SentimentJob table
      await this.sql`
        CREATE TABLE IF NOT EXISTS "SentimentJob" (
          id SERIAL PRIMARY KEY,
          type TEXT NOT NULL,
          "targetId" TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          priority INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0,
          "maxAttempts" INTEGER NOT NULL DEFAULT 3,
          "errorMessage" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "startedAt" TIMESTAMP(3),
          "completedAt" TIMESTAMP(3)
        )
      `;

      // Create indexes for SentimentJob
      await this.sql`CREATE INDEX IF NOT EXISTS "SentimentJob_status_priority_idx" ON "SentimentJob"(status, priority)`;
      await this.sql`CREATE INDEX IF NOT EXISTS "SentimentJob_createdAt_idx" ON "SentimentJob"("createdAt")`;

      console.log('✅ Reddit tables created successfully');
    } catch (error) {
      console.error('❌ Failed to create Reddit tables:', error.message);
      throw error;
    }
  }

  async insertDefaultSubreddits() {
    try {
      console.log('📝 Inserting default subreddit configurations...');

      const defaultSubreddits = [
        {
          name: 'investing',
          displayName: 'r/investing',
          description: 'Investment discussion and advice'
        },
        {
          name: 'stocks',
          displayName: 'r/stocks',
          description: 'Stock market discussion'
        },
        {
          name: 'wallstreetbets',
          displayName: 'r/wallstreetbets',
          description: 'High-risk trading discussion'
        },
        {
          name: 'SecurityAnalysis',
          displayName: 'r/SecurityAnalysis',
          description: 'Fundamental analysis and value investing'
        },
        {
          name: 'ValueInvesting',
          displayName: 'r/ValueInvesting',
          description: 'Value investing strategies and discussion'
        },
        {
          name: 'financialindependence',
          displayName: 'r/financialindependence',
          description: 'FIRE movement and financial independence'
        },
        {
          name: 'personalfinance',
          displayName: 'r/personalfinance',
          description: 'Personal finance advice and discussion'
        }
      ];

      for (const subreddit of defaultSubreddits) {
        await this.sql`
          INSERT INTO "SubredditConfig" (name, "displayName", description)
          VALUES (${subreddit.name}, ${subreddit.displayName}, ${subreddit.description})
          ON CONFLICT (name) DO NOTHING
        `;
      }

      console.log('✅ Default subreddit configurations inserted');
    } catch (error) {
      console.error('❌ Failed to insert default subreddits:', error.message);
      throw error;
    }
  }

  async checkTables() {
    try {
      console.log('🔍 Checking Reddit tables...');

      const tables = await this.sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name LIKE '%Reddit%' OR table_name LIKE '%Sentiment%' OR table_name LIKE '%Subreddit%'
        ORDER BY table_name
      `;

      console.log('✅ Reddit-related tables:');
      tables.forEach(table => {
        console.log(`   - ${table.table_name}`);
      });

      // Check subreddit configurations
      const subredditCount = await this.sql`
        SELECT COUNT(*) as count FROM "SubredditConfig"
      `;

      console.log(`📊 Configured subreddits: ${subredditCount[0].count}`);

      return tables.map(t => t.table_name);
    } catch (error) {
      console.error('❌ Failed to check tables:', error.message);
      throw error;
    }
  }

  async generateConnectionInfo() {
    const connectionString = `postgresql://${DB_CONFIG.username}:${DB_CONFIG.password}@${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`;
    
    console.log('\n📋 Reddit Database Configuration:');
    console.log('=====================================');
    console.log(`Host: ${DB_CONFIG.host}`);
    console.log(`Port: ${DB_CONFIG.port}`);
    console.log(`Database: ${DB_CONFIG.database}`);
    console.log(`Username: ${DB_CONFIG.username}`);
    console.log(`\nConnection String:`);
    console.log(`DATABASE_URL="${connectionString}"`);
    console.log('\n💡 Make sure this is in your .env file');
    console.log('\n🚀 You can now use the Reddit sentiment analysis features!');
  }

  async cleanup() {
    if (this.sql) {
      await this.sql.end();
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'setup';

  const setup = new RedditDatabaseSetup();

  try {
    switch (command) {
      case 'setup':
      case 'init':
        console.log('🚀 Setting up Reddit sentiment analysis database...\n');
        
        if (await setup.connect()) {
          await setup.createRedditTables();
          await setup.insertDefaultSubreddits();
          await setup.checkTables();
          await setup.generateConnectionInfo();
        }
        
        console.log('\n🎉 Reddit database setup completed successfully!');
        break;

      case 'check':
        console.log('🔍 Checking Reddit database...\n');
        if (await setup.connect()) {
          await setup.checkTables();
          await setup.generateConnectionInfo();
        }
        break;

      case 'subreddits':
        console.log('📝 Setting up default subreddits...\n');
        if (await setup.connect()) {
          await setup.insertDefaultSubreddits();
        }
        console.log('\n✅ Subreddits setup completed!');
        break;

      default:
        console.log('❓ Unknown command. Available commands:');
        console.log('  setup      - Full Reddit database setup (default)');
        console.log('  check      - Check Reddit database status');
        console.log('  subreddits - Setup default subreddit configurations');
        break;
    }
  } catch (error) {
    console.error('\n💥 Setup failed:', error.message);
    process.exit(1);
  } finally {
    await setup.cleanup();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
} 