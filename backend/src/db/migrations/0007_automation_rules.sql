-- Sprint E: persistent automation rules

CREATE TABLE IF NOT EXISTS "automation_rules" (
  "id"                SERIAL        PRIMARY KEY,
  "user_id"           VARCHAR(36)   NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"              VARCHAR(120)  NOT NULL,
  "symbol"            VARCHAR(10)   NOT NULL,
  "condition"         VARCHAR(10)   NOT NULL,
  "trigger_price"     DECIMAL(18,8) NOT NULL,
  "action"            VARCHAR(4)    NOT NULL,
  "quantity"          DECIMAL(18,8) NOT NULL,
  "time_in_force"     VARCHAR(10)   NOT NULL DEFAULT 'day',
  "enabled"           BOOLEAN       NOT NULL DEFAULT TRUE,
  "last_checked_at"   TIMESTAMP,
  "last_triggered_at" TIMESTAMP,
  "created_at"        TIMESTAMP     NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "automation_rules_user_id_idx"
  ON "automation_rules" ("user_id");

CREATE INDEX IF NOT EXISTS "automation_rules_enabled_symbol_idx"
  ON "automation_rules" ("enabled", "symbol");
