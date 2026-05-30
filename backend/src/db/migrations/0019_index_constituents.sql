CREATE TABLE IF NOT EXISTS index_constituents (
  id SERIAL PRIMARY KEY,
  index_code VARCHAR(32) NOT NULL,
  symbol VARCHAR(16) NOT NULL,
  effective_from VARCHAR(10) NOT NULL,
  effective_to VARCHAR(10),
  source VARCHAR(64) NOT NULL DEFAULT 'manual',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS index_constituents_index_code_idx
  ON index_constituents (index_code);

CREATE INDEX IF NOT EXISTS index_constituents_symbol_idx
  ON index_constituents (symbol);

CREATE INDEX IF NOT EXISTS index_constituents_effective_from_idx
  ON index_constituents (effective_from);

CREATE UNIQUE INDEX IF NOT EXISTS index_constituents_index_symbol_from_idx
  ON index_constituents (index_code, symbol, effective_from);
