CREATE TABLE IF NOT EXISTS "api_response_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"parameters" jsonb NOT NULL,
	"response" jsonb NOT NULL,
	"source" varchar(50) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_accessed" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "historical_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"date" timestamp NOT NULL,
	"open" numeric(18, 8) NOT NULL,
	"high" numeric(18, 8) NOT NULL,
	"low" numeric(18, 8) NOT NULL,
	"close" numeric(18, 8) NOT NULL,
	"volume" integer,
	"adjusted_close" numeric(18, 8),
	"dividend_amount" numeric(18, 8),
	"split_coefficient" numeric(8, 4),
	"source" varchar(50) NOT NULL,
	"timeframe" varchar(20) DEFAULT 'daily' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" varchar(255) NOT NULL,
	"file_size" integer,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"records_successful" integer DEFAULT 0 NOT NULL,
	"records_failed" integer DEFAULT 0 NOT NULL,
	"import_type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_log" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "news_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(500) NOT NULL,
	"summary" text,
	"content" text,
	"url" varchar(1000) NOT NULL,
	"image_url" varchar(1000),
	"source" varchar(100) NOT NULL,
	"author" varchar(255),
	"published_at" timestamp NOT NULL,
	"category" varchar(100),
	"symbols" jsonb,
	"sentiment" varchar(20),
	"sentiment_score" numeric(5, 4),
	"relevance_score" numeric(5, 4),
	"is_processed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" varchar(100) NOT NULL,
	"account_id" integer NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"side" varchar(4) NOT NULL,
	"order_type" varchar(20) NOT NULL,
	"time_in_force" varchar(10) NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"filled_quantity" numeric(18, 8) DEFAULT '0' NOT NULL,
	"limit_price" numeric(18, 8),
	"stop_price" numeric(18, 8),
	"trail_price" numeric(18, 8),
	"trail_percent" numeric(8, 4),
	"average_fill_price" numeric(18, 8),
	"status" varchar(20) NOT NULL,
	"submitted_at" timestamp NOT NULL,
	"filled_at" timestamp,
	"canceled_at" timestamp,
	"expired_at" timestamp,
	"updated_at" timestamp,
	"legs" jsonb,
	"extended_hours" boolean DEFAULT false NOT NULL,
	"client_order_id" varchar(100),
	"commission" numeric(18, 8) DEFAULT '0' NOT NULL,
	"fees" numeric(18, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_synced" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"name" varchar(255),
	"quantity" numeric(18, 8) NOT NULL,
	"average_cost" numeric(18, 8) NOT NULL,
	"current_price" numeric(18, 8),
	"total_value" numeric(18, 8),
	"gain_loss" numeric(18, 8),
	"gain_loss_percent" numeric(8, 4),
	"sector" varchar(100),
	"industry" varchar(100),
	"asset_type" varchar(50) DEFAULT 'stock' NOT NULL,
	"source" varchar(50) DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"side" varchar(5) NOT NULL,
	"market_value" numeric(18, 2),
	"cost_basis" numeric(18, 2),
	"unrealized_pl" numeric(18, 2),
	"unrealized_pl_percent" numeric(8, 4),
	"unrealized_intraday_pl" numeric(18, 2),
	"unrealized_intraday_pl_percent" numeric(8, 4),
	"current_price" numeric(18, 8),
	"last_day_price" numeric(18, 8),
	"change_today" numeric(18, 8),
	"avg_entry_price" numeric(18, 8),
	"qty" numeric(18, 8) NOT NULL,
	"market_value_snapshot" numeric(18, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_synced" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reddit_api_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"method" varchar(10) DEFAULT 'GET' NOT NULL,
	"parameters" jsonb,
	"response_code" integer NOT NULL,
	"response_time" integer NOT NULL,
	"rate_limited" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"post_id" varchar(20),
	"posts_count" integer,
	"comments_count" integer,
	"called_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reddit_comments" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"post_id" varchar(20) NOT NULL,
	"parent_id" varchar(20),
	"author" varchar(100) NOT NULL,
	"content" text NOT NULL,
	"score" integer NOT NULL,
	"created" timestamp NOT NULL,
	"edited" timestamp,
	"is_stickied" boolean DEFAULT false NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"sentiment_score" numeric(5, 4),
	"sentiment_label" varchar(20),
	"confidence_score" numeric(5, 4),
	"detected_stocks" jsonb,
	"detected_sectors" jsonb,
	"financial_relevance" numeric(5, 4),
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reddit_posts" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"subreddit" varchar(100) NOT NULL,
	"title" varchar(500) NOT NULL,
	"content" text,
	"author" varchar(100),
	"score" integer DEFAULT 0 NOT NULL,
	"upvote_ratio" numeric(5, 4),
	"num_comments" integer DEFAULT 0 NOT NULL,
	"url" varchar(1000),
	"domain" varchar(255),
	"flair" varchar(100),
	"is_stickied" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"is_nsfw" boolean DEFAULT false NOT NULL,
	"permalink" varchar(500) NOT NULL,
	"created" timestamp NOT NULL,
	"sentiment_score" numeric(5, 4),
	"sentiment_label" varchar(20),
	"confidence_score" numeric(5, 4),
	"detected_stocks" jsonb,
	"detected_sectors" jsonb,
	"financial_relevance" numeric(5, 4),
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sentiment_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(20) NOT NULL,
	"target_id" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sentiment_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"date" timestamp NOT NULL,
	"timeframe" varchar(20) DEFAULT 'daily' NOT NULL,
	"source" varchar(50) NOT NULL,
	"bullish_count" integer DEFAULT 0 NOT NULL,
	"bearish_count" integer DEFAULT 0 NOT NULL,
	"neutral_count" integer DEFAULT 0 NOT NULL,
	"total_mentions" integer DEFAULT 0 NOT NULL,
	"average_sentiment" numeric(5, 4),
	"weighted_sentiment" numeric(5, 4),
	"confidence_score" numeric(5, 4),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subreddit_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"fetch_posts" boolean DEFAULT true NOT NULL,
	"fetch_comments" boolean DEFAULT true NOT NULL,
	"max_post_age" integer DEFAULT 7 NOT NULL,
	"max_comment_age" integer DEFAULT 2 NOT NULL,
	"last_fetched" timestamp,
	"fetch_interval" integer DEFAULT 300 NOT NULL,
	"enable_sentiment" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subreddit_configs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trade_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"execution_id" varchar(100) NOT NULL,
	"order_id" integer NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"side" varchar(4) NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"commission" numeric(18, 8) DEFAULT '0' NOT NULL,
	"fees" numeric(18, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trade_executions_execution_id_unique" UNIQUE("execution_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trading_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"provider" varchar(50) DEFAULT 'alpaca' NOT NULL,
	"account_type" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"balance" numeric(18, 2),
	"buying_power" numeric(18, 2),
	"portfolio_value" numeric(18, 2),
	"day_trade_count" integer DEFAULT 0 NOT NULL,
	"pattern_day_trader" boolean DEFAULT false NOT NULL,
	"trading_blocked" boolean DEFAULT false NOT NULL,
	"transfers_blocked" boolean DEFAULT false NOT NULL,
	"account_blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_synced" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trading_accounts_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trading_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"starting_balance" numeric(18, 2) NOT NULL,
	"ending_balance" numeric(18, 2),
	"day_trading_buying_power" numeric(18, 2),
	"day_trading_buying_power_used" numeric(18, 2),
	"realized_pl" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unrealized_pl" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_pl" numeric(18, 2),
	"trades_count" integer DEFAULT 0 NOT NULL,
	"successful_trades" integer DEFAULT 0 NOT NULL,
	"day_trade_count" integer DEFAULT 0 NOT NULL,
	"largest_win" numeric(18, 2) DEFAULT '0' NOT NULL,
	"largest_loss" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"name" varchar(255),
	"added_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"alert_price" numeric(18, 8),
	"alert_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_cache_endpoint_params_idx" ON "api_response_cache" ("endpoint","parameters");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_cache_source_idx" ON "api_response_cache" ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_cache_expires_idx" ON "api_response_cache" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "historical_symbol_date_timeframe_idx" ON "historical_prices" ("symbol","date","timeframe");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "historical_symbol_idx" ON "historical_prices" ("symbol");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "historical_date_idx" ON "historical_prices" ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "historical_source_idx" ON "historical_prices" ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_status_idx" ON "import_history" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_type_idx" ON "import_history" ("import_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_created_idx" ON "import_history" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "news_url_idx" ON "news_articles" ("url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_source_idx" ON "news_articles" ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_published_idx" ON "news_articles" ("published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_category_idx" ON "news_articles" ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_sentiment_idx" ON "news_articles" ("sentiment");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_symbols_idx" ON "news_articles" ("symbols");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_account_symbol_idx" ON "orders" ("account_id","symbol");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_submitted_at_idx" ON "orders" ("submitted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_side_idx" ON "orders" ("side");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_symbol_idx" ON "portfolio_entries" ("symbol");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_asset_type_idx" ON "portfolio_entries" ("asset_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_source_idx" ON "portfolio_entries" ("source");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "positions_account_symbol_idx" ON "positions" ("account_id","symbol");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_side_idx" ON "positions" ("side");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_api_calls_endpoint_called_at_idx" ON "reddit_api_calls" ("endpoint","called_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_api_calls_called_at_idx" ON "reddit_api_calls" ("called_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_api_calls_rate_limited_idx" ON "reddit_api_calls" ("rate_limited");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_comments_post_id_idx" ON "reddit_comments" ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_comments_parent_id_idx" ON "reddit_comments" ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_comments_created_idx" ON "reddit_comments" ("created");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_comments_sentiment_score_idx" ON "reddit_comments" ("sentiment_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_posts_subreddit_created_idx" ON "reddit_posts" ("subreddit","created");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_posts_created_idx" ON "reddit_posts" ("created");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_posts_sentiment_score_idx" ON "reddit_posts" ("sentiment_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_posts_fetched_at_idx" ON "reddit_posts" ("fetched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sentiment_jobs_status_priority_idx" ON "sentiment_jobs" ("status","priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sentiment_jobs_created_at_idx" ON "sentiment_jobs" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sentiment_symbol_date_timeframe_idx" ON "sentiment_scores" ("symbol","date","timeframe","source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sentiment_symbol_idx" ON "sentiment_scores" ("symbol");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sentiment_date_idx" ON "sentiment_scores" ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sentiment_source_idx" ON "sentiment_scores" ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subreddit_configs_is_active_idx" ON "subreddit_configs" ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subreddit_configs_last_fetched_idx" ON "subreddit_configs" ("last_fetched");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_executions_order_id_idx" ON "trade_executions" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_executions_symbol_timestamp_idx" ON "trade_executions" ("symbol","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_executions_timestamp_idx" ON "trade_executions" ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trading_accounts_provider_type_idx" ON "trading_accounts" ("provider","account_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trading_accounts_status_idx" ON "trading_accounts" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trading_sessions_account_date_idx" ON "trading_sessions" ("account_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trading_sessions_date_idx" ON "trading_sessions" ("date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "watchlist_symbol_idx" ON "watchlist" ("symbol");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trade_executions" ADD CONSTRAINT "trade_executions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trading_sessions" ADD CONSTRAINT "trading_sessions_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
