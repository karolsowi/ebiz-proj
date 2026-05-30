-- Sprint cleanup: make user-owned tables explicitly user-owned.
-- Rows without a valid owner were legacy/sample data and cannot be safely assigned.

DELETE FROM "portfolio_entries"
WHERE "user_id" IS NULL
   OR NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "portfolio_entries"."user_id");

DELETE FROM "watchlist"
WHERE "user_id" IS NULL
   OR NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "watchlist"."user_id");

DELETE FROM "predictions"
WHERE "user_id" IS NULL
   OR NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "predictions"."user_id");

DELETE FROM "backtest_runs"
WHERE "user_id" IS NULL
   OR NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "backtest_runs"."user_id");

DELETE FROM "trade_executions"
WHERE "order_id" IN (
  SELECT "orders"."id"
  FROM "orders"
  INNER JOIN "trading_accounts" ON "trading_accounts"."id" = "orders"."account_id"
  WHERE "trading_accounts"."user_id" IS NULL
     OR NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "trading_accounts"."user_id")
);

DELETE FROM "orders"
WHERE "account_id" IN (
  SELECT "id" FROM "trading_accounts"
  WHERE "user_id" IS NULL
     OR NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "trading_accounts"."user_id")
);

DELETE FROM "positions"
WHERE "account_id" IN (
  SELECT "id" FROM "trading_accounts"
  WHERE "user_id" IS NULL
     OR NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "trading_accounts"."user_id")
);

DELETE FROM "trading_sessions"
WHERE "account_id" IN (
  SELECT "id" FROM "trading_accounts"
  WHERE "user_id" IS NULL
     OR NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "trading_accounts"."user_id")
);

DELETE FROM "trading_risk_settings"
WHERE "account_id" IN (
  SELECT "id" FROM "trading_accounts"
  WHERE "user_id" IS NULL
     OR NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "trading_accounts"."user_id")
);

DELETE FROM "trading_accounts"
WHERE "user_id" IS NULL
   OR NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "trading_accounts"."user_id");

ALTER TABLE "portfolio_entries" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "watchlist" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "trading_accounts" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "predictions" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "backtest_runs" ALTER COLUMN "user_id" SET NOT NULL;
