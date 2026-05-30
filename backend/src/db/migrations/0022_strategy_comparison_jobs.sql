CREATE TABLE IF NOT EXISTS strategy_comparison_jobs (
  id SERIAL PRIMARY KEY,
  job_type VARCHAR(32) NOT NULL DEFAULT 'comparison',
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  request_config JSONB NOT NULL,
  checkpoint JSONB,
  progress JSONB,
  result JSONB,
  error_message TEXT,
  run_ids JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS strategy_comparison_jobs_status_idx
  ON strategy_comparison_jobs (status);

CREATE INDEX IF NOT EXISTS strategy_comparison_jobs_created_at_idx
  ON strategy_comparison_jobs (created_at DESC);
