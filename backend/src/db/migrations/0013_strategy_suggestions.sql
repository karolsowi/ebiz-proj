-- Strategy Engine: suggestion storage tables
-- Generated: 2026-05-05

CREATE TABLE IF NOT EXISTS "strategy_suggestions" (
  "id" serial PRIMARY KEY,
  "symbol" varchar(10) NOT NULL,
  "strategy" varchar(25) NOT NULL,           -- social_momentum | fundamental_flow | full_spectrum
  "signal" varchar(15) NOT NULL,             -- strong_buy | buy | hold | sell | strong_sell
  "conviction_score" decimal(5,4) NOT NULL,  -- 0.0 – 1.0  (abs value; direction in signal)
  "conviction_pct" integer NOT NULL,         -- 0 – 100

  -- Raw signal inputs (before weighting)
  "reddit_sentiment" decimal(5,4),           -- -1 to 1
  "reddit_mentions" integer,
  "reddit_trend_score" decimal(5,4),         -- normalised mention frequency 0–1
  "news_sentiment" decimal(5,4),             -- -1 to 1
  "news_mentions" integer,
  "ta_score" decimal(5,4),                   -- -1 to 1 from technicalAnalysisService
  "ta_signal" varchar(20),                   -- Strong Buy | Buy | Neutral | Sell | Strong Sell
  "days_to_earnings" integer,                -- null = unknown
  "calendar_catalyst_score" decimal(5,4),    -- 0–1 derived from days_to_earnings

  -- Price targets (Phase 4)
  "current_price" decimal(18,8),
  "entry_price" decimal(18,8),
  "stop_loss" decimal(18,8),
  "take_profit" decimal(18,8),
  "suggested_position_pct" decimal(5,2),     -- % of portfolio

  -- Full JSON breakdown for research queries
  "signal_breakdown" jsonb NOT NULL DEFAULT '{}',

  -- Outcome tracking (filled by suggestionEvaluator after horizonDays)
  "horizon_days" integer NOT NULL DEFAULT 5,
  "evaluated_at" timestamp,
  "price_at_evaluation" decimal(18,8),
  "actual_return_pct" decimal(8,4),
  "prediction_correct" boolean,

  "generated_at" timestamp NOT NULL DEFAULT NOW(),
  "engine_version" varchar(10) NOT NULL DEFAULT 'v1'
);

CREATE INDEX "strategy_suggestions_symbol_idx" ON "strategy_suggestions" ("symbol");
CREATE INDEX "strategy_suggestions_strategy_idx" ON "strategy_suggestions" ("strategy");
CREATE INDEX "strategy_suggestions_signal_idx" ON "strategy_suggestions" ("signal");
CREATE INDEX "strategy_suggestions_generated_at_idx" ON "strategy_suggestions" ("generated_at");
CREATE INDEX "strategy_suggestions_evaluated_at_idx" ON "strategy_suggestions" ("evaluated_at");
-- composite: un-evaluated suggestions pending evaluation
CREATE INDEX "strategy_suggestions_pending_eval_idx" ON "strategy_suggestions" ("generated_at") WHERE "evaluated_at" IS NULL;

-- Normalised per-signal rows for fine-grained research queries
CREATE TABLE IF NOT EXISTS "suggestion_signals" (
  "id" serial PRIMARY KEY,
  "suggestion_id" integer NOT NULL REFERENCES "strategy_suggestions"("id") ON DELETE CASCADE,
  "signal_name" varchar(50) NOT NULL,        -- e.g. reddit_sentiment, rsi_14, macd
  "raw_value" decimal(10,6),
  "normalized_value" decimal(5,4),           -- -1 to 1
  "weight" decimal(5,4) NOT NULL,            -- weight in this strategy
  "weighted_contribution" decimal(5,4)       -- normalized_value * weight
);

CREATE INDEX "suggestion_signals_suggestion_id_idx" ON "suggestion_signals" ("suggestion_id");
CREATE INDEX "suggestion_signals_signal_name_idx" ON "suggestion_signals" ("signal_name");
