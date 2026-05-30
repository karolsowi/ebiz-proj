CREATE TABLE IF NOT EXISTS strategy_run_analyses (
  id              SERIAL PRIMARY KEY,
  source_run_id   INTEGER NOT NULL REFERENCES strategy_backtest_runs(id) ON DELETE CASCADE,
  analysis        JSONB NOT NULL,
  proposed_config JSONB NOT NULL,
  validation_job_id INTEGER REFERENCES strategy_comparison_jobs(id) ON DELETE SET NULL,
  validation_run_id INTEGER REFERENCES strategy_backtest_runs(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS strategy_run_analyses_source_run_id_idx
  ON strategy_run_analyses(source_run_id);
