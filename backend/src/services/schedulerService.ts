// Scheduler Service for Automated Data Updates
// Handles periodic updates of stock prices, news, and sentiment data

import cron from 'node-cron';
import { shouldSkipAfterHoursMarketDataPoll } from '../utils/usMarketTime.js';
import { enhancedApiService } from './enhancedApiService.js';
import { dataStorageService } from './dataStorageService.js';
import { automationService } from './automationService.js';
import { tradingService } from './tradingService.js';
import { analyticsService } from './analyticsService.js';
import { strategyEngine } from './strategyEngine.js';
import { suggestionEvaluator } from './suggestionEvaluator.js';
import { db } from '../db/connection.js';
import { portfolioEntries } from '../db/schema.js';

export class SchedulerService {
  private jobs: Map<string, any> = new Map();
  private isRunning = false;

  // Start all scheduled jobs
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Scheduler is already running');
      return;
    }

    console.log('🕒 Starting scheduler service...');

    try {
      // Market hours: Update stock prices every 5 minutes during trading hours
      const marketDataJob = cron.schedule('*/5 9-16 * * 1-5', async () => {
        await this.updateMarketData();
      }, {
        timezone: "America/New_York"
      });

      // After hours: Update stock prices once every hour
      const afterHoursJob = cron.schedule('0 * * * *', async () => {
        // Use America/New_York calendar (not server's local TZ) inside the callback
        if (shouldSkipAfterHoursMarketDataPoll(new Date())) {
          return;
        }
        await this.updateMarketData();
      }, {
        timezone: "America/New_York"
      });

      // News updates: Every 30 minutes
      const newsJob = cron.schedule('*/30 * * * *', async () => {
        await this.updateNews();
      });

      // Reddit sentiment: Every hour
      const sentimentJob = cron.schedule('0 * * * *', async () => {
        await this.updateRedditSentiment();
      });

      // Daily maintenance: 2 AM ET
      const maintenanceJob = cron.schedule('0 2 * * *', async () => {
        await this.performMaintenance();
      }, { 
        timezone: "America/New_York"
      });

      // Portfolio sync: Every 15 minutes during market hours
      const portfolioSyncJob = cron.schedule('*/15 9-16 * * 1-5', async () => {
        await this.syncPortfolio();
      }, {
        timezone: "America/New_York"
      });

      // After-close trading session snapshot: 4 PM ET on weekdays
      const afterCloseSnapshotJob = cron.schedule('0 16 * * 1-5', async () => {
        await this.snapshotTradingSessions();
      }, {
        timezone: "America/New_York"
      });

      // Prediction evaluation: after close once fresh daily prices should be available
      const predictionEvaluationJob = cron.schedule('30 16 * * 1-5', async () => {
        await this.evaluateDuePredictions();
      }, {
        timezone: "America/New_York"
      });

      // Automation rules: Poll during market hours when explicitly enabled
      const automationJob = cron.schedule('* 9-16 * * 1-5', async () => {
        if (process.env.AUTOMATION_ENABLED !== 'true') return;
        await this.evaluateAutomationRules();
      }, {
        timezone: "America/New_York"
      });

      // Strategy engine: scan universe every 4 hours, all day
      const strategyEngineJob = cron.schedule('0 */4 * * *', async () => {
        if (process.env.STRATEGY_ENGINE_ENABLED !== 'true') return;
        await this.runStrategyEngine();
      });

      // Suggestion evaluation: daily at 5:30 PM ET after prices settle
      const suggestionEvalJob = cron.schedule('30 17 * * 1-5', async () => {
        if (process.env.STRATEGY_ENGINE_ENABLED !== 'true') return;
        await this.evaluateSuggestions();
      }, {
        timezone: 'America/New_York',
      });

      // Store jobs
      this.jobs.set('marketData', marketDataJob);
      this.jobs.set('afterHours', afterHoursJob);
      this.jobs.set('news', newsJob);
      this.jobs.set('sentiment', sentimentJob);
      this.jobs.set('maintenance', maintenanceJob);
      this.jobs.set('portfolio', portfolioSyncJob);
      this.jobs.set('afterCloseSnapshot', afterCloseSnapshotJob);
      this.jobs.set('predictionEvaluation', predictionEvaluationJob);
      this.jobs.set('automation', automationJob);
      this.jobs.set('strategyEngine', strategyEngineJob);
      this.jobs.set('suggestionEvaluation', suggestionEvalJob);

      this.jobs.forEach((_, name) => {
        console.log(`✅ Started ${name} job`);
      });

      this.isRunning = true;
      console.log('🚀 All scheduled jobs started successfully');

      // Run initial data update
      setTimeout(() => {
        this.runInitialUpdate();
      }, 5000); // Wait 5 seconds for server to fully start

    } catch (error) {
      console.error('❌ Error starting scheduler:', error);
      throw error;
    }
  }

  // Stop all scheduled jobs
  stop(): void {
    console.log('🛑 Stopping scheduler service...');
    
    this.jobs.forEach((job, name) => {
      job.stop();
      console.log(`⏹️ Stopped ${name} job`);
    });
    
    this.jobs.clear();
    this.isRunning = false;
    console.log('✅ Scheduler service stopped');
  }

  // Get scheduler status
  getStatus(): any {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.jobs.keys()),
      jobCount: this.jobs.size
    };
  }

  // ==================== SCHEDULED TASKS ====================

  private async runInitialUpdate(): Promise<void> {
    console.log('🔄 Running initial data update...');
    
    try {
      // Get portfolio symbols for initial update
      const portfolio = await db.select({ symbol: portfolioEntries.symbol }).from(portfolioEntries);
      const symbols = [...new Set(portfolio.map(p => p.symbol))]; // Remove duplicates

      if (symbols.length > 0) {
        console.log(`📊 Refreshing data for ${symbols.length} portfolio symbols`);
        
        // Update market data for portfolio symbols
        const results = await enhancedApiService.refreshAllPortfolioData(symbols);
        console.log(`✅ Initial update complete: ${results.success} successful, ${results.failed} failed`);
      }

      // Update news
      await this.updateNews();
      
    } catch (error) {
      console.error('❌ Error in initial update:', error);
    }
  }

  private async updateMarketData(): Promise<void> {
    console.log('📈 Updating market data...');
    
    try {
      // Get all portfolio symbols
      const portfolio = await db.select({ symbol: portfolioEntries.symbol }).from(portfolioEntries);
      const symbols = [...new Set(portfolio.map(p => p.symbol))];

      if (symbols.length === 0) {
        console.log('No portfolio symbols to update');
        return;
      }

      // Update in batches to respect rate limits
      const batchSize = 10;
      let successful = 0;
      let failed = 0;

      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        
        const results = await Promise.allSettled(
          batch.map(symbol => 
            enhancedApiService.getQuote({ symbol, preferCache: false })
          )
        );

        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            successful++;
          } else {
            failed++;
            console.error(`Failed to update ${batch[index]}:`, result.reason);
          }
        });

        // Wait between batches
        if (i + batchSize < symbols.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`📊 Market data update complete: ${successful} successful, ${failed} failed`);
    } catch (error) {
      console.error('❌ Error updating market data:', error);
    }
  }

  private async evaluateAutomationRules(): Promise<void> {
    try {
      const result = await automationService.evaluateAllEnabledRules();
      if (result.triggered > 0 || result.errors.length > 0) {
        console.log(`🤖 Automation checked ${result.checked}, triggered ${result.triggered}, errors ${result.errors.length}`);
      }
    } catch (error) {
      console.error('❌ Automation evaluation failed:', error);
    }
  }

  private async snapshotTradingSessions(): Promise<void> {
    try {
      const updated = await tradingService.refreshAllUserTradingSessions();
      console.log(`📊 Updated ${updated} after-close trading session snapshot(s)`);
    } catch (error) {
      console.error('❌ After-close trading session snapshot failed:', error);
    }
  }

  private async evaluateDuePredictions(): Promise<void> {
    try {
      const result = await analyticsService.evaluateDuePredictions();
      if (result.evaluated > 0 || result.skipped > 0) {
        console.log(`🔮 Predictions checked ${result.checked}, evaluated ${result.evaluated}, skipped ${result.skipped}`);
      }
    } catch (error) {
      console.error('❌ Prediction evaluation failed:', error);
    }
  }

  private async runStrategyEngine(): Promise<void> {
    try {
      const asOfDay = new Date().toISOString().slice(0, 10);
      const result = await strategyEngine.runForUniverse({
        universeSelection: {
          methodology: 'static_current_constituents',
          asOfDate: asOfDay,
        },
      });
      console.log(
        `🧠 Strategy engine: ${result.processed} symbols processed, ` +
        `${result.skipped} skipped, ${result.errors.length} errors`
      );
      if (result.errors.length > 0) {
        result.errors.slice(0, 5).forEach(e => console.warn(`  ⚠️  ${e}`));
      }
    } catch (error) {
      console.error('❌ Strategy engine failed:', error);
    }
  }

  private async evaluateSuggestions(): Promise<void> {
    try {
      const result = await suggestionEvaluator.evaluatePending();
      if (result.checked > 0) {
        console.log(
          `📊 Suggestion eval: checked ${result.checked}, ` +
          `evaluated ${result.evaluated}, skipped ${result.skipped}`
        );
      }
    } catch (error) {
      console.error('❌ Suggestion evaluation failed:', error);
    }
  }

  private async updateNews(): Promise<void> {
    console.log('📰 Updating news...');
    
    try {
      // Get portfolio symbols for targeted news
      const portfolio = await db.select({ symbol: portfolioEntries.symbol }).from(portfolioEntries);
      const symbols = [...new Set(portfolio.map(p => p.symbol))].slice(0, 10); // Limit to top 10

      const news = await enhancedApiService.getNews({
        symbols: symbols,
        limit: 50,
        hours: 12,
        preferCache: false
      });

      console.log(`📰 News update complete: ${news.length} articles`);
    } catch (error) {
      console.error('❌ Error updating news:', error);
    }
  }

  private async updateRedditSentiment(): Promise<void> {
    console.log('💬 Updating Reddit sentiment...');
    
    try {
      // Get top portfolio symbols for sentiment analysis
      const portfolio = await db.select({ symbol: portfolioEntries.symbol }).from(portfolioEntries);
      const symbols = [...new Set(portfolio.map(p => p.symbol))].slice(0, 5); // Top 5 symbols

      if (symbols.length > 0) {
        const sentiment = await enhancedApiService.getRedditSentiment(symbols, 24);
        console.log(`💬 Reddit sentiment update complete: ${sentiment.totalPosts} posts analyzed`);
      }
    } catch (error) {
      console.error('❌ Error updating Reddit sentiment:', error);
    }
  }

  private async syncPortfolio(): Promise<void> {
    console.log('💼 Syncing portfolio...');
    
    try {
      await dataStorageService.updatePortfolioWithLatestPrices();
      console.log('💼 Portfolio sync complete');
    } catch (error) {
      console.error('❌ Error syncing portfolio:', error);
    }
  }

  private async performMaintenance(): Promise<void> {
    console.log('🔧 Performing daily maintenance...');
    
    try {
      const results = await enhancedApiService.performMaintenance();
      
      console.log(`🔧 Maintenance complete:`);
      console.log(`  - Expired cache entries cleared: ${results.expiredCacheCleared}`);
      console.log(`  - Duplicate records removed: ${results.duplicatesRemoved}`);
      console.log(`  - Portfolio updated: ${results.portfolioUpdated ? 'Yes' : 'No'}`);
      
      // Get storage statistics
      const stats = await dataStorageService.getStorageStats();
      console.log(`📊 Storage stats: ${stats.historicalPrices} prices, ${stats.newsArticles} news, ${stats.cachedResponses} cached responses`);
      
    } catch (error) {
      console.error('❌ Error during maintenance:', error);
    }
  }

  // ==================== MANUAL TRIGGERS ====================

  async triggerMarketDataUpdate(): Promise<void> {
    console.log('🔄 Manually triggering market data update...');
    await this.updateMarketData();
  }

  async triggerNewsUpdate(): Promise<void> {
    console.log('🔄 Manually triggering news update...');
    await this.updateNews();
  }

  async triggerSentimentUpdate(): Promise<void> {
    console.log('🔄 Manually triggering sentiment update...');
    await this.updateRedditSentiment();
  }

  async triggerFullRefresh(): Promise<void> {
    console.log('🔄 Manually triggering full data refresh...');
    await this.updateMarketData();
    await this.updateNews();
    await this.updateRedditSentiment();
    await this.syncPortfolio();
  }

  async triggerMaintenance(): Promise<void> {
    console.log('🔄 Manually triggering maintenance...');
    await this.performMaintenance();
  }

  // ==================== HEALTH CHECKS ====================

  async healthCheck(): Promise<{
    scheduler: boolean;
    database: boolean;
    dataIntegrity: any;
    lastUpdate: Date;
  }> {
    try {
      // Check if scheduler is running
      const schedulerHealthy = this.isRunning && this.jobs.size > 0;

      // Check database connection
      let databaseHealthy = false;
      try {
        await db.select().from(portfolioEntries).limit(1);
        databaseHealthy = true;
      } catch (error) {
        console.error('Database health check failed:', error);
      }

      // Check data integrity
      const dataIntegrity = await dataStorageService.validateStoredData();

      return {
        scheduler: schedulerHealthy,
        database: databaseHealthy,
        dataIntegrity,
        lastUpdate: new Date()
      };
    } catch (error) {
      console.error('Health check failed:', error);
      return {
        scheduler: false,
        database: false,
        dataIntegrity: null,
        lastUpdate: new Date()
      };
    }
  }
}

// Create singleton instance
export const schedulerService = new SchedulerService();