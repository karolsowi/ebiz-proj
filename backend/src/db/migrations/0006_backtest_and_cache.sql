-- Sprint B: Backtest persistence + cache layer hardening

-- ── Backtest runs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "backtest_runs" (
  "id"                   VARCHAR(50)   PRIMARY KEY,
  "user_id"              VARCHAR(36)   REFERENCES "users"("id") ON DELETE CASCADE,
  "symbols"              JSONB         NOT NULL,
  "start_date"           VARCHAR(10)   NOT NULL,
  "end_date"             VARCHAR(10)   NOT NULL,
  "initial_capital"      DECIMAL(15,2) NOT NULL,
  "buy_threshold"        DECIMAL(5,4)  NOT NULL,
  "sell_threshold"       DECIMAL(5,4)  NOT NULL,
  "stop_loss_percent"    DECIMAL(5,2),
  "take_profit_percent"  DECIMAL(5,2),
  "status"               VARCHAR(20)   NOT NULL DEFAULT 'running',
  "total_return"         DECIMAL(15,2),
  "total_return_percent" DECIMAL(8,4),
  "max_drawdown_percent" DECIMAL(8,4),
  "total_trades"         INTEGER,
  "win_rate_percent"     DECIMAL(8,4),
  "final_equity"         DECIMAL(15,2),
  "equity_curve"         JSONB,
  "error_message"        TEXT,
  "created_at"           TIMESTAMP     NOT NULL DEFAULT NOW(),
  "completed_at"         TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "backtest_runs_user_id_idx"    ON "backtest_runs" ("user_id");
CREATE INDEX IF NOT EXISTS "backtest_runs_status_idx"     ON "backtest_runs" ("status");
CREATE INDEX IF NOT EXISTS "backtest_runs_created_at_idx" ON "backtest_runs" ("created_at");

-- ── Backtest trades ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "backtest_trades" (
  "id"        SERIAL        PRIMARY KEY,
  "run_id"    VARCHAR(50)   NOT NULL REFERENCES "backtest_runs"("id") ON DELETE CASCADE,
  "symbol"    VARCHAR(10)   NOT NULL,
  "side"      VARCHAR(4)    NOT NULL,
  "date"      VARCHAR(10)   NOT NULL,
  "price"     DECIMAL(15,4) NOT NULL,
  "quantity"  DECIMAL(15,6) NOT NULL,
  "sentiment" DECIMAL(8,6)  NOT NULL,
  "value"     DECIMAL(15,2) NOT NULL,
  "reason"    VARCHAR(20)
);

CREATE INDEX IF NOT EXISTS "backtest_trades_run_id_idx" ON "backtest_trades" ("run_id");
CREATE INDEX IF NOT EXISTS "backtest_trades_symbol_idx" ON "backtest_trades" ("symbol");

-- ── Cache layer: add param_hash column ────────────────────────────────────────
-- Drop the old JSONB-equality unique index (unreliable)
DROP INDEX IF EXISTS "api_cache_endpoint_params_idx";

ALTER TABLE "api_response_cache"
  ADD COLUMN IF NOT EXISTS "param_hash" VARCHAR(64) NOT NULL DEFAULT '';

-- Backfill existing rows with a deterministic hash placeholder
-- (rows will be invalidated and replaced on next access — acceptable for a cache)
UPDATE "api_response_cache" SET "param_hash" = md5(parameters::text) WHERE "param_hash" = '';

-- New unique index keyed on (endpoint, param_hash, source) — no JSONB comparison
CREATE UNIQUE INDEX IF NOT EXISTS "api_cache_endpoint_hash_source_idx"
  ON "api_response_cache" ("endpoint", "param_hash", "source");
