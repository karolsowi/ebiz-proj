import {
  pgTable,
  serial,
  varchar,
  text,
  decimal,
  integer,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  bigint
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Users & Auth ────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(), // UUID
  email: varchar('email', { length: 255 }).notNull(),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: varchar('role', { length: 20 }).notNull().default('user'),
  emailVerified: boolean('email_verified').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  emailIdx: uniqueIndex('users_email_idx').on(table.email),
}));

export const refreshTokens = pgTable('refresh_tokens', {
  id: serial('id').primaryKey(),
  token: varchar('token', { length: 512 }).notNull(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  userAgent: varchar('user_agent', { length: 500 }),
  ipAddress: varchar('ip_address', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tokenIdx: uniqueIndex('refresh_tokens_token_idx').on(table.token),
  userIdIdx: index('refresh_tokens_user_id_idx').on(table.userId),
  expiresAtIdx: index('refresh_tokens_expires_at_idx').on(table.expiresAt),
}));

export const userSettings = pgTable('user_settings', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  theme: varchar('theme', { length: 20 }).notNull().default('system'),
  language: varchar('language', { length: 10 }).notNull().default('en'),
  timezone: varchar('timezone', { length: 100 }).notNull().default('UTC'),
  currency: varchar('currency', { length: 10 }).notNull().default('USD'),
  dateFormat: varchar('date_format', { length: 20 }).notNull().default('MM/DD/YYYY'),
  defaultChartType: varchar('default_chart_type', { length: 20 }).notNull().default('candlestick'),
  refreshInterval: integer('refresh_interval').notNull().default(30),
  emailNotifications: boolean('email_notifications').notNull().default(true),
  tradingAlerts: boolean('trading_alerts').notNull().default(true),
  paperTradingMode: boolean('paper_trading_mode').notNull().default(true),
  confirmOrders: boolean('confirm_orders').notNull().default(true),
  riskWarnings: boolean('risk_warnings').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: uniqueIndex('user_settings_user_id_idx').on(table.userId),
}));

export const userApiKeys = pgTable('user_api_keys', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  service: varchar('service', { length: 50 }).notNull(),
  apiKeyEncrypted: text('api_key_encrypted'),
  secretKeyEncrypted: text('secret_key_encrypted'),
  paperTrading: boolean('paper_trading').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
}, (table) => ({
  userIdIdx: index('user_api_keys_user_id_idx').on(table.userId),
}));

// Portfolio entries table - stores user's investment holdings
export const portfolioEntries = pgTable('portfolio_entries', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  name: varchar('name', { length: 255 }),
  quantity: decimal('quantity', { precision: 18, scale: 8 }).notNull(),
  averageCost: decimal('average_cost', { precision: 18, scale: 8 }).notNull(),
  currentPrice: decimal('current_price', { precision: 18, scale: 8 }),
  totalValue: decimal('total_value', { precision: 18, scale: 8 }),
  gainLoss: decimal('gain_loss', { precision: 18, scale: 8 }),
  gainLossPercent: decimal('gain_loss_percent', { precision: 8, scale: 4 }),
  sector: varchar('sector', { length: 100 }),
  industry: varchar('industry', { length: 100 }),
  assetType: varchar('asset_type', { length: 50 }).notNull().default('stock'), // stock, crypto, etf, bond, etc.
  source: varchar('source', { length: 50 }).notNull().default('manual'), // manual, csv_import, api_sync
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  symbolIdx: index('portfolio_symbol_idx').on(table.symbol),
  assetTypeIdx: index('portfolio_asset_type_idx').on(table.assetType),
  sourceIdx: index('portfolio_source_idx').on(table.source),
}));

// Historical prices table - stores price data for stocks/crypto
export const historicalPrices = pgTable('historical_prices', {
  id: serial('id').primaryKey(),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  date: timestamp('date').notNull(),
  open: decimal('open', { precision: 18, scale: 8 }).notNull(),
  high: decimal('high', { precision: 18, scale: 8 }).notNull(),
  low: decimal('low', { precision: 18, scale: 8 }).notNull(),
  close: decimal('close', { precision: 18, scale: 8 }).notNull(),
  volume: bigint('volume', { mode: 'number' }),
  adjustedClose: decimal('adjusted_close', { precision: 18, scale: 8 }),
  dividendAmount: decimal('dividend_amount', { precision: 18, scale: 8 }),
  splitCoefficient: decimal('split_coefficient', { precision: 8, scale: 4 }),
  source: varchar('source', { length: 50 }).notNull(), // alphavantage, finnhub, manual
  timeframe: varchar('timeframe', { length: 20 }).notNull().default('daily'), // daily, weekly, monthly, intraday
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  symbolDateIdx: uniqueIndex('historical_symbol_date_timeframe_idx').on(table.symbol, table.date, table.timeframe),
  symbolIdx: index('historical_symbol_idx').on(table.symbol),
  dateIdx: index('historical_date_idx').on(table.date),
  sourceIdx: index('historical_source_idx').on(table.source),
}));

// API response cache table - stores cached API responses to avoid overuse
export const apiResponseCache = pgTable('api_response_cache', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 64 }).notNull().default('public'),
  endpoint: varchar('endpoint', { length: 255 }).notNull(),
  parameters: jsonb('parameters').notNull(), // JSON object of request parameters
  paramHash: varchar('param_hash', { length: 64 }).notNull(), // SHA-256 hex of sorted JSON params for reliable lookup
  response: jsonb('response').notNull(), // Cached API response
  source: varchar('source', { length: 50 }).notNull(), // alphavantage, finnhub, etc.
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  hitCount: integer('hit_count').default(0).notNull(),
  lastAccessed: timestamp('last_accessed').defaultNow().notNull(),
}, (table) => ({
  // Unique on (userId, endpoint, paramHash, source) — hash is stable regardless of key ordering
  endpointHashSourceIdx: uniqueIndex('api_cache_user_endpoint_hash_source_idx').on(table.userId, table.endpoint, table.paramHash, table.source),
  userIdIdx: index('api_cache_user_id_idx').on(table.userId),
  sourceIdx: index('api_cache_source_idx').on(table.source),
  expiresAtIdx: index('api_cache_expires_idx').on(table.expiresAt),
}));

// News articles table - stores financial news and articles
export const newsArticles = pgTable('news_articles', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 500 }).notNull(),
  summary: text('summary'),
  content: text('content'),
  url: varchar('url', { length: 1000 }).notNull(),
  imageUrl: varchar('image_url', { length: 1000 }),
  source: varchar('source', { length: 100 }).notNull(), // Reuters, Bloomberg, etc.
  author: varchar('author', { length: 255 }),
  publishedAt: timestamp('published_at').notNull(),
  category: varchar('category', { length: 100 }), // earnings, market, crypto, etc.
  symbols: jsonb('symbols'), // Array of related stock symbols
  sentiment: varchar('sentiment', { length: 20 }), // positive, negative, neutral
  sentimentScore: decimal('sentiment_score', { precision: 5, scale: 4 }), // -1.0 to 1.0
  relevanceScore: decimal('relevance_score', { precision: 5, scale: 4 }), // 0.0 to 1.0
  isProcessed: boolean('is_processed').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  urlIdx: uniqueIndex('news_url_idx').on(table.url),
  sourceIdx: index('news_source_idx').on(table.source),
  publishedAtIdx: index('news_published_idx').on(table.publishedAt),
  categoryIdx: index('news_category_idx').on(table.category),
  sentimentIdx: index('news_sentiment_idx').on(table.sentiment),
  symbolsIdx: index('news_symbols_idx').on(table.symbols),
}));

// Reddit posts table - stores Reddit posts for sentiment analysis
export const redditPosts = pgTable('reddit_posts', {
  id: varchar('id', { length: 20 }).primaryKey(), // Reddit post ID
  subreddit: varchar('subreddit', { length: 100 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  content: text('content'),
  author: varchar('author', { length: 100 }),
  score: integer('score').default(0).notNull(),
  upvoteRatio: decimal('upvote_ratio', { precision: 5, scale: 4 }),
  numComments: integer('num_comments').default(0).notNull(),
  url: varchar('url', { length: 1000 }),
  domain: varchar('domain', { length: 255 }),
  flair: varchar('flair', { length: 100 }),
  isStickied: boolean('is_stickied').default(false).notNull(),
  isLocked: boolean('is_locked').default(false).notNull(),
  isNsfw: boolean('is_nsfw').default(false).notNull(),
  permalink: varchar('permalink', { length: 500 }).notNull(),
  created: timestamp('created').notNull(),
  sentimentScore: decimal('sentiment_score', { precision: 5, scale: 4 }),
  sentimentLabel: varchar('sentiment_label', { length: 20 }),
  confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }),
  detectedStocks: jsonb('detected_stocks'),
  detectedSectors: jsonb('detected_sectors'),
  financialRelevance: decimal('financial_relevance', { precision: 5, scale: 4 }),
  authorFullname: varchar('author_fullname', { length: 100 }),
  ups: integer('ups'),
  awardsCount: integer('awards_count'),
  subredditSubscribers: integer('subreddit_subscribers'),
  removedByCategory: varchar('removed_by_category', { length: 50 }),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
}, (table) => ({
  subredditCreatedIdx: index('reddit_posts_subreddit_created_idx').on(table.subreddit, table.created),
  createdIdx: index('reddit_posts_created_idx').on(table.created),
  sentimentScoreIdx: index('reddit_posts_sentiment_score_idx').on(table.sentimentScore),
  fetchedAtIdx: index('reddit_posts_fetched_at_idx').on(table.fetchedAt),
}));

// Reddit comments table
export const redditComments = pgTable('reddit_comments', {
  id: varchar('id', { length: 20 }).primaryKey(), // Reddit comment ID
  postId: varchar('post_id', { length: 20 }).notNull(),
  parentId: varchar('parent_id', { length: 20 }),
  author: varchar('author', { length: 100 }).notNull(),
  content: text('content').notNull(),
  score: integer('score').notNull(),
  created: timestamp('created').notNull(),
  edited: timestamp('edited'),
  isStickied: boolean('is_stickied').default(false).notNull(),
  depth: integer('depth').default(0).notNull(),
  sentimentScore: decimal('sentiment_score', { precision: 5, scale: 4 }),
  sentimentLabel: varchar('sentiment_label', { length: 20 }),
  confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }),
  detectedStocks: jsonb('detected_stocks'),
  detectedSectors: jsonb('detected_sectors'),
  financialRelevance: decimal('financial_relevance', { precision: 5, scale: 4 }),
  authorFullname: varchar('author_fullname', { length: 100 }),
  awardsCount: integer('awards_count'),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
}, (table) => ({
  postIdIdx: index('reddit_comments_post_id_idx').on(table.postId),
  parentIdIdx: index('reddit_comments_parent_id_idx').on(table.parentId),
  createdIdx: index('reddit_comments_created_idx').on(table.created),
  sentimentScoreIdx: index('reddit_comments_sentiment_score_idx').on(table.sentimentScore),
}));

// Reddit API call tracking
export const redditApiCalls = pgTable('reddit_api_calls', {
  id: serial('id').primaryKey(),
  endpoint: varchar('endpoint', { length: 255 }).notNull(),
  method: varchar('method', { length: 10 }).default('GET').notNull(),
  parameters: jsonb('parameters'),
  responseCode: integer('response_code').notNull(),
  responseTime: integer('response_time').notNull(),
  rateLimited: boolean('rate_limited').default(false).notNull(),
  errorMessage: text('error_message'),
  postId: varchar('post_id', { length: 20 }),
  postsCount: integer('posts_count'),
  commentsCount: integer('comments_count'),
  calledAt: timestamp('called_at').defaultNow().notNull(),
}, (table) => ({
  endpointCalledAtIdx: index('reddit_api_calls_endpoint_called_at_idx').on(table.endpoint, table.calledAt),
  calledAtIdx: index('reddit_api_calls_called_at_idx').on(table.calledAt),
  rateLimitedIdx: index('reddit_api_calls_rate_limited_idx').on(table.rateLimited),
}));

/** Singleton row (id = 1): quality thresholds + start date for Reddit backfill */
export const redditBackfillConfig = pgTable('reddit_backfill_config', {
  id: integer('id').primaryKey().default(1),
  sinceTs: timestamp('since_ts').notNull(),
  minScore: integer('min_score').notNull(),
  minComments: integer('min_comments').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Per-subreddit cursor + phase for chunked resumable import */
export const redditBackfillProgress = pgTable('reddit_backfill_progress', {
  subreddit: varchar('subreddit', { length: 100 }).primaryKey(),
  phase: varchar('phase', { length: 20 }).notNull().default('top'),
  afterTop: text('after_top'),
  afterNew: text('after_new'),
  topComplete: boolean('top_complete').notNull().default(false),
  newHistoryComplete: boolean('new_history_complete').notNull().default(false),
  liveStartedAt: timestamp('live_started_at'),
  lastChunkAt: timestamp('last_chunk_at'),
  listingCallsTotal: integer('listing_calls_total').notNull().default(0),
  postsIngestedTotal: integer('posts_ingested_total').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  phaseIdx: index('reddit_backfill_progress_phase_idx').on(table.phase),
}));

// Subreddit configuration
export const subredditConfigs = pgTable('subreddit_configs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  displayName: varchar('display_name', { length: 100 }).notNull(),
  description: text('description'),
  isActive: boolean('is_active').default(true).notNull(),
  fetchPosts: boolean('fetch_posts').default(true).notNull(),
  fetchComments: boolean('fetch_comments').default(true).notNull(),
  maxPostAge: integer('max_post_age').default(7).notNull(),
  maxCommentAge: integer('max_comment_age').default(2).notNull(),
  lastFetched: timestamp('last_fetched'),
  fetchInterval: integer('fetch_interval').default(300).notNull(),
  enableSentiment: boolean('enable_sentiment').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  isActiveIdx: index('subreddit_configs_is_active_idx').on(table.isActive),
  lastFetchedIdx: index('subreddit_configs_last_fetched_idx').on(table.lastFetched),
}));

// Sentiment scores table - aggregated sentiment data by symbol and time period
export const sentimentScores = pgTable('sentiment_scores', {
  id: serial('id').primaryKey(),
  symbol: varchar('symbol', { length: 64 }).notNull(),
  date: timestamp('date').notNull(),
  timeframe: varchar('timeframe', { length: 20 }).notNull().default('daily'), // hourly, daily, weekly
  source: varchar('source', { length: 50 }).notNull(), // news, reddit, twitter, combined
  bullishCount: integer('bullish_count').default(0).notNull(),
  bearishCount: integer('bearish_count').default(0).notNull(),
  neutralCount: integer('neutral_count').default(0).notNull(),
  totalMentions: integer('total_mentions').default(0).notNull(),
  averageSentiment: decimal('average_sentiment', { precision: 5, scale: 4 }), // -1.0 to 1.0
  weightedSentiment: decimal('weighted_sentiment', { precision: 5, scale: 4 }), // Weighted by engagement
  confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }), // 0.0 to 1.0
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  symbolDateTimeframeIdx: uniqueIndex('sentiment_symbol_date_timeframe_idx').on(table.symbol, table.date, table.timeframe, table.source),
  symbolIdx: index('sentiment_symbol_idx').on(table.symbol),
  dateIdx: index('sentiment_date_idx').on(table.date),
  sourceIdx: index('sentiment_source_idx').on(table.source),
}));

// Watchlist table - stores user's watchlist
export const watchlist = pgTable('watchlist', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  name: varchar('name', { length: 255 }),
  addedAt: timestamp('added_at').defaultNow().notNull(),
  notes: text('notes'),
  alertPrice: decimal('alert_price', { precision: 18, scale: 8 }),
  alertEnabled: boolean('alert_enabled').default(false).notNull(),
}, (table) => ({
  userSymbolIdx: uniqueIndex('watchlist_user_symbol_idx').on(table.userId, table.symbol),
}));

// Import history table - tracks CSV imports and data sources
export const importHistory = pgTable('import_history', {
  id: serial('id').primaryKey(),
  filename: varchar('filename', { length: 255 }).notNull(),
  fileSize: integer('file_size'),
  recordsProcessed: integer('records_processed').default(0).notNull(),
  recordsSuccessful: integer('records_successful').default(0).notNull(),
  recordsFailed: integer('records_failed').default(0).notNull(),
  importType: varchar('import_type', { length: 50 }).notNull(), // portfolio, prices, transactions
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending, processing, completed, failed
  errorLog: jsonb('error_log'), // Array of error messages
  metadata: jsonb('metadata'), // Additional import metadata
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  statusIdx: index('import_status_idx').on(table.status),
  typeIdx: index('import_type_idx').on(table.importType),
  createdAtIdx: index('import_created_idx').on(table.createdAt),
}));

// Calendar reminders table - stores user-defined calendar events/reminders
export const calendarReminders = pgTable('calendar_reminders', {
  id: varchar('id', { length: 64 }).primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at'),
  allDay: boolean('all_day').default(true).notNull(),
  createdBy: varchar('created_by', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  startAtIdx: index('calendar_reminders_start_at_idx').on(table.startAt),
  createdByIdx: index('calendar_reminders_created_by_idx').on(table.createdBy),
}));

// Define relationships
export const portfolioRelations = relations(portfolioEntries, ({ many }) => ({
  historicalPrices: many(historicalPrices),
}));

export const historicalPricesRelations = relations(historicalPrices, ({ one }) => ({
  portfolioEntry: one(portfolioEntries, {
    fields: [historicalPrices.symbol],
    references: [portfolioEntries.symbol],
  }),
}));

export const redditPostsRelations = relations(redditPosts, ({ many }) => ({
  comments: many(redditComments),
  apiCalls: many(redditApiCalls),
}));

export const redditCommentsRelations = relations(redditComments, ({ one, many }) => ({
  post: one(redditPosts, {
    fields: [redditComments.postId],
    references: [redditPosts.id],
  }),
  parent: one(redditComments, {
    fields: [redditComments.parentId],
    references: [redditComments.id],
  }),
  replies: many(redditComments),
}));

export const redditApiCallsRelations = relations(redditApiCalls, ({ one }) => ({
  post: one(redditPosts, {
    fields: [redditApiCalls.postId],
    references: [redditPosts.id],
  }),
}));

// Trading accounts table - stores different trading account types
export const tradingAccounts = pgTable('trading_accounts', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: varchar('account_id', { length: 100 }).notNull().unique(), // Local broker account key
  name: varchar('name', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull().default('alpaca'), // alpaca, td_ameritrade, etc.
  accountType: varchar('account_type', { length: 20 }).notNull(), // paper, live
  status: varchar('status', { length: 20 }).default('active').notNull(), // active, inactive, suspended
  balance: decimal('balance', { precision: 18, scale: 2 }),
  buyingPower: decimal('buying_power', { precision: 18, scale: 2 }),
  portfolioValue: decimal('portfolio_value', { precision: 18, scale: 2 }),
  dayTradeCount: integer('day_trade_count').default(0).notNull(),
  patternDayTrader: boolean('pattern_day_trader').default(false).notNull(),
  tradingBlocked: boolean('trading_blocked').default(false).notNull(),
  transfersBlocked: boolean('transfers_blocked').default(false).notNull(),
  accountBlocked: boolean('account_blocked').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastSynced: timestamp('last_synced').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('trading_accounts_user_id_idx').on(table.userId),
  providerTypeIdx: index('trading_accounts_provider_type_idx').on(table.provider, table.accountType),
  statusIdx: index('trading_accounts_status_idx').on(table.status),
}));

// Orders table - stores all trading orders
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderId: varchar('order_id', { length: 100 }).notNull().unique(), // Alpaca order ID
  accountId: integer('account_id').references(() => tradingAccounts.id).notNull(),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  side: varchar('side', { length: 4 }).notNull(), // buy, sell
  orderType: varchar('order_type', { length: 20 }).notNull(), // market, limit, stop, stop_limit, trailing_stop
  timeInForce: varchar('time_in_force', { length: 10 }).notNull(), // day, gtc, ioc, fok
  quantity: decimal('quantity', { precision: 18, scale: 8 }).notNull(),
  filledQuantity: decimal('filled_quantity', { precision: 18, scale: 8 }).default('0').notNull(),
  limitPrice: decimal('limit_price', { precision: 18, scale: 8 }),
  stopPrice: decimal('stop_price', { precision: 18, scale: 8 }),
  trailPrice: decimal('trail_price', { precision: 18, scale: 8 }),
  trailPercent: decimal('trail_percent', { precision: 8, scale: 4 }),
  averageFillPrice: decimal('average_fill_price', { precision: 18, scale: 8 }),
  status: varchar('status', { length: 20 }).notNull(), // new, partially_filled, filled, done_for_day, canceled, expired, replaced, pending_cancel, pending_replace, accepted, pending_new, accepted_for_bidding, stopped, rejected, suspended, calculated
  submittedAt: timestamp('submitted_at').notNull(),
  filledAt: timestamp('filled_at'),
  canceledAt: timestamp('canceled_at'),
  expiredAt: timestamp('expired_at'),
  updatedAt: timestamp('updated_at'),
  legs: jsonb('legs'), // For complex orders
  extendedHours: boolean('extended_hours').default(false).notNull(),
  clientOrderId: varchar('client_order_id', { length: 100 }),
  commission: decimal('commission', { precision: 18, scale: 8 }).default('0').notNull(),
  fees: decimal('fees', { precision: 18, scale: 8 }).default('0').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastSynced: timestamp('last_synced').defaultNow().notNull(),
}, (table) => ({
  accountSymbolIdx: index('orders_account_symbol_idx').on(table.accountId, table.symbol),
  statusIdx: index('orders_status_idx').on(table.status),
  submittedAtIdx: index('orders_submitted_at_idx').on(table.submittedAt),
  sideIdx: index('orders_side_idx').on(table.side),
}));

// Positions table - stores current positions
export const positions = pgTable('positions', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').references(() => tradingAccounts.id).notNull(),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  quantity: decimal('quantity', { precision: 18, scale: 8 }).notNull(),
  side: varchar('side', { length: 5 }).notNull(), // long, short
  marketValue: decimal('market_value', { precision: 18, scale: 2 }),
  costBasis: decimal('cost_basis', { precision: 18, scale: 2 }),
  unrealizedPL: decimal('unrealized_pl', { precision: 18, scale: 2 }),
  unrealizedPLPercent: decimal('unrealized_pl_percent', { precision: 8, scale: 4 }),
  unrealizedIntradayPL: decimal('unrealized_intraday_pl', { precision: 18, scale: 2 }),
  unrealizedIntradayPLPercent: decimal('unrealized_intraday_pl_percent', { precision: 8, scale: 4 }),
  currentPrice: decimal('current_price', { precision: 18, scale: 8 }),
  lastDayPrice: decimal('last_day_price', { precision: 18, scale: 8 }),
  changeToday: decimal('change_today', { precision: 18, scale: 8 }),
  avgEntryPrice: decimal('avg_entry_price', { precision: 18, scale: 8 }),
  qty: decimal('qty', { precision: 18, scale: 8 }).notNull(), // Same as quantity but kept for compatibility
  marketValueSnapshot: decimal('market_value_snapshot', { precision: 18, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastSynced: timestamp('last_synced').defaultNow().notNull(),
}, (table) => ({
  accountSymbolIdx: uniqueIndex('positions_account_symbol_idx').on(table.accountId, table.symbol),
  sideIdx: index('positions_side_idx').on(table.side),
}));

// Trade executions table - stores individual trade fills/executions
export const tradeExecutions = pgTable('trade_executions', {
  id: serial('id').primaryKey(),
  executionId: varchar('execution_id', { length: 100 }).notNull().unique(), // Alpaca execution ID
  orderId: integer('order_id').references(() => orders.id).notNull(),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  side: varchar('side', { length: 4 }).notNull(), // buy, sell
  quantity: decimal('quantity', { precision: 18, scale: 8 }).notNull(),
  price: decimal('price', { precision: 18, scale: 8 }).notNull(),
  timestamp: timestamp('timestamp').notNull(),
  commission: decimal('commission', { precision: 18, scale: 8 }).default('0').notNull(),
  fees: decimal('fees', { precision: 18, scale: 8 }).default('0').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  orderIdIdx: index('trade_executions_order_id_idx').on(table.orderId),
  symbolTimestampIdx: index('trade_executions_symbol_timestamp_idx').on(table.symbol, table.timestamp),
  timestampIdx: index('trade_executions_timestamp_idx').on(table.timestamp),
}));

// Trading sessions table - tracks daily/session P&L
export const tradingSessions = pgTable('trading_sessions', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').references(() => tradingAccounts.id).notNull(),
  date: timestamp('date').notNull(),
  startingBalance: decimal('starting_balance', { precision: 18, scale: 2 }).notNull(),
  endingBalance: decimal('ending_balance', { precision: 18, scale: 2 }),
  dayTradingBuyingPower: decimal('day_trading_buying_power', { precision: 18, scale: 2 }),
  dayTradingBuyingPowerUsed: decimal('day_trading_buying_power_used', { precision: 18, scale: 2 }),
  realizedPL: decimal('realized_pl', { precision: 18, scale: 2 }).default('0').notNull(),
  unrealizedPL: decimal('unrealized_pl', { precision: 18, scale: 2 }).default('0').notNull(),
  totalPL: decimal('total_pl', { precision: 18, scale: 2 }),
  tradesCount: integer('trades_count').default(0).notNull(),
  successfulTrades: integer('successful_trades').default(0).notNull(),
  dayTradeCount: integer('day_trade_count').default(0).notNull(),
  largestWin: decimal('largest_win', { precision: 18, scale: 2 }).default('0').notNull(),
  largestLoss: decimal('largest_loss', { precision: 18, scale: 2 }).default('0').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  accountDateIdx: uniqueIndex('trading_sessions_account_date_idx').on(table.accountId, table.date),
  dateIdx: index('trading_sessions_date_idx').on(table.date),
}));

// Trading risk settings table - stores per-account risk configuration
export const tradingRiskSettings = pgTable('trading_risk_settings', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').references(() => tradingAccounts.id).notNull(),
  maxPositionSizePercent: decimal('max_position_size_percent', { precision: 8, scale: 4 }).default('20').notNull(),
  dailyLossLimit: decimal('daily_loss_limit', { precision: 18, scale: 2 }).default('2000').notNull(),
  perTradeRiskPercent: decimal('per_trade_risk_percent', { precision: 8, scale: 4 }).default('2').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  accountIdIdx: uniqueIndex('trading_risk_settings_account_id_idx').on(table.accountId),
}));

// Automation rules table - stores user-defined live trading triggers
export const automationRules = pgTable('automation_rules', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  condition: varchar('condition', { length: 10 }).notNull(), // above, below
  triggerPrice: decimal('trigger_price', { precision: 18, scale: 8 }).notNull(),
  action: varchar('action', { length: 4 }).notNull(), // buy, sell
  quantity: decimal('quantity', { precision: 18, scale: 8 }).notNull(),
  timeInForce: varchar('time_in_force', { length: 10 }).notNull().default('day'),
  enabled: boolean('enabled').notNull().default(true),
  lastCheckedAt: timestamp('last_checked_at'),
  lastTriggeredAt: timestamp('last_triggered_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('automation_rules_user_id_idx').on(table.userId),
  enabledSymbolIdx: index('automation_rules_enabled_symbol_idx').on(table.enabled, table.symbol),
}));

// Predictions table — stores model-emitted predictions for backtesting prediction accuracy
export const predictions = pgTable('predictions', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  predictedDirection: varchar('predicted_direction', { length: 4 }).notNull(), // up, down, hold
  predictedReturnPercent: decimal('predicted_return_percent', { precision: 8, scale: 4 }),
  horizonDays: integer('horizon_days').notNull().default(5),
  actualReturnPercent: decimal('actual_return_percent', { precision: 8, scale: 4 }),
  actualDirection: varchar('actual_direction', { length: 4 }), // filled at evaluation
  evaluatedAt: timestamp('evaluated_at'),
  modelVersion: varchar('model_version', { length: 50 }).notNull().default('v1'),
  confidence: decimal('confidence', { precision: 5, scale: 4 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  symbolIdx: index('predictions_symbol_idx').on(table.symbol),
  createdAtIdx: index('predictions_created_at_idx').on(table.createdAt),
  evaluatedAtIdx: index('predictions_evaluated_at_idx').on(table.evaluatedAt),
  userIdIdx: index('predictions_user_id_idx').on(table.userId),
}));

// ─── Backtesting ──────────────────────────────────────────────────────────────

export const backtestRuns = pgTable('backtest_runs', {
  id: varchar('id', { length: 50 }).primaryKey(), // bt_<uuid>
  userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbols: jsonb('symbols').notNull(), // string[]
  startDate: varchar('start_date', { length: 10 }).notNull(), // YYYY-MM-DD
  endDate: varchar('end_date', { length: 10 }).notNull(),
  initialCapital: decimal('initial_capital', { precision: 15, scale: 2 }).notNull(),
  buyThreshold: decimal('buy_threshold', { precision: 5, scale: 4 }).notNull(),
  sellThreshold: decimal('sell_threshold', { precision: 5, scale: 4 }).notNull(),
  stopLossPercent: decimal('stop_loss_percent', { precision: 5, scale: 2 }),
  takeProfitPercent: decimal('take_profit_percent', { precision: 5, scale: 2 }),
  status: varchar('status', { length: 20 }).notNull().default('running'), // running|completed|failed
  totalReturn: decimal('total_return', { precision: 15, scale: 2 }),
  totalReturnPercent: decimal('total_return_percent', { precision: 8, scale: 4 }),
  maxDrawdownPercent: decimal('max_drawdown_percent', { precision: 8, scale: 4 }),
  totalTrades: integer('total_trades'),
  winRatePercent: decimal('win_rate_percent', { precision: 8, scale: 4 }),
  finalEquity: decimal('final_equity', { precision: 15, scale: 2 }),
  equityCurve: jsonb('equity_curve'), // Array<{ date: string; equity: number }>
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  userIdIdx: index('backtest_runs_user_id_idx').on(table.userId),
  statusIdx: index('backtest_runs_status_idx').on(table.status),
  createdAtIdx: index('backtest_runs_created_at_idx').on(table.createdAt),
}));

export const backtestTrades = pgTable('backtest_trades', {
  id: serial('id').primaryKey(),
  runId: varchar('run_id', { length: 50 }).notNull().references(() => backtestRuns.id, { onDelete: 'cascade' }),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  side: varchar('side', { length: 4 }).notNull(), // buy|sell
  date: varchar('date', { length: 10 }).notNull(), // YYYY-MM-DD
  price: decimal('price', { precision: 15, scale: 4 }).notNull(),
  quantity: decimal('quantity', { precision: 15, scale: 6 }).notNull(),
  sentiment: decimal('sentiment', { precision: 8, scale: 6 }).notNull(),
  value: decimal('value', { precision: 15, scale: 2 }).notNull(),
  reason: varchar('reason', { length: 20 }), // signal|stop_loss|take_profit|end_of_period
}, (table) => ({
  runIdIdx: index('backtest_trades_run_id_idx').on(table.runId),
  symbolIdx: index('backtest_trades_symbol_idx').on(table.symbol),
}));

export const backtestRunsRelations = relations(backtestRuns, ({ many, one }) => ({
  trades: many(backtestTrades),
  user: one(users, { fields: [backtestRuns.userId], references: [users.id] }),
}));

export const backtestTradesRelations = relations(backtestTrades, ({ one }) => ({
  run: one(backtestRuns, { fields: [backtestTrades.runId], references: [backtestRuns.id] }),
}));

// Add relationships for trading tables
export const tradingAccountsRelations = relations(tradingAccounts, ({ many }) => ({
  orders: many(orders),
  positions: many(positions),
  tradingSessions: many(tradingSessions),
}));

export const automationRulesRelations = relations(automationRules, ({ one }) => ({
  user: one(users, { fields: [automationRules.userId], references: [users.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  account: one(tradingAccounts, {
    fields: [orders.accountId],
    references: [tradingAccounts.id],
  }),
  executions: many(tradeExecutions),
}));

export const positionsRelations = relations(positions, ({ one }) => ({
  account: one(tradingAccounts, {
    fields: [positions.accountId],
    references: [tradingAccounts.id],
  }),
}));

export const tradeExecutionsRelations = relations(tradeExecutions, ({ one }) => ({
  order: one(orders, {
    fields: [tradeExecutions.orderId],
    references: [orders.id],
  }),
}));

export const tradingSessionsRelations = relations(tradingSessions, ({ one }) => ({
  account: one(tradingAccounts, {
    fields: [tradingSessions.accountId],
    references: [tradingAccounts.id],
  }),
}));

export const tradingRiskSettingsRelations = relations(tradingRiskSettings, ({ one }) => ({
  account: one(tradingAccounts, {
    fields: [tradingRiskSettings.accountId],
    references: [tradingAccounts.id],
  }),
}));

// ─── Auth relations ───────────────────────────────────────────────────────────

export const predictionsRelations = relations(predictions, ({ one }) => ({
  user: one(users, { fields: [predictions.userId], references: [users.id] }),
}));

export const usersRelations = relations(users, ({ many, one }) => ({
  refreshTokens: many(refreshTokens),
  settings: one(userSettings, { fields: [users.id], references: [userSettings.userId] }),
  apiKeys: many(userApiKeys),
  portfolioEntries: many(portfolioEntries),
  tradingAccounts: many(tradingAccounts),
  predictions: many(predictions),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));

export const userApiKeysRelations = relations(userApiKeys, ({ one }) => ({
  user: one(users, { fields: [userApiKeys.userId], references: [users.id] }),
}));

// ─── Strategy Engine ──────────────────────────────────────────────────────────

/**
 * One suggestion per (symbol, strategy) per engine run.
 * Tracks both the generated signal and the eventual outcome for accuracy measurement.
 */
export const strategySuggestions = pgTable('strategy_suggestions', {
  id: serial('id').primaryKey(),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  strategy: varchar('strategy', { length: 25 }).notNull(), // social_momentum | fundamental_flow | full_spectrum
  signal: varchar('signal', { length: 15 }).notNull(),     // strong_buy | buy | hold | sell | strong_sell
  convictionScore: decimal('conviction_score', { precision: 5, scale: 4 }).notNull(), // 0.0–1.0
  convictionPct: integer('conviction_pct').notNull(),       // 0–100

  // Raw signal inputs (before weighting)
  redditSentiment: decimal('reddit_sentiment', { precision: 5, scale: 4 }),
  redditMentions: integer('reddit_mentions'),
  redditTrendScore: decimal('reddit_trend_score', { precision: 5, scale: 4 }),
  newsSentiment: decimal('news_sentiment', { precision: 5, scale: 4 }),
  newsMentions: integer('news_mentions'),
  taScore: decimal('ta_score', { precision: 5, scale: 4 }),
  taSignal: varchar('ta_signal', { length: 20 }),
  daysToEarnings: integer('days_to_earnings'),              // null = unknown
  calendarCatalystScore: decimal('calendar_catalyst_score', { precision: 5, scale: 4 }),

  // Price targets
  currentPrice: decimal('current_price', { precision: 18, scale: 8 }),
  entryPrice: decimal('entry_price', { precision: 18, scale: 8 }),
  stopLoss: decimal('stop_loss', { precision: 18, scale: 8 }),
  takeProfit: decimal('take_profit', { precision: 18, scale: 8 }),
  suggestedPositionPct: decimal('suggested_position_pct', { precision: 5, scale: 2 }),

  // Full JSON breakdown for research
  signalBreakdown: jsonb('signal_breakdown').notNull().default({}),

  // Outcome tracking (filled by suggestionEvaluator)
  horizonDays: integer('horizon_days').notNull().default(5),
  evaluatedAt: timestamp('evaluated_at'),
  priceAtEvaluation: decimal('price_at_evaluation', { precision: 18, scale: 8 }),
  actualReturnPct: decimal('actual_return_pct', { precision: 8, scale: 4 }),
  predictionCorrect: boolean('prediction_correct'),

  generatedAt: timestamp('generated_at').defaultNow().notNull(),
  engineVersion: varchar('engine_version', { length: 10 }).notNull().default('v1'),
}, (table) => ({
  symbolIdx: index('strategy_suggestions_symbol_idx').on(table.symbol),
  strategyIdx: index('strategy_suggestions_strategy_idx').on(table.strategy),
  signalIdx: index('strategy_suggestions_signal_idx').on(table.signal),
  generatedAtIdx: index('strategy_suggestions_generated_at_idx').on(table.generatedAt),
  evaluatedAtIdx: index('strategy_suggestions_evaluated_at_idx').on(table.evaluatedAt),
}));

/**
 * Normalised per-signal rows — one row per signal per suggestion.
 * Enables per-signal accuracy analysis across many suggestions.
 */
export const suggestionSignals = pgTable('suggestion_signals', {
  id: serial('id').primaryKey(),
  suggestionId: integer('suggestion_id').notNull().references(() => strategySuggestions.id, { onDelete: 'cascade' }),
  signalName: varchar('signal_name', { length: 50 }).notNull(),
  rawValue: decimal('raw_value', { precision: 10, scale: 6 }),
  normalizedValue: decimal('normalized_value', { precision: 5, scale: 4 }), // -1 to 1
  weight: decimal('weight', { precision: 5, scale: 4 }).notNull(),
  weightedContribution: decimal('weighted_contribution', { precision: 5, scale: 4 }),
}, (table) => ({
  suggestionIdIdx: index('suggestion_signals_suggestion_id_idx').on(table.suggestionId),
  signalNameIdx: index('suggestion_signals_signal_name_idx').on(table.signalName),
}));

// ─── Strategy Backtest Results ────────────────────────────────────────────────

/**
 * One row per backtest run (or per strategy within a comparison run).
 * Stores config, summary metrics, and equity curve for retrieval.
 */
export const strategyBacktestRuns = pgTable('strategy_backtest_runs', {
  id: serial('id').primaryKey(),

  // Configuration
  symbols:             jsonb('symbols').notNull(),                          // string[]
  strategy:            varchar('strategy', { length: 25 }).notNull(),       // 'all' for comparisons
  startDate:           varchar('start_date', { length: 10 }).notNull(),     // 'YYYY-MM-DD'
  endDate:             varchar('end_date', { length: 10 }).notNull(),
  initialCapital:      decimal('initial_capital', { precision: 15, scale: 2 }).notNull(),
  convictionThreshold: decimal('conviction_threshold', { precision: 4, scale: 3 }).notNull(),
  maxPositionPct:      decimal('max_position_pct', { precision: 4, scale: 3 }).notNull(),
  stopLossEnabled:     boolean('stop_loss_enabled').notNull().default(true),
  takeProfitEnabled:   boolean('take_profit_enabled').notNull().default(true),

  // Status
  status:  varchar('status', { length: 15 }).notNull().default('completed'), // running | completed | failed
  errorMessage: text('error_message'),

  // Summary metrics (from PerformanceReport)
  totalReturnPct:       decimal('total_return_pct', { precision: 10, scale: 4 }),
  annualizedReturnPct:  decimal('annualized_return_pct', { precision: 10, scale: 4 }),
  sharpeRatio:          decimal('sharpe_ratio', { precision: 8, scale: 4 }),
  sortinoRatio:         decimal('sortino_ratio', { precision: 8, scale: 4 }),
  maxDrawdownPct:       decimal('max_drawdown_pct', { precision: 8, scale: 4 }),
  winRatePct:           decimal('win_rate_pct', { precision: 6, scale: 2 }),
  totalTrades:          integer('total_trades'),
  winningTrades:        integer('winning_trades'),
  losingTrades:         integer('losing_trades'),
  benchmarkReturnPct:   decimal('benchmark_return_pct', { precision: 10, scale: 4 }),
  alpha:                decimal('alpha', { precision: 10, scale: 4 }),

  // Full equity curve stored as JSONB for charting
  equityCurve: jsonb('equity_curve').notNull().default([]),

  // Comparison metadata (null if single-strategy run)
  comparisonWinner:     varchar('comparison_winner', { length: 25 }),
  comparisonWinnerReason: text('comparison_winner_reason'),
  modelVersion:         varchar('model_version', { length: 120 }),
  modelMetadata:        jsonb('model_metadata'),
  comparisonConfig:     jsonb('comparison_config'),

  createdAt:   timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  strategyIdx: index('strategy_backtest_runs_strategy_idx').on(table.strategy),
  createdAtIdx: index('strategy_backtest_runs_created_at_idx').on(table.createdAt),
}));

/**
 * Pausable/resumable multi-strategy comparison jobs (background worker + checkpoints).
 */
export const strategyComparisonJobs = pgTable('strategy_comparison_jobs', {
  id: serial('id').primaryKey(),
  jobType: varchar('job_type', { length: 32 }).notNull().default('comparison'),
  status: varchar('status', { length: 16 }).notNull().default('queued'),
  requestConfig: jsonb('request_config').notNull(),
  checkpoint: jsonb('checkpoint'),
  progress: jsonb('progress'),
  result: jsonb('result'),
  errorMessage: text('error_message'),
  runIds: jsonb('run_ids'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  statusIdx: index('strategy_comparison_jobs_status_idx').on(table.status),
  createdAtIdx: index('strategy_comparison_jobs_created_at_idx').on(table.createdAt),
}));

/**
 * Individual simulated trades from a backtest run.
 */
export const strategyBacktestTrades = pgTable('strategy_backtest_trades', {
  id:           serial('id').primaryKey(),
  runId:        integer('run_id').notNull().references(() => strategyBacktestRuns.id, { onDelete: 'cascade' }),
  symbol:       varchar('symbol', { length: 10 }).notNull(),
  strategy:     varchar('strategy', { length: 25 }).notNull(),
  side:         varchar('side', { length: 4 }).notNull(),    // 'buy' | 'sell'
  date:         varchar('date', { length: 10 }).notNull(),   // 'YYYY-MM-DD'
  price:        decimal('price', { precision: 18, scale: 8 }).notNull(),
  quantity:     integer('quantity').notNull(),
  value:        decimal('value', { precision: 18, scale: 4 }).notNull(),
  reason:       varchar('reason', { length: 20 }).notNull(), // signal_entry | stop_loss | etc.
  conviction:   decimal('conviction', { precision: 5, scale: 4 }),
  pnl:          decimal('pnl', { precision: 18, scale: 4 }), // only on sell trades
}, (table) => ({
  runIdIdx:    index('strategy_backtest_trades_run_id_idx').on(table.runId),
  symbolIdx:   index('strategy_backtest_trades_symbol_idx').on(table.symbol),
  strategyIdx: index('strategy_backtest_trades_strategy_idx').on(table.strategy),
}));

/**
 * Post-hoc analysis of a completed backtest run with proposed parameter improvements.
 */
export const strategyRunAnalyses = pgTable('strategy_run_analyses', {
  id: serial('id').primaryKey(),
  sourceRunId: integer('source_run_id').notNull().references(() => strategyBacktestRuns.id, { onDelete: 'cascade' }),
  analysis: jsonb('analysis').notNull(),
  proposedConfig: jsonb('proposed_config').notNull(),
  validationJobId: integer('validation_job_id').references(() => strategyComparisonJobs.id, { onDelete: 'set null' }),
  validationRunId: integer('validation_run_id').references(() => strategyBacktestRuns.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sourceRunIdIdx: index('strategy_run_analyses_source_run_id_idx').on(table.sourceRunId),
}));

/**
 * Point-in-time index membership history for academically defensible universe selection.
 * One row covers a continuous membership window for one symbol within one index.
 */
export const indexConstituents = pgTable('index_constituents', {
  id: serial('id').primaryKey(),
  indexCode: varchar('index_code', { length: 32 }).notNull(),
  symbol: varchar('symbol', { length: 16 }).notNull(),
  effectiveFrom: varchar('effective_from', { length: 10 }).notNull(),
  effectiveTo: varchar('effective_to', { length: 10 }),
  source: varchar('source', { length: 64 }).notNull().default('manual'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  indexCodeIdx: index('index_constituents_index_code_idx').on(table.indexCode),
  symbolIdx: index('index_constituents_symbol_idx').on(table.symbol),
  effectiveFromIdx: index('index_constituents_effective_from_idx').on(table.effectiveFrom),
  indexSymbolFromIdx: uniqueIndex('index_constituents_index_symbol_from_idx').on(
    table.indexCode,
    table.symbol,
    table.effectiveFrom
  ),
}));

/**
 * Persisted earnings calendar events used for point-in-time catalyst scoring.
 * This stores the actual event date instead of inferring catalysts from news text.
 */
export const earningsEvents = pgTable('earnings_events', {
  id: serial('id').primaryKey(),
  symbol: varchar('symbol', { length: 16 }).notNull(),
  eventDate: varchar('event_date', { length: 10 }).notNull(),
  fiscalYear: integer('fiscal_year'),
  fiscalQuarter: integer('fiscal_quarter'),
  eventHour: varchar('event_hour', { length: 16 }),
  epsActual: decimal('eps_actual', { precision: 18, scale: 6 }),
  epsEstimate: decimal('eps_estimate', { precision: 18, scale: 6 }),
  revenueActual: decimal('revenue_actual', { precision: 20, scale: 2 }),
  revenueEstimate: decimal('revenue_estimate', { precision: 20, scale: 2 }),
  source: varchar('source', { length: 64 }).notNull().default('finnhub_calendar'),
  metadata: jsonb('metadata').notNull().default({}),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
}, (table) => ({
  symbolDateIdx: uniqueIndex('earnings_events_symbol_date_source_idx').on(
    table.symbol,
    table.eventDate,
    table.source
  ),
  symbolIdx: index('earnings_events_symbol_idx').on(table.symbol),
  eventDateIdx: index('earnings_events_event_date_idx').on(table.eventDate),
}));

export const strategySuggestionsRelations = relations(strategySuggestions, ({ many }) => ({
  signals: many(suggestionSignals),
}));

export const suggestionSignalsRelations = relations(suggestionSignals, ({ one }) => ({
  suggestion: one(strategySuggestions, { fields: [suggestionSignals.suggestionId], references: [strategySuggestions.id] }),
}));

export const strategyBacktestRunsRelations = relations(strategyBacktestRuns, ({ many }) => ({
  trades: many(strategyBacktestTrades),
  analyses: many(strategyRunAnalyses),
}));

export const strategyRunAnalysesRelations = relations(strategyRunAnalyses, ({ one }) => ({
  sourceRun: one(strategyBacktestRuns, { fields: [strategyRunAnalyses.sourceRunId], references: [strategyBacktestRuns.id] }),
  validationJob: one(strategyComparisonJobs, { fields: [strategyRunAnalyses.validationJobId], references: [strategyComparisonJobs.id] }),
}));

export const strategyBacktestTradesRelations = relations(strategyBacktestTrades, ({ one }) => ({
  run: one(strategyBacktestRuns, { fields: [strategyBacktestTrades.runId], references: [strategyBacktestRuns.id] }),
}));

// Export all tables for use in queries
export const schema = {
  users,
  refreshTokens,
  userSettings,
  userApiKeys,
  portfolioEntries,
  historicalPrices,
  apiResponseCache,
  newsArticles,
  redditPosts,
  redditComments,
  redditApiCalls,
  redditBackfillConfig,
  redditBackfillProgress,
  subredditConfigs,
  sentimentScores,
  watchlist,
  importHistory,
  calendarReminders,
  tradingAccounts,
  orders,
  positions,
  tradeExecutions,
  tradingSessions,
  tradingRiskSettings,
  automationRules,
  backtestRuns,
  backtestTrades,
  predictions,
  strategySuggestions,
  suggestionSignals,
  strategyBacktestRuns,
  strategyBacktestTrades,
  strategyRunAnalyses,
  indexConstituents,
  earningsEvents,
};