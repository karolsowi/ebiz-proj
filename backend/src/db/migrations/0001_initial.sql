-- Initial migration for InWest investment platform
-- Creates all necessary tables for portfolio management, market data, and sentiment analysis

-- Enable UUID extension for potential future use
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Portfolio entries table - stores user's investment holdings
CREATE TABLE IF NOT EXISTS portfolio_entries (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(10) NOT NULL,
    name VARCHAR(255),
    quantity DECIMAL(18,8) NOT NULL,
    average_cost DECIMAL(18,8) NOT NULL,
    current_price DECIMAL(18,8),
    total_value DECIMAL(18,8),
    gain_loss DECIMAL(18,8),
    gain_loss_percent DECIMAL(8,4),
    sector VARCHAR(100),
    industry VARCHAR(100),
    asset_type VARCHAR(50) NOT NULL DEFAULT 'stock',
    source VARCHAR(50) NOT NULL DEFAULT 'manual',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Historical prices table - stores price data for stocks/crypto
CREATE TABLE IF NOT EXISTS historical_prices (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(10) NOT NULL,
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    open DECIMAL(18,8) NOT NULL,
    high DECIMAL(18,8) NOT NULL,
    low DECIMAL(18,8) NOT NULL,
    close DECIMAL(18,8) NOT NULL,
    volume INTEGER,
    adjusted_close DECIMAL(18,8),
    dividend_amount DECIMAL(18,8),
    split_coefficient DECIMAL(8,4),
    source VARCHAR(50) NOT NULL,
    timeframe VARCHAR(20) NOT NULL DEFAULT 'daily',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- API response cache table - stores cached API responses to avoid overuse
CREATE TABLE IF NOT EXISTS api_response_cache (
    id SERIAL PRIMARY KEY,
    endpoint VARCHAR(255) NOT NULL,
    parameters JSONB NOT NULL,
    response JSONB NOT NULL,
    source VARCHAR(50) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    hit_count INTEGER DEFAULT 0 NOT NULL,
    last_accessed TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- News articles table - stores financial news and articles
CREATE TABLE IF NOT EXISTS news_articles (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    summary TEXT,
    content TEXT,
    url VARCHAR(1000) NOT NULL,
    image_url VARCHAR(1000),
    source VARCHAR(100) NOT NULL,
    author VARCHAR(255),
    published_at TIMESTAMP WITH TIME ZONE NOT NULL,
    category VARCHAR(100),
    symbols JSONB,
    sentiment VARCHAR(20),
    sentiment_score DECIMAL(5,4),
    relevance_score DECIMAL(5,4),
    is_processed BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Reddit posts table - stores Reddit posts for sentiment analysis
CREATE TABLE IF NOT EXISTS reddit_posts (
    id SERIAL PRIMARY KEY,
    reddit_id VARCHAR(20) NOT NULL,
    subreddit VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    content TEXT,
    author VARCHAR(100),
    score INTEGER DEFAULT 0 NOT NULL,
    upvote_ratio DECIMAL(5,4),
    num_comments INTEGER DEFAULT 0 NOT NULL,
    url VARCHAR(1000) NOT NULL,
    permalink VARCHAR(500) NOT NULL,
    created_utc TIMESTAMP WITH TIME ZONE NOT NULL,
    symbols JSONB,
    sentiment VARCHAR(20),
    sentiment_score DECIMAL(5,4),
    relevance_score DECIMAL(5,4),
    is_processed BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Sentiment scores table - aggregated sentiment data by symbol and time period
CREATE TABLE IF NOT EXISTS sentiment_scores (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(10) NOT NULL,
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    timeframe VARCHAR(20) NOT NULL DEFAULT 'daily',
    source VARCHAR(50) NOT NULL,
    bullish_count INTEGER DEFAULT 0 NOT NULL,
    bearish_count INTEGER DEFAULT 0 NOT NULL,
    neutral_count INTEGER DEFAULT 0 NOT NULL,
    total_mentions INTEGER DEFAULT 0 NOT NULL,
    average_sentiment DECIMAL(5,4),
    weighted_sentiment DECIMAL(5,4),
    confidence_score DECIMAL(5,4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Watchlist table - stores user's watchlist
CREATE TABLE IF NOT EXISTS watchlist (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(10) NOT NULL,
    name VARCHAR(255),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    notes TEXT,
    alert_price DECIMAL(18,8),
    alert_enabled BOOLEAN DEFAULT FALSE NOT NULL
);

-- Import history table - tracks CSV imports and data sources
CREATE TABLE IF NOT EXISTS import_history (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    file_size INTEGER,
    records_processed INTEGER DEFAULT 0 NOT NULL,
    records_successful INTEGER DEFAULT 0 NOT NULL,
    records_failed INTEGER DEFAULT 0 NOT NULL,
    import_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    error_log JSONB,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for better performance

-- Portfolio entries indexes
CREATE INDEX IF NOT EXISTS portfolio_symbol_idx ON portfolio_entries(symbol);
CREATE INDEX IF NOT EXISTS portfolio_asset_type_idx ON portfolio_entries(asset_type);
CREATE INDEX IF NOT EXISTS portfolio_source_idx ON portfolio_entries(source);

-- Historical prices indexes
CREATE UNIQUE INDEX IF NOT EXISTS historical_symbol_date_timeframe_idx ON historical_prices(symbol, date, timeframe);
CREATE INDEX IF NOT EXISTS historical_symbol_idx ON historical_prices(symbol);
CREATE INDEX IF NOT EXISTS historical_date_idx ON historical_prices(date);
CREATE INDEX IF NOT EXISTS historical_source_idx ON historical_prices(source);

-- API cache indexes
CREATE UNIQUE INDEX IF NOT EXISTS api_cache_endpoint_params_idx ON api_response_cache(endpoint, parameters);
CREATE INDEX IF NOT EXISTS api_cache_source_idx ON api_response_cache(source);
CREATE INDEX IF NOT EXISTS api_cache_expires_idx ON api_response_cache(expires_at);

-- News articles indexes
CREATE UNIQUE INDEX IF NOT EXISTS news_url_idx ON news_articles(url);
CREATE INDEX IF NOT EXISTS news_source_idx ON news_articles(source);
CREATE INDEX IF NOT EXISTS news_published_idx ON news_articles(published_at);
CREATE INDEX IF NOT EXISTS news_category_idx ON news_articles(category);
CREATE INDEX IF NOT EXISTS news_sentiment_idx ON news_articles(sentiment);
CREATE INDEX IF NOT EXISTS news_symbols_idx ON news_articles USING GIN(symbols);

-- Reddit posts indexes
CREATE UNIQUE INDEX IF NOT EXISTS reddit_id_idx ON reddit_posts(reddit_id);
CREATE INDEX IF NOT EXISTS reddit_subreddit_idx ON reddit_posts(subreddit);
CREATE INDEX IF NOT EXISTS reddit_created_idx ON reddit_posts(created_utc);
CREATE INDEX IF NOT EXISTS reddit_sentiment_idx ON reddit_posts(sentiment);
CREATE INDEX IF NOT EXISTS reddit_symbols_idx ON reddit_posts USING GIN(symbols);
CREATE INDEX IF NOT EXISTS reddit_score_idx ON reddit_posts(score);

-- Sentiment scores indexes
CREATE UNIQUE INDEX IF NOT EXISTS sentiment_symbol_date_timeframe_idx ON sentiment_scores(symbol, date, timeframe, source);
CREATE INDEX IF NOT EXISTS sentiment_symbol_idx ON sentiment_scores(symbol);
CREATE INDEX IF NOT EXISTS sentiment_date_idx ON sentiment_scores(date);
CREATE INDEX IF NOT EXISTS sentiment_source_idx ON sentiment_scores(source);

-- Watchlist indexes
CREATE UNIQUE INDEX IF NOT EXISTS watchlist_symbol_idx ON watchlist(symbol);

-- Import history indexes
CREATE INDEX IF NOT EXISTS import_status_idx ON import_history(status);
CREATE INDEX IF NOT EXISTS import_type_idx ON import_history(import_type);
CREATE INDEX IF NOT EXISTS import_created_idx ON import_history(created_at);

-- Create triggers for automatic updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables with updated_at columns
CREATE TRIGGER update_portfolio_entries_updated_at 
    BEFORE UPDATE ON portfolio_entries 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sentiment_scores_updated_at 
    BEFORE UPDATE ON sentiment_scores 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert some sample data for testing (optional)
INSERT INTO portfolio_entries (symbol, name, quantity, average_cost, sector, industry, asset_type, source) VALUES
    ('AAPL', 'Apple Inc.', 100, 150.00, 'Technology', 'Consumer Electronics', 'stock', 'manual'),
    ('GOOGL', 'Alphabet Inc.', 50, 2500.00, 'Technology', 'Internet Services', 'stock', 'manual'),
    ('MSFT', 'Microsoft Corporation', 75, 300.00, 'Technology', 'Software', 'stock', 'manual')
ON CONFLICT DO NOTHING;

-- Add some sample watchlist entries
INSERT INTO watchlist (symbol, name) VALUES
    ('TSLA', 'Tesla Inc.'),
    ('AMZN', 'Amazon.com Inc.'),
    ('NVDA', 'NVIDIA Corporation')
ON CONFLICT DO NOTHING; 