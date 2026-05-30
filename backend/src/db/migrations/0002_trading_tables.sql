-- Migration: Add trading tables for comprehensive trade tracking
-- Created: 2024-01-01
-- Description: Adds trading accounts, orders, positions, executions, and sessions tables

-- Trading accounts table - stores different trading account types
CREATE TABLE IF NOT EXISTS trading_accounts (
    id SERIAL PRIMARY KEY,
    account_id VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL DEFAULT 'alpaca',
    account_type VARCHAR(20) NOT NULL, -- paper, live
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    balance DECIMAL(18, 2),
    buying_power DECIMAL(18, 2),
    portfolio_value DECIMAL(18, 2),
    day_trade_count INTEGER DEFAULT 0 NOT NULL,
    pattern_day_trader BOOLEAN DEFAULT false NOT NULL,
    trading_blocked BOOLEAN DEFAULT false NOT NULL,
    transfers_blocked BOOLEAN DEFAULT false NOT NULL,
    account_blocked BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    last_synced TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for trading_accounts
CREATE INDEX IF NOT EXISTS trading_accounts_provider_type_idx ON trading_accounts(provider, account_type);
CREATE INDEX IF NOT EXISTS trading_accounts_status_idx ON trading_accounts(status);

-- Orders table - stores all trading orders
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(100) NOT NULL UNIQUE,
    account_id INTEGER NOT NULL REFERENCES trading_accounts(id),
    symbol VARCHAR(10) NOT NULL,
    side VARCHAR(4) NOT NULL, -- buy, sell
    order_type VARCHAR(20) NOT NULL, -- market, limit, stop, stop_limit, trailing_stop
    time_in_force VARCHAR(10) NOT NULL, -- day, gtc, ioc, fok
    quantity DECIMAL(18, 8) NOT NULL,
    filled_quantity DECIMAL(18, 8) DEFAULT 0 NOT NULL,
    limit_price DECIMAL(18, 8),
    stop_price DECIMAL(18, 8),
    trail_price DECIMAL(18, 8),
    trail_percent DECIMAL(8, 4),
    average_fill_price DECIMAL(18, 8),
    status VARCHAR(20) NOT NULL, -- new, partially_filled, filled, done_for_day, canceled, expired, etc.
    submitted_at TIMESTAMP NOT NULL,
    filled_at TIMESTAMP,
    canceled_at TIMESTAMP,
    expired_at TIMESTAMP,
    updated_at TIMESTAMP,
    legs JSONB, -- For complex orders
    extended_hours BOOLEAN DEFAULT false NOT NULL,
    client_order_id VARCHAR(100),
    commission DECIMAL(18, 8) DEFAULT 0 NOT NULL,
    fees DECIMAL(18, 8) DEFAULT 0 NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    last_synced TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for orders
CREATE INDEX IF NOT EXISTS orders_account_symbol_idx ON orders(account_id, symbol);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
CREATE INDEX IF NOT EXISTS orders_submitted_at_idx ON orders(submitted_at);
CREATE INDEX IF NOT EXISTS orders_side_idx ON orders(side);

-- Positions table - stores current positions
CREATE TABLE IF NOT EXISTS positions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES trading_accounts(id),
    symbol VARCHAR(10) NOT NULL,
    quantity DECIMAL(18, 8) NOT NULL,
    side VARCHAR(5) NOT NULL, -- long, short
    market_value DECIMAL(18, 2),
    cost_basis DECIMAL(18, 2),
    unrealized_pl DECIMAL(18, 2),
    unrealized_pl_percent DECIMAL(8, 4),
    unrealized_intraday_pl DECIMAL(18, 2),
    unrealized_intraday_pl_percent DECIMAL(8, 4),
    current_price DECIMAL(18, 8),
    last_day_price DECIMAL(18, 8),
    change_today DECIMAL(18, 8),
    avg_entry_price DECIMAL(18, 8),
    qty DECIMAL(18, 8) NOT NULL, -- Same as quantity but kept for compatibility
    market_value_snapshot DECIMAL(18, 2),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    last_synced TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for positions
CREATE UNIQUE INDEX IF NOT EXISTS positions_account_symbol_idx ON positions(account_id, symbol);
CREATE INDEX IF NOT EXISTS positions_side_idx ON positions(side);

-- Trade executions table - stores individual trade fills/executions
CREATE TABLE IF NOT EXISTS trade_executions (
    id SERIAL PRIMARY KEY,
    execution_id VARCHAR(100) NOT NULL UNIQUE,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    symbol VARCHAR(10) NOT NULL,
    side VARCHAR(4) NOT NULL, -- buy, sell
    quantity DECIMAL(18, 8) NOT NULL,
    price DECIMAL(18, 8) NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    commission DECIMAL(18, 8) DEFAULT 0 NOT NULL,
    fees DECIMAL(18, 8) DEFAULT 0 NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for trade_executions
CREATE INDEX IF NOT EXISTS trade_executions_order_id_idx ON trade_executions(order_id);
CREATE INDEX IF NOT EXISTS trade_executions_symbol_timestamp_idx ON trade_executions(symbol, timestamp);
CREATE INDEX IF NOT EXISTS trade_executions_timestamp_idx ON trade_executions(timestamp);

-- Trading sessions table - tracks daily/session P&L
CREATE TABLE IF NOT EXISTS trading_sessions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES trading_accounts(id),
    date TIMESTAMP NOT NULL,
    starting_balance DECIMAL(18, 2) NOT NULL,
    ending_balance DECIMAL(18, 2),
    day_trading_buying_power DECIMAL(18, 2),
    day_trading_buying_power_used DECIMAL(18, 2),
    realized_pl DECIMAL(18, 2) DEFAULT 0 NOT NULL,
    unrealized_pl DECIMAL(18, 2) DEFAULT 0 NOT NULL,
    total_pl DECIMAL(18, 2),
    trades_count INTEGER DEFAULT 0 NOT NULL,
    successful_trades INTEGER DEFAULT 0 NOT NULL,
    day_trade_count INTEGER DEFAULT 0 NOT NULL,
    largest_win DECIMAL(18, 2) DEFAULT 0 NOT NULL,
    largest_loss DECIMAL(18, 2) DEFAULT 0 NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for trading_sessions
CREATE UNIQUE INDEX IF NOT EXISTS trading_sessions_account_date_idx ON trading_sessions(account_id, date);
CREATE INDEX IF NOT EXISTS trading_sessions_date_idx ON trading_sessions(date);

-- Insert default paper trading account (Alpaca Paper)
INSERT INTO trading_accounts (account_id, name, provider, account_type, status, balance, buying_power, portfolio_value)
VALUES (
    'paper-default',
    'Alpaca Paper Trading',
    'alpaca',
    'paper',
    'active',
    100000.00,
    100000.00,
    100000.00
) ON CONFLICT (account_id) DO NOTHING;

-- Add comment to track migration
COMMENT ON TABLE trading_accounts IS 'Trading accounts for different brokers and account types (paper/live)';
COMMENT ON TABLE orders IS 'All trading orders placed through the system';
COMMENT ON TABLE positions IS 'Current trading positions held in accounts';
COMMENT ON TABLE trade_executions IS 'Individual trade fills and executions';
COMMENT ON TABLE trading_sessions IS 'Daily trading session summaries and P&L tracking';