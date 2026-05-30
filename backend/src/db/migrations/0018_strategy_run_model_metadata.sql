ALTER TABLE strategy_backtest_runs
ADD COLUMN IF NOT EXISTS model_version VARCHAR(120);

ALTER TABLE strategy_backtest_runs
ADD COLUMN IF NOT EXISTS model_metadata JSONB;
