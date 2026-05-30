-- Sprint A: Real users and persistent authentication
-- Run with: psql $DATABASE_URL -f this_file.sql

-- ── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "users" (
  "id"             VARCHAR(36)   PRIMARY KEY,
  "email"          VARCHAR(255)  NOT NULL,
  "first_name"     VARCHAR(100)  NOT NULL,
  "last_name"      VARCHAR(100)  NOT NULL,
  "password_hash"  VARCHAR(255)  NOT NULL,
  "role"           VARCHAR(20)   NOT NULL DEFAULT 'user',
  "email_verified" BOOLEAN       NOT NULL DEFAULT FALSE,
  "created_at"     TIMESTAMP     NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");

-- ── Refresh tokens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
  "id"          SERIAL        PRIMARY KEY,
  "token"       VARCHAR(512)  NOT NULL,
  "user_id"     VARCHAR(36)   NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at"  TIMESTAMP     NOT NULL,
  "revoked_at"  TIMESTAMP,
  "user_agent"  VARCHAR(500),
  "ip_address"  VARCHAR(50),
  "created_at"  TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_idx"      ON "refresh_tokens" ("token");
CREATE        INDEX IF NOT EXISTS "refresh_tokens_user_id_idx"    ON "refresh_tokens" ("user_id");
CREATE        INDEX IF NOT EXISTS "refresh_tokens_expires_at_idx" ON "refresh_tokens" ("expires_at");

-- ── User settings ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_settings" (
  "id"                   SERIAL       PRIMARY KEY,
  "user_id"              VARCHAR(36)  NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "theme"                VARCHAR(20)  NOT NULL DEFAULT 'system',
  "language"             VARCHAR(10)  NOT NULL DEFAULT 'en',
  "timezone"             VARCHAR(100) NOT NULL DEFAULT 'UTC',
  "currency"             VARCHAR(10)  NOT NULL DEFAULT 'USD',
  "date_format"          VARCHAR(20)  NOT NULL DEFAULT 'MM/DD/YYYY',
  "default_chart_type"   VARCHAR(20)  NOT NULL DEFAULT 'candlestick',
  "refresh_interval"     INTEGER      NOT NULL DEFAULT 30,
  "email_notifications"  BOOLEAN      NOT NULL DEFAULT TRUE,
  "trading_alerts"       BOOLEAN      NOT NULL DEFAULT TRUE,
  "paper_trading_mode"   BOOLEAN      NOT NULL DEFAULT TRUE,
  "confirm_orders"       BOOLEAN      NOT NULL DEFAULT TRUE,
  "risk_warnings"        BOOLEAN      NOT NULL DEFAULT TRUE,
  "updated_at"           TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_settings_user_id_idx" ON "user_settings" ("user_id");

-- ── User API keys ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_api_keys" (
  "id"           SERIAL       PRIMARY KEY,
  "user_id"      VARCHAR(36)  NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"         VARCHAR(100) NOT NULL,
  "service"      VARCHAR(50)  NOT NULL,
  "is_active"    BOOLEAN      NOT NULL DEFAULT TRUE,
  "last_used_at" TIMESTAMP,
  "created_at"   TIMESTAMP    NOT NULL DEFAULT NOW(),
  "expires_at"   TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "user_api_keys_user_id_idx" ON "user_api_keys" ("user_id");

-- ── Add user_id FK to portfolio_entries ───────────────────────────────────────
ALTER TABLE "portfolio_entries"
  ADD COLUMN IF NOT EXISTS "user_id" VARCHAR(36) REFERENCES "users"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "portfolio_entries_user_id_idx" ON "portfolio_entries" ("user_id");

-- ── Add user_id FK to watchlist ───────────────────────────────────────────────
-- Drop old unique on symbol alone (if it still exists), then add per-user unique
ALTER TABLE "watchlist"
  ADD COLUMN IF NOT EXISTS "user_id" VARCHAR(36) REFERENCES "users"("id") ON DELETE CASCADE;

DROP INDEX IF EXISTS "watchlist_symbol_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "watchlist_user_symbol_idx" ON "watchlist" ("user_id", "symbol");

-- ── Add user_id FK to trading_accounts ───────────────────────────────────────
ALTER TABLE "trading_accounts"
  ADD COLUMN IF NOT EXISTS "user_id" VARCHAR(36) REFERENCES "users"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "trading_accounts_user_id_idx" ON "trading_accounts" ("user_id");
