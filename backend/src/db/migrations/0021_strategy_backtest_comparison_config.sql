-- Persist full comparison config for historical run replay in the UI
ALTER TABLE strategy_backtest_runs
  ADD COLUMN IF NOT EXISTS comparison_config JSONB;
