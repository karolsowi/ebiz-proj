-- Strategy Backtest Results tables
-- Phase 15: Persists comparison run results and trade logs

CREATE TABLE IF NOT EXISTS strategy_backtest_runs (
  id                      SERIAL PRIMARY KEY,
  symbols                 JSONB    NOT NULL,
  strategy                VARCHAR(25) NOT NULL,
  start_date              VARCHAR(10) NOT NULL,
  end_date                VARCHAR(10) NOT NULL,
  initial_capital         DECIMAL(15, 2) NOT NULL,
  conviction_threshold    DECIMAL(4, 3)  NOT NULL,
  max_position_pct        DECIMAL(4, 3)  NOT NULL,
  stop_loss_enabled       BOOLEAN  NOT NULL DEFAULT TRUE,
  take_profit_enabled     BOOLEAN  NOT NULL DEFAULT TRUE,
  status                  VARCHAR(15) NOT NULL DEFAULT 'completed',
  error_message           TEXT,
  total_return_pct        DECIMAL(10, 4),
  annualized_return_pct   DECIMAL(10, 4),
  sharpe_ratio            DECIMAL(8, 4),
  sortino_ratio           DECIMAL(8, 4),
  max_drawdown_pct        DECIMAL(8, 4),
  win_rate_pct            DECIMAL(6, 2),
  total_trades            INTEGER,
  winning_trades          INTEGER,
  losing_trades           INTEGER,
  benchmark_return_pct    DECIMAL(10, 4),
  alpha                   DECIMAL(10, 4),
  equity_curve            JSONB    NOT NULL DEFAULT '[]',
  comparison_winner       VARCHAR(25),
  comparison_winner_reason TEXT,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMP
);

CREATE INDEX IF NOT EXISTS backtest_runs_strategy_idx   ON strategy_backtest_runs (strategy);
CREATE INDEX IF NOT EXISTS backtest_runs_created_at_idx ON strategy_backtest_runs (created_at);

CREATE TABLE IF NOT EXISTS strategy_backtest_trades (
  id          SERIAL PRIMARY KEY,
  run_id      INTEGER NOT NULL REFERENCES strategy_backtest_runs(id) ON DELETE CASCADE,
  symbol      VARCHAR(10) NOT NULL,
  strategy    VARCHAR(25) NOT NULL,
  side        VARCHAR(4)  NOT NULL,
  date        VARCHAR(10) NOT NULL,
  price       DECIMAL(18, 8) NOT NULL,
  quantity    INTEGER NOT NULL,
  value       DECIMAL(18, 4) NOT NULL,
  reason      VARCHAR(20) NOT NULL,
  conviction  DECIMAL(5, 4),
  pnl         DECIMAL(18, 4)
);

CREATE INDEX IF NOT EXISTS backtest_trades_run_id_idx    ON strategy_backtest_trades (run_id);
CREATE INDEX IF NOT EXISTS backtest_trades_symbol_idx    ON strategy_backtest_trades (symbol);
CREATE INDEX IF NOT EXISTS backtest_trades_strategy_idx  ON strategy_backtest_trades (strategy);
