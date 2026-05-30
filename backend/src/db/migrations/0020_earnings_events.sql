CREATE TABLE IF NOT EXISTS earnings_events (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(16) NOT NULL,
  event_date VARCHAR(10) NOT NULL,
  fiscal_year INTEGER,
  fiscal_quarter INTEGER,
  event_hour VARCHAR(16),
  eps_actual DECIMAL(18, 6),
  eps_estimate DECIMAL(18, 6),
  revenue_actual DECIMAL(20, 2),
  revenue_estimate DECIMAL(20, 2),
  source VARCHAR(64) NOT NULL DEFAULT 'finnhub_calendar',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS earnings_events_symbol_date_source_idx
  ON earnings_events (symbol, event_date, source);

CREATE INDEX IF NOT EXISTS earnings_events_symbol_idx
  ON earnings_events (symbol);

CREATE INDEX IF NOT EXISTS earnings_events_event_date_idx
  ON earnings_events (event_date);
