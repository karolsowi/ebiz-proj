-- Sprint D: predictions table for tracking model-emitted prediction accuracy

CREATE TABLE IF NOT EXISTS "predictions" (
  "id"                       serial PRIMARY KEY NOT NULL,
  "user_id"                  varchar(36) REFERENCES "users"("id") ON DELETE CASCADE,
  "symbol"                   varchar(10) NOT NULL,
  "predicted_direction"      varchar(4) NOT NULL,
  "predicted_return_percent" numeric(8, 4),
  "horizon_days"             integer NOT NULL DEFAULT 5,
  "actual_return_percent"    numeric(8, 4),
  "actual_direction"         varchar(4),
  "evaluated_at"             timestamp,
  "model_version"            varchar(50) NOT NULL DEFAULT 'v1',
  "confidence"               numeric(5, 4),
  "created_at"               timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "predictions_symbol_idx"       ON "predictions" ("symbol");
CREATE INDEX IF NOT EXISTS "predictions_created_at_idx"   ON "predictions" ("created_at");
CREATE INDEX IF NOT EXISTS "predictions_evaluated_at_idx" ON "predictions" ("evaluated_at");
CREATE INDEX IF NOT EXISTS "predictions_user_id_idx"      ON "predictions" ("user_id");
